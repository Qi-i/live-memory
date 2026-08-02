from pathlib import Path

path = Path("src/shareStudio.tsx")
text = path.read_text()
old = "const requestedSpan = index === 0 ? (records.length <= 8 ? columns : Math.min(3, columns)) : index < 3 ? Math.min(2, columns - 1) : 1;"
new = "const compactMagazine = records.length <= 8;\n    const requestedSpan = index === 0 ? Math.min(compactMagazine ? 2 : 3, columns) : compactMagazine ? 1 : index < 3 ? Math.min(2, columns - 1) : 1;"
if old not in text:
    raise SystemExit("Current magazine span expression was not found")
path.write_text(text.replace(old, new, 1))
