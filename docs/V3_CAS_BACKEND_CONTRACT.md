# V3 server CAS and safe migration review

Status: review-only document. This is NOT a migration, and must NOT be applied directly to the production database.

## Verified existing schema

- public.echo_passkey_records: composite key (owner_key,id), JSONB payload, existing owner-key header RLS, complete personal-cloud records.
- public.echo_passkey_media_assets: per-owner private media indexes, linked to record IDs; private object storage remains separate.
- public.echo_text_backups: composite key (user_id,id), auth.uid ownership RLS, text-only account backup.
- None of these tables currently exposes v3_revision. The new client intentionally rejects records without a valid version.

## Required server protocol

The V3 client expects exactly these atomic server functions:

- live_memory_v3_cas_personal(p_id text, p_payload jsonb, p_expected_revision bigint)
- live_memory_v3_cas_account(p_id text, p_payload jsonb, p_expected_revision bigint)

Return exactly one row: id, payload, v3_revision.

Create requires expected=null and a missing ID. Update requires the server's actual acknowledged revision. Revision mismatches return a recognizable V3_REVISION_CONFLICT error, never an unconditional upsert fallback.

1. Introduce v3_revision as a positive monotonic integer without deleting or changing V2 payloads. Existing rows still have UNKNOWN historical baseline until read-only reconciliation.
2. Ensure UPDATEs made through legacy V2 clients ALSO increment v3_revision. Otherwise CAS would incorrectly accept writes while legacy clients change the same row.
3. Perform read/compare/write/return within a single PostgreSQL transaction. Enforce insert races using existing composite primary keys and update races using revision preconditions.
4. Use SECURITY INVOKER with a fixed search_path. Rely on existing row-level security for owner-key personal cloud and auth.uid account cloud. Do not accept an arbitrary owner or user identity that could bypass RLS. Audit EXECUTE privileges, including PUBLIC, anon and authenticated.
5. Account cloud must never receive private images, media tombstones or ticket scans. Personal-cloud record/media indexes require aggregate revision semantics; object uploads happen outside Postgres, so use staged uploads, transactional metadata commit and orphan cleanup.
6. A remote missing record cannot be interpreted as a deletion without a tombstone. Old devices with no common baseline must complete a migration check instead of choosing the later timestamp.
7. Create and verify a full backup, then read-only per-ID reconciliation, isolated backend CAS integration tests, two-device races, V2/V3 mixed-client tests, offline retries, rollback, and user-account scope fences BEFORE switching production writes.

## Current safe implementation

- src/core/ports/CloudRecordAdapter.ts: server revision and CAS are mandatory.
- src/infrastructure/supabase/V3CloudRecordAdapter.ts: two fixed RPCs, no unconditional upserts; fails closed if schema lacks revisions; text-only backup media protection.
- src/core/application/auditSyncReadOnly.ts: migration diagnostic that returns only counts, never record text or IDs; performs no writes or baseline acknowledgements.
- scripts/core-v3-cloud-adapter-tests.mjs and scripts/core-v3-readonly-audit-tests.mjs: deterministic simulated CAS, privacy, fail-closed and audit tests.

These tests do NOT prove backend RLS or real PostgreSQL concurrency: a separate Supabase TEST project is required. Do not run unreviewed schema changes on the user's active database.

UI preview has its own demo-only static site and can be shipped independently from these backend migrations. Production Web and Android share the future domain/application core. Android real-device testing and release-package creation precede signing; signing remains the user's final step.
