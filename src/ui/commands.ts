const COMMAND_ACTIONS: Record<string, string> = {
  status: "health",
  list: "list",
  show: "get",
  create: "create",
  history: "history",
  pause: "pause",
  resume: "resume",
  run: "run_now",
  cancel: "cancel_run",
  approve: "approve",
  revoke: "revoke_approval",
  import: "import",
};

/** Whether unmatched command text should be interpreted by the Pi agent. */
export function isNaturalChronosRequest(args: string): boolean {
  const text = args.trim();
  if (!text || text.startsWith("{") || parseChronosCommand(text) !== undefined) return false;
  const command = text.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (COMMAND_ACTIONS[command] === undefined) return true;

  // A known command followed by prose (for example, `create check CI every
  // 5 minutes`) is still a natural-language request. Keep JSON-looking input
  // on the strict parser path so malformed action envelopes are not reinterpreted.
  return !/[{[]/.test(text);
}

/** Build a user message that asks Pi to translate natural language into scheduler calls. */
export function buildNaturalChronosPrompt(args: string): string {
  return [
    "Handle the following scheduling request using the scheduler tool.",
    "Preview the schedule before creating it. Do not perform the scheduled task now.",
    "Ask the user to clarify missing timezone, destination, credentials, or permissions instead of guessing.",
    `Scheduling request: ${args.trim()}`,
  ].join("\n");
}

/** Parse both the documented JSON form and the human-friendly command form. */
export function parseChronosCommand(args: string): unknown {
  const text = args.trim();
  // Bare /chronos opens the expanded workspace; /chronos status remains the
  // explicit health command.
  if (!text) return { action: "list" };
  if (text.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  const [command, ...rest] = text.split(/\s+/);
  const action = COMMAND_ACTIONS[command?.toLowerCase() ?? ""];
  if (action === undefined) return undefined;
  const first = rest[0];
  const input: Record<string, unknown> = { action };
  if (first !== undefined && !first.startsWith("{")) {
    if (action === "cancel_run") input.runId = first;
    else if (action === "create" || action === "import" || action === "list" || action === "health")
      return undefined;
    else input.jobId = first;
    rest.shift();
  }
  const tail = rest.join(" ").trim();
  if (tail) {
    try {
      const options: unknown = JSON.parse(tail);
      if (typeof options !== "object" || options === null || Array.isArray(options))
        return undefined;
      Object.assign(input, options);
    } catch {
      return undefined;
    }
  }
  return input;
}
