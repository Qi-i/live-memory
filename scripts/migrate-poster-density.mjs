import { readFile, writeFile } from "node:fs/promises";

async function patch(path, from, to) {
  const before = await readFile(path, "utf8");
  if (!before.includes(from)) throw new Error(`Pattern not found in ${path}`);
  await writeFile(path, before.replace(from, to));
}

await patch(
  "src/archive.tsx",
  "Math.min(8, Math.max(4, settings.posterColumns || 5))",
  "Math.min(8, Math.max(5, settings.posterColumns || 5))",
);

await patch(
  "scripts/visual-audit.mjs",
  "if (firstRowCount < 4) throw new Error(`Desktop poster grid rendered only ${firstRowCount} columns`);",
  "if (firstRowCount < 5) throw new Error(`Desktop poster grid rendered only ${firstRowCount} columns`);",
);
