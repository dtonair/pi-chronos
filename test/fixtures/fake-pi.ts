export function fakePiJsonl(lines: readonly unknown[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}
