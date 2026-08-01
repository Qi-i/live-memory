import { readFile, writeFile } from "node:fs/promises";

const path = "src/archive.css";
const marker = "/* Compact archive masthead v2 */";
const source = await readFile(path, "utf8");
const index = source.indexOf(marker);
if (index < 0) throw new Error("Legacy compact masthead block not found");
const cleaned = `${source.slice(0, index).trimEnd()}\n`;
if (!cleaned.includes("archive-highlight-card-1")) throw new Error("Premium masthead styles missing after cleanup");
await writeFile(path, cleaned);

const testsPath = "scripts/run-tests.mjs";
let tests = await readFile(testsPath, "utf8");
if (!tests.includes("Compact archive masthead v2")) {
  const anchor = "  assert.match(archive, /archive-highlight-card/);";
  if (!tests.includes(anchor)) throw new Error("Archive premium assertion anchor not found");
  tests = tests.replace(anchor, `${anchor}\n  assert.doesNotMatch(archive, /Compact archive masthead v2/);`);
  await writeFile(testsPath, tests);
}

console.log("Removed legacy compact masthead override.");
