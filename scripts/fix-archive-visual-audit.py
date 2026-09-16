from pathlib import Path

path = Path("scripts/visual-audit.mjs")
text = path.read_text(encoding="utf-8")
old = '''  bannerCards.forEach((card, index) => {\n    if (card.objectFit !== "contain") throw new Error(`Banner poster ${index + 1} is cropped with ${card.objectFit}`);\n    assertContained(`Banner poster ${index + 1}`, card, mastheadBounds, 3);\n  });'''
new = '''  bannerCards.forEach((card, index) => {\n    if (card.objectFit !== "cover") throw new Error(`Banner poster ${index + 1} does not fill its frame with ${card.objectFit}`);\n    assertContained(`Banner poster ${index + 1}`, card, mastheadBounds, 3);\n  });'''
if old not in text:
    raise SystemExit("outdated banner object-fit assertion not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Updated banner visual assertion from contain to cover")
