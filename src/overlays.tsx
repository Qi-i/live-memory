import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Heart,
  ImagePlus,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import type {
  EventCategory,
  EventRecord,
  EventStatus,
  ImportDraft,
  MediaAsset,
  MediaKind,
} from "./domain";
import {
  categoryLabels,
  createId,
  effectiveStatus,
  formatDateCn,
  mediaByKind,
  mediaKindLabels,
  primaryMedia,
  sourceLabels,
  splitTextList,
  statusLabels,
} from "./domain";
import { createDraftsFromText } from "./importers";
import { fileToMedia, makeMedia, nowIso } from "./media";
import { recognizeTicketScreenshot } from "./ocr";
import type { SyncConflict } from "./supabase";
import { resolveAllConflicts, resolveSyncConflict } from "./supabase";
import type { AppSettings } from "./domain";

function mediaTombstonesAfterRemoval(
  existing: EventRecord["mediaTombstones"],
  removed: MediaAsset[],
) {
  const removedAt = nowIso();
  const byId = new Map((existing || []).map((item) => [item.id, item]));
  for (const asset of removed) {
    const previous = byId.get(asset.id);
    if (!previous || removedAt > previous.deletedAt) {
      byId.set(asset.id, {
        id: asset.id,
        storagePath: asset.storagePath,
        deletedAt: removedAt,
      });
    }
  }
  return Array.from(byId.values());
}

export interface ConfirmAction {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}

export function DetailDrawer({
  record,
  onClose,
  onEdit,
  onDelete,
  onZoom,
  onSave,
}: {
  record: EventRecord;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onZoom: (media: MediaAsset) => void;
  onSave: (record: EventRecord) => Promise<unknown>;
}) {
  const poster = primaryMedia(record);
  const tickets = mediaByKind(record, "ticket");
  const seatMaps = mediaByKind(record, "seatMap");
  const photos = mediaByKind(record, "livePhoto");
  return (
    <div className="overlay-backdrop" role="presentation" onClick={onClose}>
      <aside className="record-detail-v2" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="overlay-header-v2">
          <button type="button" aria-label="关闭" onClick={onClose}><X /></button>
          <div>
            <button type="button" title={record.favorite ? "取消收藏" : "收藏"} onClick={() => void onSave({ ...record, favorite: !record.favorite })}><Heart className={record.favorite ? "is-filled" : ""} /></button>
            <button type="button" title="编辑" onClick={onEdit}><Pencil /></button>
            <button className="is-danger" type="button" title="删除" onClick={onDelete}><Trash2 /></button>
          </div>
        </header>

        <section className="detail-hero-v2">
          <button className="detail-cover-v2" type="button" onClick={() => poster && onZoom(poster)}><OverlayMedia media={poster} alt={record.title} fallback={<ImagePlus />} /></button>
          <div className="detail-copy-v2">
            <span>{categoryLabels[record.category]} · {statusLabels[effectiveStatus(record)]}</span>
            <h2>{record.title}</h2>
            <p>{record.artists.join(" / ") || "艺人待补"}</p>
            <div className="detail-facts-v2">
              <Info label="日期" value={formatDateCn(record.date, record.time)} />
              <Info label="场馆" value={`${record.city || "城市待补"} · ${record.venue || "场馆待补"}`} />
              <Info label="票价" value={record.price ? `¥${record.price}` : record.publicPriceRange || "票价待补"} />
              <Info label="座位" value={record.seat || "座位待补"} />
              <Info label="同行" value={record.companions.join(" / ") || "未记录"} />
              <Info label="来源" value={sourceLabels[record.sourceChannel]} />
            </div>
            {record.sourceUrl && <a className="detail-source-v2" href={record.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink />打开来源页</a>}
          </div>
        </section>

        <MediaSection title="票根" items={tickets} onZoom={onZoom} />
        <MediaSection title="座位图" items={seatMaps} onZoom={onZoom} />
        <MediaSection title="现场精选" items={photos} onZoom={onZoom} />

        <section className="detail-text-v2">
          <header><span>MEMORY NOTES</span><h3>现场记录</h3></header>
          {record.tags.length > 0 && <div>{record.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
          <p>{record.note || "还没有写下演出记录。"}</p>
          {record.setlist.length > 0 && <ol>{record.setlist.map((song) => <li key={song}>{song}</li>)}</ol>}
        </section>
      </aside>
    </div>
  );
}

function MediaSection({ title, items, onZoom }: { title: string; items: MediaAsset[]; onZoom: (media: MediaAsset) => void }) {
  if (!items.length) return null;
  return <section className="detail-media-v2"><header><span>{title}</span><strong>{items.length}</strong></header><div>{items.map((item) => <button key={item.id} type="button" onClick={() => onZoom(item)}><OverlayMedia media={item} alt={item.title || title} /></button>)}</div></section>;
}

type MediaProcessState = "idle" | "processing" | "ready" | "error";

export function RecordEditor({ record, onCancel, onSave }: { record: EventRecord; onCancel: () => void; onSave: (record: EventRecord) => Promise<unknown> }) {
  const [draft, setDraft] = useState(() => ({ ...record, status: effectiveStatus(record) }));
  const [saving, setSaving] = useState(false);
  const [mediaStates, setMediaStates] = useState<Partial<Record<MediaKind, MediaProcessState>>>({});
  const [mediaErrors, setMediaErrors] = useState<Partial<Record<MediaKind, string>>>({});
  const [recognizing, setRecognizing] = useState(false);
  const [recognitionStatus, setRecognitionStatus] = useState("");
  useEffect(() => {
    setDraft({ ...record, status: effectiveStatus(record) });
    setMediaStates({});
    setMediaErrors({});
    setRecognitionStatus("");
  }, [record]);

  async function addFiles(kind: MediaKind, files: FileList | null) {
    if (!files?.length) return;
    setMediaStates((current) => ({ ...current, [kind]: "processing" }));
    setMediaErrors((current) => ({ ...current, [kind]: "" }));
    try {
      const media = await Promise.all(Array.from(files).map((file) => fileToMedia(draft.id, kind, file)));
      setDraft((current) => {
        const replacesExisting = kind === "poster" || kind === "ticket" || kind === "seatMap";
        const removed = replacesExisting ? current.media.filter((item) => item.kind === kind) : [];
        return {
          ...current,
          media: replacesExisting
            ? current.media.filter((item) => item.kind !== kind).concat(media)
            : current.media.concat(media),
          mediaTombstones: removed.length
            ? mediaTombstonesAfterRemoval(current.mediaTombstones, removed)
            : current.mediaTombstones,
        };
      });
      setMediaStates((current) => ({ ...current, [kind]: "ready" }));
    } catch (error) {
      setMediaStates((current) => ({ ...current, [kind]: "error" }));
      setMediaErrors((current) => ({ ...current, [kind]: error instanceof Error ? error.message : "图片处理失败" }));
    }
  }

  function removeMedia(id: string) {
    setDraft((current) => {
      const removed = current.media.filter((item) => item.id === id);
      return {
        ...current,
        media: current.media.filter((item) => item.id !== id),
        mediaTombstones: removed.length
          ? mediaTombstonesAfterRemoval(current.mediaTombstones, removed)
          : current.mediaTombstones,
      };
    });
  }

  function applyRecognizedDraft(imported: ImportDraft) {
    setDraft((current) => mergeImportDraftIntoRecord(current, imported));
    if (imported.importConfidence >= 0.4) {
      setRecognitionStatus(`识别完成 · ${sourceLabels[imported.sourceChannel]} · 置信度 ${Math.round(imported.importConfidence * 100)}%`);
    } else if (imported.posterUrl) {
      setRecognitionStatus("已获取海报，页面其他字段受平台限制，请手动核对");
    } else {
      setRecognitionStatus("链接已保存，但暂未读取到足够的演出信息");
    }
  }

  async function recognizeSourceLink() {
    if (!draft.sourceUrl?.trim()) return;
    setRecognizing(true);
    setRecognitionStatus("正在读取票务页面…");
    try {
      const imported = (await createDraftsFromText(draft.sourceUrl.trim()))[0];
      if (!imported) throw new Error("没有识别到演出信息");
      applyRecognizedDraft(imported);
    } catch (error) {
      setRecognitionStatus(error instanceof Error ? error.message : "链接识别失败");
    } finally {
      setRecognizing(false);
    }
  }

  async function recognizeScreenshot(file?: File) {
    if (!file) return;
    setRecognizing(true);
    setRecognitionStatus("正在准备截图识别…");
    try {
      const recognized = await recognizeTicketScreenshot(file, (progress, status) => {
        setRecognitionStatus(`${status} ${Math.round(progress * 100)}%`);
      });
      const imported = (await createDraftsFromText(recognized))[0];
      if (!imported) throw new Error("截图中没有识别到演出信息");
      applyRecognizedDraft(imported);
    } catch (error) {
      setRecognitionStatus(error instanceof Error ? error.message : "截图识别失败");
    } finally {
      setRecognizing(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (Object.values(mediaStates).some((state) => state === "processing")) return;
    setSaving(true);
    try {
      await onSave({ ...draft, lineup: draft.artists.map((name) => ({ name, role: "artist" })), updatedAt: nowIso() });
    } finally {
      setSaving(false);
    }
  }

  const mediaFor = (kind: MediaKind) => draft.media.filter((item) => item.kind === kind);
  const mediaBusy = Object.values(mediaStates).some((state) => state === "processing");

  return (
    <div className="overlay-backdrop editor-backdrop-v2">
      <form className="record-editor-v2" onSubmit={submit}>
        <header className="editor-header-v2"><div><span>RECORD EDITOR</span><h2>{record.title ? "编辑演出" : "新增演出"}</h2></div><button type="button" aria-label="关闭" onClick={onCancel}><X /></button></header>
        <div className="editor-grid-v2">
          <EditorField className="is-wide" label="演出名称"><input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></EditorField>
          <EditorField className="is-wide" label="艺人 / 阵容"><input value={draft.artists.join(" / ")} onChange={(event) => setDraft({ ...draft, artists: splitTextList(event.target.value) })} placeholder="多个用 / 或 、 分隔" /></EditorField>
          <EditorField label="类型"><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as EventCategory })}>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></EditorField>
          <EditorField label="状态"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as EventStatus })}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></EditorField>
          <EditorField label="日期"><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></EditorField>
          <EditorField label="时间"><input type="time" value={draft.time || ""} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></EditorField>
          <EditorField label="城市"><input value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} /></EditorField>
          <EditorField label="场馆"><input value={draft.venue} onChange={(event) => setDraft({ ...draft, venue: event.target.value })} /></EditorField>
          <EditorField label="票价"><input type="number" value={draft.price ?? ""} onChange={(event) => setDraft({ ...draft, price: event.target.value ? Number(event.target.value) : null })} /></EditorField>
          <EditorField label="公开票价"><input value={draft.publicPriceRange || ""} onChange={(event) => setDraft({ ...draft, publicPriceRange: event.target.value })} /></EditorField>
          <EditorField className="is-wide" label="座位"><input value={draft.seat || ""} onChange={(event) => setDraft({ ...draft, seat: event.target.value })} /></EditorField>
          <EditorField className="is-wide" label="同行人"><input value={draft.companions.join(" / ")} onChange={(event) => setDraft({ ...draft, companions: splitTextList(event.target.value) })} /></EditorField>
          <EditorField className="is-wide" label="标签"><input value={draft.tags.join(" / ")} onChange={(event) => setDraft({ ...draft, tags: splitTextList(event.target.value) })} /></EditorField>
          <EditorField className="is-wide" label="票务链接 / 来源">
            <div className="editor-source-import-v2">
              <input value={draft.sourceUrl || ""} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} placeholder="粘贴大麦、纷玩岛或票星球演出链接" />
              <button className="button ghost" type="button" disabled={recognizing || !draft.sourceUrl?.trim()} onClick={() => void recognizeSourceLink()}>{recognizing ? <Loader2 className="spin" /> : <Sparkles />}识别链接</button>
              <label className="button ghost"><ImagePlus />截图识别<input type="file" accept="image/*" onChange={(event) => void recognizeScreenshot(event.target.files?.[0])} /></label>
            </div>
            {recognitionStatus && <small className="editor-recognition-status-v2">{recognitionStatus}</small>}
          </EditorField>

          <div className="media-upload-grid-v2 is-wide">
            <MediaEditorCard label="主海报" kind="poster" items={mediaFor("poster")} state={mediaStates.poster} error={mediaErrors.poster} onFiles={addFiles} onRemove={removeMedia} />
            <MediaEditorCard label="电子票根" kind="ticket" items={mediaFor("ticket")} state={mediaStates.ticket} error={mediaErrors.ticket} onFiles={addFiles} onRemove={removeMedia} />
            <MediaEditorCard label="座位图" kind="seatMap" items={mediaFor("seatMap")} state={mediaStates.seatMap} error={mediaErrors.seatMap} onFiles={addFiles} onRemove={removeMedia} />
            <MediaEditorCard label="现场精选" kind="livePhoto" items={mediaFor("livePhoto")} state={mediaStates.livePhoto} error={mediaErrors.livePhoto} multiple onFiles={addFiles} onRemove={removeMedia} />
          </div>
          <EditorField className="is-wide" label="曲目"><textarea value={draft.setlist.join("\n")} onChange={(event) => setDraft({ ...draft, setlist: splitTextList(event.target.value) })} /></EditorField>
          <EditorField className="is-wide" label="演出记录"><textarea value={draft.note || ""} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></EditorField>
        </div>
        <footer className="editor-footer-v2"><button className="button ghost" type="button" onClick={onCancel}>取消</button><button className="button primary" disabled={saving || mediaBusy || recognizing} type="submit">{saving ? <Loader2 className="spin" /> : <Check />}{mediaBusy ? "图片正在处理" : "保存记录"}</button></footer>
      </form>
    </div>
  );
}

function EditorField({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) { return <label className={`editor-field-v2 ${className}`}><span>{label}</span>{children}</label>; }

function mergeImportDraftIntoRecord(record: EventRecord, imported: ImportDraft): EventRecord {
  const reliable = imported.importConfidence >= 0.4;
  let media = record.media;
  const mediaSource = imported.sourceChannel === "damai" ? "damai" as const : "external" as const;
  if (imported.posterUrl) {
    media = media.filter((item) => item.kind !== "poster").concat(makeMedia(record.id, "poster", imported.posterUrl, "公开海报", mediaSource));
  }
  if (imported.seatMapUrl) {
    media = media.filter((item) => item.kind !== "seatMap").concat(makeMedia(record.id, "seatMap", imported.seatMapUrl, "座位图", mediaSource));
  }
  return {
    ...record,
    ...(reliable && imported.title ? { title: imported.title } : {}),
    ...(reliable && imported.date ? { date: imported.date, status: imported.status } : {}),
    ...(reliable && imported.time ? { time: imported.time } : {}),
    ...(reliable && imported.city ? { city: imported.city } : {}),
    ...(reliable && imported.venue ? { venue: imported.venue } : {}),
    ...(reliable && imported.address ? { address: imported.address } : {}),
    ...(reliable && imported.artists.length ? { artists: imported.artists, lineup: imported.artists.map((name) => ({ name, role: "artist" as const })) } : {}),
    ...(reliable && imported.publicPriceRange ? { publicPriceRange: imported.publicPriceRange } : {}),
    sourceChannel: imported.sourceChannel || record.sourceChannel,
    sourceUrl: imported.sourceUrl || record.sourceUrl,
    importConfidence: imported.importConfidence,
    media,
  };
}

function MediaEditorCard({
  label, kind, items, state = "idle", error, multiple, onFiles, onRemove,
}: {
  label: string;
  kind: MediaKind;
  items: MediaAsset[];
  state?: MediaProcessState;
  error?: string;
  multiple?: boolean;
  onFiles: (kind: MediaKind, files: FileList | null) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const status = state === "processing" ? "正在处理…" : state === "error" ? "处理失败" : items.length ? `已就绪 · ${items.length} 张` : "尚未添加";
  return <article className={`media-editor-card-v2 is-${state}`}>
    <header><strong>{label}</strong><span>{status}</span></header>
    <div className="media-editor-thumbs-v2">
      {items.length ? items.slice(0, 3).map((item) => <figure key={item.id}>
        <OverlayMedia media={item} alt={item.title || label} />
        <button type="button" aria-label={`移除${label}`} onClick={() => onRemove(item.id)}><X /></button>
      </figure>) : <span className="media-editor-empty-v2"><ImagePlus />暂无{label}</span>}
      {items.length > 3 && <span className="media-editor-more-v2">+{items.length - 3}</span>}
    </div>
    <footer>
      <label><Upload />{items.length && kind !== "livePhoto" ? "更换" : "选择图片"}<input type="file" accept="image/*" multiple={multiple} onChange={(event) => void onFiles(kind, event.target.files)} /></label>
      {error && <small>{error}</small>}
    </footer>
  </article>;
}

export function ImportDrawer({ onClose, onSave, flash }: { onClose: () => void; onSave: (record: EventRecord) => Promise<unknown>; flash: (message: string) => void }) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState("");

  function updateDraft(id: string, patch: Partial<ImportDraft>) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  }

  async function parse() {
    setLoading(true);
    try {
      const next = await createDraftsFromText(text);
      setDrafts(next);
      flash(`生成 ${next.length} 条草稿`);
    } finally {
      setLoading(false);
    }
  }

  async function importImages(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const record = blankImportedRecord(file.name.replace(/\.[^.]+$/, ""));
      record.media = [await fileToMedia(record.id, "poster", file)];
      await onSave(record);
    }
    flash(`已导入 ${files.length} 张图片草稿`);
  }


  async function importScreenshots(files: FileList | null) {
    if (!files?.length) return;
    setLoading(true);
    setOcrProgress("正在准备截图识别…");
    try {
      const nextDrafts: ImportDraft[] = [];
      for (const file of Array.from(files)) {
        const recognized = await recognizeTicketScreenshot(file, (progress, status) => setOcrProgress(`${status} ${Math.round(progress * 100)}%`));
        nextDrafts.push(...await createDraftsFromText(recognized));
      }
      setDrafts(nextDrafts);
      flash(`已从 ${files.length} 张截图识别 ${nextDrafts.length} 条草稿`);
    } finally {
      setLoading(false);
      setOcrProgress("");
    }
  }

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <aside className="import-drawer-v2" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="editor-header-v2"><div><span>BATCH IMPORT</span><h2>批量添加</h2></div><button type="button" onClick={onClose}><X /></button></header>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="粘贴大麦、纷玩岛、票星球演出链接，或票务页文字。也可直接使用下方截图识别。" />
        <div className="import-actions-v2"><button className="button primary" disabled={loading || !text.trim()} type="button" onClick={() => void parse()}>{loading ? <Loader2 className="spin" /> : <Sparkles />}识别链接/文字</button><label className="button ghost"><ImagePlus />截图识别<input type="file" accept="image/*" multiple onChange={(event) => void importScreenshots(event.target.files)} /></label><label className="button ghost"><Upload />海报导入<input type="file" accept="image/*" multiple onChange={(event) => void importImages(event.target.files)} /></label>{ocrProgress && <span className="import-ocr-progress-v2">{ocrProgress}</span>}</div>
        <div className="import-drafts-v2">
          {drafts.map((draft) => (
            <article key={draft.id}>
              <div className="import-draft-poster-v2">
                {draft.posterUrl ? <img src={draft.posterUrl} alt="" /> : <span><ImagePlus />海报待补</span>}
              </div>
              <div className="import-draft-copy-v2">
                <span>{categoryLabels[draft.category]} · 置信度 {Math.round(draft.importConfidence * 100)}%{draft.seatMapUrl ? " · 已识别座位图" : ""}</span>
                <input className="import-draft-title-v2" value={draft.title} onChange={(event) => updateDraft(draft.id, { title: event.target.value })} aria-label="演出名称" />
                <p>{draft.city || "城市待补"} · {draft.venue || "场馆待补"}{draft.publicPriceRange ? ` · 公开票价 ${draft.publicPriceRange}` : ""}</p>
                <div className="import-draft-fields-v2">
                  <label>日期<input type="date" value={draft.date} onChange={(event) => updateDraft(draft.id, { date: event.target.value })} /></label>
                  <label>时间<input type="time" value={draft.time || ""} onChange={(event) => updateDraft(draft.id, { time: event.target.value })} /></label>
                  <label>本人票价<input type="number" min="0" value={draft.price ?? ""} onChange={(event) => updateDraft(draft.id, { price: event.target.value ? Number(event.target.value) : null })} placeholder="可修改" /></label>
                </div>
              </div>
              <button className="button primary" type="button" onClick={() => void onSave(draftToRecord(draft))}>加入档案</button>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

export function ImageZoom({ media, onClose }: { media: MediaAsset; onClose: () => void }) {
  return <div className="image-zoom-v2" onClick={onClose}><button type="button" aria-label="关闭" onClick={onClose}><X /></button><img src={media.src} alt={media.title || ""} onClick={(event) => event.stopPropagation()} /><div><a className="button primary" href={media.src} download={media.title || "live-memory-image"}><Download />下载</a><button className="button ghost" type="button" onClick={(event) => { event.stopPropagation(); void navigator.clipboard?.writeText(media.src); }}><Copy />复制地址</button></div></div>;
}

export function ConfirmDialog({ action, onClose }: { action: ConfirmAction; onClose: () => void }) {
  const [working, setWorking] = useState(false);
  async function confirm() { setWorking(true); try { await action.onConfirm(); onClose(); } finally { setWorking(false); } }
  return <div className="dialog-backdrop-v2" onClick={onClose}><section className="confirm-dialog-v2" role="alertdialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><span><Trash2 /></span><h2>{action.title}</h2><p>{action.message}</p><div><button className="button ghost" type="button" disabled={working} onClick={onClose}>取消</button><button className={`button ${action.danger ? "danger" : "primary"}`} type="button" disabled={working} onClick={() => void confirm()}>{working ? <Loader2 className="spin" /> : <Trash2 />}{action.confirmLabel}</button></div></section></div>;
}

export function SyncConflictDialog({ conflicts, settings, onResolve, onDismiss }: { conflicts: SyncConflict[]; settings: AppSettings; onResolve: (resolved: EventRecord[]) => Promise<void>; onDismiss: () => void }) {
  const [working, setWorking] = useState(false);
  const [remaining, setRemaining] = useState(conflicts);
  useEffect(() => setRemaining(conflicts), [conflicts]);
  async function resolveOne(conflict: SyncConflict, choice: "local" | "cloud") { setWorking(true); try { const resolved = await resolveSyncConflict(settings, conflict, choice); const next = remaining.filter((item) => item.recordId !== conflict.recordId); setRemaining(next); if (!next.length) await onResolve([resolved]); } finally { setWorking(false); } }
  async function resolveAll(choice: "local" | "cloud") { setWorking(true); try { const resolved = await resolveAllConflicts(settings, remaining, choice); setRemaining([]); await onResolve(resolved); } finally { setWorking(false); } }
  return <div className="dialog-backdrop-v2" onClick={onDismiss}><section className="conflict-dialog-v2" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><header><span>SYNC CONFLICT</span><h2>{remaining.length} 条记录同时被修改</h2><p>选择本地或云端版本，不再静默覆盖。</p></header>{remaining.length > 1 && <div className="conflict-bulk-v2"><button className="button ghost" disabled={working} type="button" onClick={() => void resolveAll("local")}>全部保留本地</button><button className="button ghost" disabled={working} type="button" onClick={() => void resolveAll("cloud")}>全部保留云端</button></div>}<div>{remaining.map((conflict) => <article key={conflict.recordId}><strong>{conflict.title}</strong><p>本地：{new Date(conflict.localUpdatedAt).toLocaleString("zh-CN")}<br />云端：{new Date(conflict.cloudUpdatedAt).toLocaleString("zh-CN")}</p><div><button className="button primary" disabled={working} type="button" onClick={() => void resolveOne(conflict, "local")}>保留本地</button><button className="button ghost" disabled={working} type="button" onClick={() => void resolveOne(conflict, "cloud")}>保留云端</button></div></article>)}</div><footer><button className="button ghost" type="button" disabled={working} onClick={onDismiss}>稍后处理</button></footer></section></div>;
}

function OverlayMedia({ media, alt, fallback = "图片待补" }: { media?: MediaAsset; alt?: string; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [media?.src]);
  if (!media?.src || failed) return <span className="overlay-media-fallback">{media?.storagePath ? "云端图片待刷新" : fallback}</span>;
  return <img src={media.src} alt={alt || ""} loading="lazy" decoding="async" onError={() => { setFailed(true); if (media.storagePath) window.dispatchEvent(new Event("live-memory:cloud-media-refresh")); }} />;
}

function Info({ label, value }: { label: string; value: string }) { return <p><span>{label}</span><strong>{value}</strong></p>; }

function blankImportedRecord(title: string): EventRecord {
  const timestamp = nowIso();
  return { schemaVersion: 2, id: createId("record"), title, category: "concert", status: "watched", recordState: "normal", date: new Date().toISOString().slice(0, 10), city: "", venue: "", artists: [], lineup: [], price: null, companions: [], tags: [], setlist: [], sourceChannel: "", media: [], favorite: false, colors: ["#101418", "#dfff4f"], createdAt: timestamp, updatedAt: timestamp };
}

function draftToRecord(draft: ImportDraft): EventRecord {
  const record = blankImportedRecord(draft.title);
  const media: MediaAsset[] = [];
  const mediaSource = draft.sourceChannel === "damai" ? "damai" as const : "external" as const;
  if (draft.posterUrl) media.push(makeMedia(record.id, "poster", draft.posterUrl, "公开海报", mediaSource));
  if (draft.seatMapUrl) media.push(makeMedia(record.id, "seatMap", draft.seatMapUrl, "座位图", mediaSource));
  return { ...record, category: draft.category, status: draft.status, date: draft.date, time: draft.time, city: draft.city, venue: draft.venue, address: draft.address, artists: draft.artists, lineup: draft.artists.map((name) => ({ name, role: "artist" })), price: draft.price ?? null, publicPriceRange: draft.publicPriceRange, note: draft.note, sourceChannel: draft.sourceChannel, sourceUrl: draft.sourceUrl, importConfidence: draft.importConfidence, media };
}
