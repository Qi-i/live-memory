export function normalizeLegacyAssetUrl(src?: string) {
  const value = String(src || "").trim();
  if (!value) return "";
  if (/assets\/imported-posters\//.test(value)) return "";
  if (/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(value)) return value;
  if (/^blob:/i.test(value)) return value;
  if (/^(?:\/|\.\/|\.\.\/)/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}


const DAMAI_POSTER_FALLBACKS: Record<string, string> = {
  "1060966698015": "https://img1.tking.cn/mtl/default/img/2026/7/10/pRGMtzBCAN_.jpg?x-oss-process=image%2Fresize%2Cw_1200%2Fquality%2Cq_90",
  "1064771079264": "https://img1.tking.cn/mtl/default/img/2026/7/15/Yxe44itf5e_.jpg?x-oss-process=image%2Fresize%2Cw_1200%2Fquality%2Cq_90",
};

const DAMAI_SEAT_MAP_FALLBACKS: Record<string, string> = {
  "1064771079264": "https://inews.gtimg.com/om_bt/Oh4MIEz8I0RJLjTyQ8NobPmkL36jp_ZZGjBLyRMdNdhG0AA/641",
};

export function knownDamaiMedia(itemId: string) {
  return {
    posterUrl: normalizeLegacyAssetUrl(DAMAI_POSTER_FALLBACKS[itemId]),
    seatMapUrl: normalizeLegacyAssetUrl(DAMAI_SEAT_MAP_FALLBACKS[itemId]),
  };
}
