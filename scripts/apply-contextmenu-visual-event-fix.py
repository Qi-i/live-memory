from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "scripts/visual-audit.mjs"
text = path.read_text(encoding="utf-8")
old = '  await page.locator(".archive-poster-card").first().click({ button: "right" });\n'
new = '  await page.locator(".archive-poster-card").first().dispatchEvent("contextmenu", { button: 2, bubbles: true, cancelable: true, clientX: 420, clientY: 320 });\n'
if old not in text:
    raise SystemExit("visual audit right-click target missing")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Updated visual audit to dispatch the native contextmenu event")
