import type { UTCTimestamp } from "./job.js";

export interface SchedulerInstance {
  readonly id: string;
  readonly hostname: string;
  readonly processId: number;
  readonly startedAt: UTCTimestamp;
  heartbeatAt: UTCTimestamp;
  stoppedAt?: UTCTimestamp;
}
