import { createId, type EventRecord } from "./domain";

export function duplicateRecordForNextShow(record: EventRecord, now = new Date()): EventRecord {
  const id = createId("record");
  const timestamp = now.toISOString();
  return {
    ...record,
    id,
    status: "planned",
    recordState: "normal",
    date: nextIsoDate(record.date),
    seat: undefined,
    artists: [...record.artists],
    lineup: record.lineup.map((item) => ({ ...item })),
    companions: [],
    tags: [...record.tags],
    setlist: [],
    note: undefined,
    media: record.media
      .filter((asset) => asset.kind === "poster")
      .map((asset) => ({
        ...asset,
        id: createId("media"),
        recordId: id,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: undefined,
    syncedAt: undefined,
  };
}

function nextIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
