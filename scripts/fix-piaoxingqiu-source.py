from pathlib import Path

path = Path("src/domain.ts")
text = path.read_text(encoding="utf-8")
old = '  if (source === "damai" || source === "fenwandao" || source === "maoyan" || source === "official" || source === "onsite" || source === "transfer" || source === "other") {'
new = '  if (source === "damai" || source === "fenwandao" || source === "piaoxingqiu" || source === "maoyan" || source === "official" || source === "onsite" || source === "transfer" || source === "other") {'
if old not in text:
    raise SystemExit("normalizeSource target not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Preserved piaoxingqiu in normalizeSource")
