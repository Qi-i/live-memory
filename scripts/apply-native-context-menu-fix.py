from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f"missing replacement target: {label}")
    return text.replace(old, new, 1)

path = "src/archive.tsx"
text = read(path)
old = '''  useEffect(() => {
    if (!contextMenu) return;
    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".archive-context-menu")) return;
      setContextMenu(null);
    };
    const close = () => setContextMenu(null);
    const closeFromKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", closeFromPointer);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeFromKey);
    return () => {
      window.removeEventListener("pointerdown", closeFromPointer);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeFromKey);
    };
  }, [contextMenu]);

  function handleArchiveContextMenu(event: MouseEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target : null;
    const host = target?.closest<HTMLElement>("[data-archive-record-id]");
    const record = host ? records.find((item) => item.id === host.dataset.archiveRecordId) : undefined;
    if (!record) return;
    event.preventDefault();
    event.stopPropagation();
    const width = 220;
    const height = 222;
    setContextMenu({
      record,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    });
  }
'''
new = '''  useEffect(() => {
    const open = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const host = target?.closest<HTMLElement>("[data-archive-record-id]");
      if (!host?.closest(".archive-page")) return;
      const record = records.find((item) => item.id === host.dataset.archiveRecordId);
      if (!record) return;
      event.preventDefault();
      event.stopPropagation();
      const width = 220;
      const height = 222;
      setContextMenu({
        record,
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      });
    };
    document.addEventListener("contextmenu", open);
    return () => document.removeEventListener("contextmenu", open);
  }, [records]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".archive-context-menu")) return;
      setContextMenu(null);
    };
    const close = () => setContextMenu(null);
    const closeFromKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", closeFromPointer);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeFromKey);
    return () => {
      window.removeEventListener("pointerdown", closeFromPointer);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeFromKey);
    };
  }, [contextMenu]);
'''
text = replace_once(text, old, new, "native context menu behavior")
text = replace_once(text, '<section className="archive-page" onContextMenu={handleArchiveContextMenu}>', '<section className="archive-page">', "remove delegated react handler")
write(path, text)

path = "scripts/archive-context-menu-tests.mjs"
text = read(path)
text = replace_once(text, '  assert.match(archive, /onContextMenu/);', '  assert.match(archive, /addEventListener\\("contextmenu"/);', "native event contract")
write(path, text)

print("Applied native archive context menu listener")
