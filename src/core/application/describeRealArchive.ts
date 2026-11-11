import { effectiveStatus, type EventRecord } from "../../domain";

/** Shared read-model for the real V3 archive; no React or network dependencies. */
export interface RealArchiveCity { city: string; total: number; watched: number }
export interface RealArchiveReadModel {
  records: EventRecord[];
  watchedCount: number;
  cities: RealArchiveCity[];
  years: Array<{ year: string; total: number }>;
  mediaCount: number;
}
export function isWatchedRealRecord(record: EventRecord, now = new Date()): boolean {
  return !record.deletedAt &&
    effectiveStatus(record, now) === "watched" &&
    record.recordState !== "cancelled" &&
    record.recordState !== "refunded";
}
export function describeRealArchive(records: readonly EventRecord[], search = "", now = new Date()): RealArchiveReadModel {
  const q = search.trim().toLocaleLowerCase();
  const included = records
    .filter(row => !row.deletedAt)
    .filter(row => !q || [
      row.title, row.city, row.venue, row.date, row.status, row.recordState,
      ...row.artists, ...row.tags,
    ].some(value => String(value || "").toLocaleLowerCase().includes(q)))
    .sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const byCity = new Map<string,RealArchiveCity>();
  const byYear = new Map<string,number>();
  let mediaCount = 0;
  let watchedCount = 0;
  for (const row of included) {
    if (isWatchedRealRecord(row, now)) watchedCount += 1;
    mediaCount += row.media.length;
    if (row.city.trim()) {
      const city = row.city.trim();
      const item = byCity.get(city) || {city,total:0,watched:0};
      item.total += 1;
      if (isWatchedRealRecord(row, now)) item.watched += 1;
      byCity.set(city,item);
    }
    if (/^\d{4}-/.test(row.date)) {
      const year = row.date.slice(0,4);
      byYear.set(year,(byYear.get(year)||0)+1);
    }
  }
  return {
    records:included, watchedCount, mediaCount,
    cities:[...byCity.values()].sort((a,b)=>b.total-a.total || a.city.localeCompare(b.city,"zh")),
    years:[...byYear].map(([year,total])=>({year,total})).sort((a,b)=>b.year.localeCompare(a.year)),
  };
}
