export function normalizeLegacyAssetUrl(src?: string) {
  if (!src) return "";
  if (/assets\/imported-posters\//.test(src)) return "";
  return src;
}
