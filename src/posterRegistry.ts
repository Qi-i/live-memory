export function normalizeLegacyAssetUrl(src?: string) {
  const value = String(src || "").trim();
  if (!value) return "";
  if (/assets\/imported-posters\//.test(value)) return "";
  if (/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(value)) return value;
  if (/^blob:/i.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}
