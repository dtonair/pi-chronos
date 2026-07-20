export interface ImportReconciliationResult {
  created: number;
  unchanged: number;
  updated: number;
  disabled: number;
  jobs: string[];
  diffs: Record<string, unknown[]>;
}
