from pathlib import Path

path = Path("scripts/visual-audit.mjs")
text = path.read_text()
old = '''  await mobileShareButton.click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".share-layout-canvas-wall .share-layout-poster").first().waitFor({ state: "visible", timeout: 15000 });
  await assertFixedPreviewFits("Mobile share wall");'''
new = '''  await mobileShareButton.click();
  await page.locator(".share-studio-stage").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".share-format-control button").filter({ hasText: "竖版 4:5" }).click();
  await page.locator(".share-preview-area.is-fixed").waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".share-layout-canvas-wall .share-layout-poster").first().waitFor({ state: "visible", timeout: 15000 });
  await assertFixedPreviewFits("Mobile share wall");'''
if old not in text:
    raise SystemExit("Mobile share audit block was not found")
path.write_text(text.replace(old, new, 1))
