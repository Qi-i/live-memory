import { readFile, writeFile } from "node:fs/promises";
const path = "src/statsPage.tsx";
const before = await readFile(path, "utf8");
const needle = 'import "./refinementV3.css";';
if (!before.includes(needle)) throw new Error("refinementV3 import not found");
const after = before.replace(needle, `${needle}\nimport "./refinementV3Hotfix.css";`);
await writeFile(path, after);
