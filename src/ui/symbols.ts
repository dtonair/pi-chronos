/** Stable, text-only symbols used throughout the Chronos workspace. */
export const SYMBOLS = {
  active: "●",
  running: "◐",
  paused: "○",
  approval: "?",
  failed: "!",
  disabled: "×",
  succeeded: "✓",
  cancelled: "–",
  invalid: "×",
  degraded: "!",
} as const;

export type StatusSymbol = (typeof SYMBOLS)[keyof typeof SYMBOLS];
