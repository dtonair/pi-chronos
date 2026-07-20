export type PermissionMode = "job" | "pi-seatbelt-sandbox";

export interface ChronosConfig {
  defaultTimezone: string;
  minimumIntervalMs: number;
  defaultTimeoutMs: number;
  maximumTimeoutMs: number;
  defaultMaxOutputBytes: number;
  maximumConcurrentRuns: number;
  schedulerPollFallbackMs: number;
  leaseDurationMs: number;
  leaseRenewalMs: number;
  instanceHeartbeatMs: number;
  instanceStaleAfterMs: number;
  shutdownGraceMs: number;
  allowProjectImports: boolean;
  enableWidget: boolean;
  enableOsSandbox: boolean;
  maximumImportBytes: number;
  maximumImportJobs: number;
  permissionMode: PermissionMode;
  piSeatbeltExtension?: string;
}

export const DEFAULT_CONFIG: ChronosConfig = {
  defaultTimezone: "UTC",
  minimumIntervalMs: 60_000,
  defaultTimeoutMs: 600_000,
  maximumTimeoutMs: 86_400_000,
  defaultMaxOutputBytes: 262_144,
  maximumConcurrentRuns: 4,
  schedulerPollFallbackMs: 60_000,
  leaseDurationMs: 60_000,
  leaseRenewalMs: 20_000,
  instanceHeartbeatMs: 15_000,
  instanceStaleAfterMs: 60_000,
  shutdownGraceMs: 5_000,
  allowProjectImports: true,
  enableWidget: true,
  enableOsSandbox: false,
  maximumImportBytes: 1_048_576,
  maximumImportJobs: 1_000,
  permissionMode: "job",
};
