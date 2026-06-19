import { EventRecord } from "./domain";
import { normalizeRecord } from "./storage";

export function withoutLocalMedia(record: EventRecord): EventRecord {
  return normalizeRecord({ ...record, media: [] });
}

export function mergeTextBackup(localRecords: EventRecord[], cloudRecords: EventRecord[]) {
  const localById = new Map(localRecords.map((record) => [record.id, record]));
  const merged = new Map(localById);
  cloudRecords.forEach((cloudRecord) => {
    const local = localById.get(cloudRecord.id);
    if (!local) {
      merged.set(cloudRecord.id, withoutLocalMedia(cloudRecord));
      return;
    }
    if (cloudRecord.updatedAt > local.updatedAt) {
      merged.set(cloudRecord.id, normalizeRecord({ ...cloudRecord, media: local.media }));
    }
  });
  return Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date));
}
