export interface ParsedChildOutput {
  assistantText: string;
  assistantTextBytes: number;
  textTruncated: boolean;
  toolActivity: string[];
  inputTokens: number;
  outputTokens: number;
  stopReason?: string;
  malformedLines: number;
  diagnostics: string[];
}

type JsonValue = Record<string, unknown>;

export class JsonlParser {
  private remainder = "";
  private discardingLine = false;
  private streamedText = false;
  private readonly result: ParsedChildOutput = {
    assistantText: "",
    assistantTextBytes: 0,
    textTruncated: false,
    toolActivity: [],
    inputTokens: 0,
    outputTokens: 0,
    malformedLines: 0,
    diagnostics: [],
  };
  private readonly maxDiagnostics: number;
  private readonly maxTextBytes: number;
  private readonly maxLineBytes: number;

  constructor(
    maxDiagnostics = 20,
    maxTextBytes = 1_048_576,
    maxLineBytes = Math.max(64 * 1024, maxTextBytes + 16 * 1024),
  ) {
    this.maxDiagnostics = maxDiagnostics;
    this.maxTextBytes = Math.max(0, maxTextBytes);
    this.maxLineBytes = Math.max(1, maxLineBytes);
  }

  push(chunk: string): void {
    let input = chunk;
    if (this.discardingLine) {
      const newline = input.search(/\r?\n/);
      if (newline < 0) return;
      input = input.slice(newline + (input[newline] === "\r" ? 2 : 1));
      this.discardingLine = false;
    }
    this.remainder += input;
    if (!/[\r\n]/.test(this.remainder) && Buffer.byteLength(this.remainder) > this.maxLineBytes) {
      this.remainder = "";
      this.discardingLine = true;
      this.recordMalformed();
      return;
    }
    const lines = this.remainder.split(/\r?\n/);
    this.remainder = lines.pop() ?? "";
    for (const line of lines) this.parseLine(line);
  }

  finish(): ParsedChildOutput {
    if (this.remainder.trim()) this.parseLine(this.remainder);
    this.remainder = "";
    return {
      ...this.result,
      toolActivity: [...this.result.toolActivity],
      diagnostics: [...this.result.diagnostics],
    };
  }

  private parseLine(line: string): void {
    if (!line.trim()) return;
    if (Buffer.byteLength(line) > this.maxLineBytes) {
      this.recordMalformed();
      return;
    }
    let value: JsonValue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        throw new Error("JSONL record must be an object");
      value = parsed as JsonValue;
    } catch {
      this.recordMalformed();
      return;
    }
    const type = value.type;
    const message = value.message as JsonValue | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    const textItem = content.find(
      (item): item is JsonValue =>
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item) &&
        ((item as JsonValue).type === "text" || (item as JsonValue).type === "output_text"),
    );
    const streamEvent = value.assistantMessageEvent as JsonValue | undefined;
    const delta = streamEvent?.type === "text_delta" ? streamEvent.delta : undefined;
    const text =
      value.text ??
      delta ??
      (!this.streamedText && (type === "assistant" || type === "message_end")
        ? textItem?.text
        : undefined);
    if (typeof delta === "string") this.streamedText = true;
    if (typeof text === "string") this.appendAssistantText(text);

    if (
      type === "tool_call" ||
      type === "tool_use" ||
      type === "tool_execution_start" ||
      type === "tool_execution_end"
    ) {
      const tool = value.tool as JsonValue | undefined;
      const name = value.name ?? value.tool_name ?? value.toolName ?? tool?.name;
      if (typeof name === "string" && this.result.toolActivity.length < 1_000)
        this.result.toolActivity.push(name);
    }
    const usage = value.usage ?? message?.usage;
    if (usage && typeof usage === "object" && !Array.isArray(usage)) {
      const usageRecord = usage as JsonValue;
      const inputTokens = usageRecord.input_tokens ?? usageRecord.inputTokens;
      const outputTokens = usageRecord.output_tokens ?? usageRecord.outputTokens;
      if (typeof inputTokens === "number") this.result.inputTokens += inputTokens;
      if (typeof outputTokens === "number") this.result.outputTokens += outputTokens;
    }
    const stopReason = value.stop_reason ?? value.stopReason ?? message?.stopReason;
    if (typeof stopReason === "string") this.result.stopReason = stopReason;
  }

  private appendAssistantText(text: string): void {
    const bytes = Buffer.byteLength(text);
    this.result.assistantTextBytes += bytes;
    const retained = Buffer.byteLength(this.result.assistantText);
    if (retained < this.maxTextBytes) {
      const remaining = this.maxTextBytes - retained;
      this.result.assistantText += Buffer.from(text).subarray(0, remaining).toString("utf8");
    }
    if (retained + bytes > this.maxTextBytes) this.result.textTruncated = true;
  }

  private recordMalformed(): void {
    this.result.malformedLines++;
    if (this.result.diagnostics.length < this.maxDiagnostics)
      this.result.diagnostics.push("Malformed JSONL line");
  }
}
