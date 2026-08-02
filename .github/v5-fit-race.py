from pathlib import Path

studio = Path("src/shareStudio.tsx")
text = studio.read_text()
text = text.replace("  useEffect,\n  useMemo,", "  useEffect,\n  useLayoutEffect,\n  useMemo,", 1)
old_observer = '''  useEffect(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    recalculateFit();
    const observer = new ResizeObserver(recalculateFit);
    observer.observe(area);
    return () => observer.disconnect();
  }, [recalculateFit]);

  useEffect(() => {
    setManualScale(null);
  }, [format, layout, selectedRecords.length]);'''
new_observer = '''  useLayoutEffect(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    setManualScale(null);
    recalculateFit();
    const observer = new ResizeObserver(recalculateFit);
    observer.observe(area);
    return () => observer.disconnect();
  }, [format, layout, recalculateFit, selectedRecords.length]);'''
if old_observer not in text:
    raise SystemExit("Fit effects block was not found")
text = text.replace(old_observer, new_observer, 1)
studio.write_text(text)

audit = Path("scripts/visual-audit.mjs")
text = audit.read_text()
needle = '''async function assertFixedPreviewFits(label) {
  const geometry = await page.locator(".share-preview-area.is-fixed").evaluate((area) => {'''
replacement = '''async function assertFixedPreviewFits(label) {
  await page.waitForFunction(() => {
    const area = document.querySelector(".share-preview-area.is-fixed");
    const viewport = area?.querySelector(".share-preview-viewport");
    if (!(area instanceof HTMLElement) || !(viewport instanceof HTMLElement)) return false;
    const areaRect = area.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    return viewportRect.left >= areaRect.left - 2
      && viewportRect.top >= areaRect.top - 2
      && viewportRect.right <= areaRect.right + 2
      && viewportRect.bottom <= areaRect.bottom + 2;
  }, null, { timeout: 5000 });
  const geometry = await page.locator(".share-preview-area.is-fixed").evaluate((area) => {'''
if needle not in text:
    raise SystemExit("Visual fit assertion function was not found")
text = text.replace(needle, replacement, 1)
audit.write_text(text)
