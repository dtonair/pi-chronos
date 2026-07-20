export interface MetricsSnapshot {
  wakes: number;
  dispatches: number;
  queuedRuns: number;
  succeeded: number;
  failed: number;
  skipped: number;
  abandoned: number;
  policyDenials: number;
}

export function createMetrics() {
  const values: MetricsSnapshot = {
    wakes: 0,
    dispatches: 0,
    queuedRuns: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    abandoned: 0,
    policyDenials: 0,
  };
  return {
    increment(key: keyof MetricsSnapshot, amount = 1): void {
      values[key] += amount;
    },
    snapshot(): MetricsSnapshot {
      return { ...values };
    },
  };
}
