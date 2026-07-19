import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Pi Chronos - Agent Scheduler Extension
 *
 * Phase 1: Static metadata registration only.
 * No background resources, timers, filesystem, SQLite, or child processes.
 */
export default function chronosExtension(_pi: ExtensionAPI): void {
  // Phase 1: Only register static metadata.
  // The factory must not start any background resources.
  // Full lifecycle hooks, tools, and commands come in phases 2-10.
}
