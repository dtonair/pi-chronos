const SENSITIVE =
  /prompt|model|permission|environment|secret|command|path|domain|process|completion/i;

export interface ImportDiff {
  field: string;
  before?: unknown;
  after?: unknown;
  sensitive: boolean;
}

export function diffImportDefinitions(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  max = 50,
): ImportDiff[] {
  if (max <= 0) return [];
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diffs: ImportDiff[] = [];
  for (const field of fields) {
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
    const sensitive = SENSITIVE.test(field);
    diffs.push({
      field,
      before: sensitive ? "[REDACTED]" : before[field],
      after: sensitive ? "[REDACTED]" : after[field],
      sensitive,
    });
    if (diffs.length >= max) break;
  }
  return diffs;
}
