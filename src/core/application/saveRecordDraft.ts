import type { EventRecord } from "../../domain";
import { LocalRevisionChanged, type RecordRepository } from "../ports/RecordRepository";

export type SaveDraftResult =
  | { status: "saved"; recordId: string }
  | { status: "review-required"; recordId: string; reason: "edited-elsewhere" };

/**
 * Single entry for a draft edit. Pages do not upsert entire snapshots or
 * decide which version wins. A concurrent edit returns a recoverable state and
 * keeps the user's draft intact until they explicitly compare/retry.
 */
export async function saveRecordDraft(
  repository: RecordRepository,
  draft: EventRecord,
  openedVersion: EventRecord | null,
): Promise<SaveDraftResult> {
  if (openedVersion && openedVersion.id !== draft.id) {
    throw new Error("Cannot save a draft using another record's baseline");
  }
  if (!draft.id.trim() || !draft.title.trim()) {
    throw new Error("Record identity and event name are required");
  }
  try {
    await repository.saveIfUnchanged(draft, openedVersion);
    return { status: "saved", recordId: draft.id };
  } catch (error) {
    if (error instanceof LocalRevisionChanged) {
      return { status: "review-required", recordId: draft.id, reason: "edited-elsewhere" };
    }
    throw error;
  }
}
