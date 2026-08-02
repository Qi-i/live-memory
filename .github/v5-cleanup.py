from pathlib import Path

path = Path("src/shareStudio.tsx")
text = path.read_text()
block = '''function centerSlots(slots: PosterSlot[], area: Rect) {
  if (!slots.length) return slots;
  const top = Math.min(...slots.map((slot) => slot.rect.y));
  const bottom = Math.max(...slots.map((slot) => slot.rect.y + slot.rect.height));
  const offsetY = Math.max(0, (area.height - (bottom - top)) / 2);
  return slots.map((slot) => ({ ...slot, rect: { ...slot.rect, y: slot.rect.y + offsetY } }));
}

'''
if block not in text:
    raise SystemExit("Unused centerSlots block was not found")
path.write_text(text.replace(block, "", 1))
