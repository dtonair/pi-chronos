export interface RenderOptions {
  width?: number;
  now?: number;
}

export function displayWidth(value: string): number {
  // Chronos strings contain no ANSI styling. Treat the commonly used symbols
  // as one terminal cell; this keeps layout deterministic across Text and tests.
  return [...value].length;
}

export function truncate(value: string, width: number, suffix = "…"): string {
  const safeWidth = Math.max(0, Math.floor(width));
  const chars = [...value.replace(/[\r\n\t]+/g, " ")];
  if (chars.length <= safeWidth) return chars.join("");
  if (safeWidth === 0) return "";
  if (safeWidth <= [...suffix].length) return [...suffix].slice(0, safeWidth).join("");
  return `${chars.slice(0, safeWidth - [...suffix].length).join("")}${suffix}`;
}

export function pad(value: string, width: number): string {
  const text = truncate(value, width);
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

export function keyValue(label: string, value: string, width: number, labelWidth = 12): string {
  const valueWidth = Math.max(1, width - labelWidth - 2);
  return `  ${pad(label, labelWidth)}  ${truncate(value, valueWidth)}`;
}

export function sectionHeader(title: string): string {
  return title;
}

export function boundList(values: readonly string[], max = 4): string {
  if (values.length === 0) return "none";
  const visible = values.slice(0, Math.max(0, max));
  const suffix = values.length > visible.length ? ` … +${values.length - visible.length}` : "";
  return `${visible.join(", ")}${suffix}`;
}

export function boundedLines(lines: readonly string[], width: number): string[] {
  return lines.map((line) => truncate(line, Math.max(1, width)));
}
