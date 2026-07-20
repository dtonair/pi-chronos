export function fakePiContext(mode: "tui" | "rpc" | "json" | "print" = "json") {
  return {
    mode,
    hasUI: mode === "tui" || mode === "rpc",
    cwd: process.cwd(),
    isProjectTrusted: () => false,
  };
}
