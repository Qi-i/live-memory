import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const page = await readFile(new URL("../src/statsPage.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/statsPage.css", import.meta.url), "utf8");
const appRoot = await readFile(new URL("../src/AppRoot.tsx", import.meta.url), "utf8");
const keepsake = await readFile(new URL("../src/keepsakeStudio.tsx", import.meta.url), "utf8");
const extract = page.match(/function monthlyTrend\([\s\S]*?\n\}\n(?=\nfunction Metric)/);
assert.ok(extract, "Month trend model should remain separately testable");
const source = "export " + extract[0];
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const output = {};
new Function("exports", js)(output);
const rows = output.monthlyTrend([
  { date: "2024-03-01" }, { date: "2024-03-10" }, { date: "2024-08-18" },
  { date: "2025-07-01" },
], "2024");
assert.equal(rows.length, 12);
assert.equal(rows[0][0], "2024-01");
assert.equal(rows[11][0], "2024-12");
assert.equal(rows[2][1], 2, "March should contain both 2024 concerts");
assert.equal(rows[7][1], 1);
assert.equal(rows[11][1], 0, "Months with no concerts must remain in the timeline");
assert.equal(rows.reduce((n, [,count]) => n + count, 0), 3);
assert.match(page, /record\.recordState !== "cancelled" && record\.recordState !== "refunded"/);
assert.match(page, /countRows\(watched\.flatMap/);
assert.match(page, /countRows\(watched\.map\(\(record\) => record\.city\)/);
assert.match(page, /onShare\(scopedRecords\)/, "Shareable recaps must respect selected year");
assert.match(appRoot, /onShare=\{\(selectedRecords\) => setKeepsakeSubject\(\{ kind: "recap", records: selectedRecords \}\)\}/);
assert.match(page, /aria-pressed=\{selectedYear === year\}/);
assert.match(page, /const hasData = rows\.some/);
assert.match(keepsake, /record\.recordState !== "cancelled" && record\.recordState !== "refunded"/);
assert.match(css, /\.statistics-year-options/);
console.log("Stats timeline tests passed: 12 chronological months, zeros preserved, canceled/refunded excluded, scoped sharing.");
