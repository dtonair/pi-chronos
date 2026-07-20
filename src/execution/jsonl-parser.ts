export interface ParsedChildOutput {
  assistantText: string;
  assistantTextBytes: number;
  textTruncated: boolean;
  toolActivity: string[];
  inputTokens: number;
  outputTokens: number;
  stopReason?: string;
  /** Safe completion protocol evidence parsed from trusted tool events. */
  completion?: { status: "succeeded" | "failed"; summary: string };
  completionDeclarations: number;
  atomicWrites: string[];
  toolErrorCount: number;
  protocolFailure: boolean;
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
    completionDeclarations: 0,
    atomicWrites: [],
    toolErrorCount: 0,
    protocolFailure: false,
    malformedLines: 0,
    diagnostics: [],
  };
  private readonly maxDiagnostics: number;
  private readonly maxTextBytes: number;
  private readonly maxLineBytes: number;
  private readonly activeToolCalls = new Map<string, string>();

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
      atomicWrites: [...this.result.atomicWrites],
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
      if (type === "tool_execution_start") {
        const id = value.toolCallId ?? value.tool_call_id ?? value.id;
        if (typeof id === "string" && this.activeToolCalls.size < 1_000 && typeof name === "string")
          this.activeToolCalls.set(id, name);
      }
      if (type === "tool_execution_end") {
        const id = value.toolCallId ?? value.tool_call_id ?? value.id;
        if (typeof id === "string") {
          if (!this.activeToolCalls.has(id)) this.result.protocolFailure = true;
          this.activeToolCalls.delete(id);
        }
        this.parseToolEnd(name, value);
        if (name === "chronos_complete") this.parseCompletion(value);
        if (name === "chronos_atomic_write") this.parseAtomicWrite(value);
      }
      // Completion and mutation evidence is accepted only from the bounded
      // execution-end result, not from a request that may never execute.
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

  private parseCompletion(value: JsonValue): void {
    const args = (value.args ??
      value.input ??
      value.parameters ??
      (value.toolCall as JsonValue | undefined)?.args) as JsonValue | undefined;
    const result = value.result as JsonValue | undefined;
    const details = result?.details as JsonValue | undefined;
    const status = args?.status ?? result?.status ?? details?.status;
    const summary = args?.summary ?? result?.summary ?? details?.summary;
    this.result.completionDeclarations++;
    if (
      (status !== "succeeded" && status !== "failed") ||
      typeof summary !== "string" ||
      summary.length === 0 ||
      Buffer.byteLength(summary) > 4_096 ||
      this.result.completionDeclarations > 1
    ) {
      this.result.protocolFailure = true;
      this.addDiagnostic("Invalid completion declaration");
      return;
    }
    this.result.completion = { status, summary };
  }

  private parseAtomicWrite(value: JsonValue): void {
    const result = value.result as JsonValue | undefined;
    const details = result?.details as JsonValue | undefined;
    const path =
      result?.path ??
      details?.path ??
      (value.path as unknown) ??
      ((value.args as JsonValue | undefined)?.path as unknown);
    const success = result?.success ?? details?.success ?? value.success;
    if (
      success === true &&
      typeof path === "string" &&
      path.length <= 4_096 &&
      this.result.atomicWrites.length < 100
    )
      this.result.atomicWrites.push(path);
  }

  private parseToolEnd(name: unknown, value: JsonValue): void {
    const result = value.result as JsonValue | undefined;
    if (
      value.isError === true ||
      value.error !== undefined ||
      result?.isError === true ||
      result?.status === "error"
    ) {
      this.result.toolErrorCount++;
    }
    if (name === "chronos_complete" && value.error !== undefined)
      this.result.protocolFailure = true;
  }

  private addDiagnostic(message: string): void {
    if (this.result.diagnostics.length < this.maxDiagnostics) this.result.diagnostics.push(message);
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
