import { readFile, writeFile } from "node:fs/promises";

const path = "src/shareStudio.tsx";
let source = await readFile(path, "utf8");
source = source.replace("  Image as ImageIcon,\n", "");
source = source.replace(
  '  const latestDate = eligibleRecords.at(-1)?.date || "";',
  '  const latestDate = eligibleRecords.length ? eligibleRecords[eligibleRecords.length - 1].date : "";',
);
source = source.replace(
  "    setStartDate((current) => current || earliestDate);",
  "    setStartDate((current: string) => current || earliestDate);",
);
source = source.replace(
  "    setEndDate((current) => current || latestDate);",
  "    setEndDate((current: string) => current || latestDate);",
);
source = source.replace(
  "    setSelectedIds((current) => {",
  "    setSelectedIds((current: Set<string>) => {",
);
source = source.replace(
  "    setSelectedIds((current) => {\n      const next = new Set(current);",
  "    setSelectedIds((current: Set<string>) => {\n      const next = new Set(current);",
);
source = source.replace("setSelectedIds(new Set())", "setSelectedIds(new Set<string>())");
source = source.replace(
  "  const last = dates.at(-1) || first;",
  "  const last = dates[dates.length - 1] || first;",
);
if (source.includes(".at(-1)")) throw new Error("Unsupported Array.at remains");
if (source.includes("Image as ImageIcon")) throw new Error("Unused ImageIcon import remains");
await writeFile(path, source);
console.log("Mass share TypeScript compatibility fixed.");
