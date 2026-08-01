import { readFile, writeFile } from "node:fs/promises";

const tsPath = "src/shareStudio.tsx";
let ts = await readFile(tsPath, "utf8");
const tsBefore = `  const previewStyle = {\n    "--share-columns": gridSpec.columns,\n    "--share-preview-ratio": \`${"${gridSpec.width} / ${gridSpec.height}"}\`,\n  } as CSSProperties;`;
const tsAfter = `  const previewStyle = {\n    "--share-columns": gridSpec.columns,\n    "--share-rows": gridSpec.rows,\n    "--share-preview-ratio": \`${"${gridSpec.width} / ${gridSpec.height}"}\`,\n  } as CSSProperties;`;
if (!ts.includes(tsBefore)) throw new Error("Preview style anchor not found");
ts = ts.replace(tsBefore, tsAfter);
await writeFile(tsPath, ts);

const cssPath = "src/shareStudio.css";
let css = await readFile(cssPath, "utf8");
const gridBefore = `.share-preview-posters {\n  display: grid;\n  grid-template-columns: repeat(var(--share-columns), minmax(0, 1fr));\n  gap: clamp(3px, 0.55vw, 10px);\n  min-height: 0;\n  align-content: center;\n  padding: 0 clamp(18px, 3.2vw, 48px);\n}`;
const gridAfter = `.share-preview-posters {\n  display: grid;\n  grid-template-columns: repeat(var(--share-columns), minmax(0, 1fr));\n  grid-template-rows: repeat(var(--share-rows), minmax(0, 1fr));\n  gap: clamp(3px, 0.55vw, 10px);\n  min-height: 0;\n  align-content: stretch;\n  overflow: hidden;\n  padding: 0 clamp(18px, 3.2vw, 48px);\n}`;
if (!css.includes(gridBefore)) throw new Error("Preview grid anchor not found");
css = css.replace(gridBefore, gridAfter);
const figureBefore = `.share-preview-posters figure {\n  position: relative;\n  width: 100%;\n  aspect-ratio: 2 / 3;\n  margin: 0;\n  overflow: hidden;`;
const figureAfter = `.share-preview-posters figure {\n  position: relative;\n  width: auto;\n  max-width: 100%;\n  height: 100%;\n  aspect-ratio: 2 / 3;\n  justify-self: center;\n  margin: 0;\n  overflow: hidden;`;
if (!css.includes(figureBefore)) throw new Error("Preview figure anchor not found");
css = css.replace(figureBefore, figureAfter);
await writeFile(cssPath, css);
console.log("Mass share preview now fits all rows and columns.");
