import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";

const reportPath = "coverage/coverage-final.json";
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const files = Object.entries(report).filter(([file]) => {
  const relativePath = relative(process.cwd(), file).split(sep).join("/");
  return relativePath.startsWith("src/") && !relativePath.endsWith(".d.ts");
});

function percentage(total, covered) {
  return total === 0 ? 100 : (covered / total) * 100;
}
function measure(entries) {
  let statements = 0;
  let coveredStatements = 0;
  let branches = 0;
  let coveredBranches = 0;
  for (const [, data] of entries) {
    for (const count of Object.values(data.s ?? {})) {
      statements++;
      if (count > 0) coveredStatements++;
    }
    for (const counts of Object.values(data.b ?? {})) {
      for (const count of counts) {
        branches++;
        if (count > 0) coveredBranches++;
      }
    }
  }
  return {
    statements: percentage(statements, coveredStatements),
    branches: percentage(branches, coveredBranches),
  };
}

const overall = measure(files);
const critical = ["scheduler", "storage", "security"].map((name) => [
  name,
  measure(files.filter(([file]) => relative(process.cwd(), file).split(sep).join("/").startsWith(`src/${name}/`))),
]);
console.log(
  `Coverage: statements ${overall.statements.toFixed(2)}%, branches ${overall.branches.toFixed(2)}%`,
);
for (const [name, value] of critical)
  console.log(`Coverage ${name}: statements ${value.statements.toFixed(2)}%, branches ${value.branches.toFixed(2)}%`);

const failures = [];
if (overall.statements < 85) failures.push("overall statements < 85%");
if (overall.branches < 80) failures.push("overall branches < 80%");
for (const [name, value] of critical) {
  if (value.branches < 90) failures.push(`${name} branches < 90%`);
}
if (failures.length > 0) throw new Error(`Coverage thresholds failed: ${failures.join(", ")}`);
