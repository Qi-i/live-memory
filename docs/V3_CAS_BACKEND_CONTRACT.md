# V3 server CAS and safe migration review

Status: **backend contract review, updated after production metadata-only read on 2026-11-18**. This is NOT an executable migration and must not be applied directly to production. The verified presence of database functions is not the same as acceptance of real user records, exact media recovery or mixed-device behavior.

## Verified existing schema

- public.echo_passkey_records: composite key (owner_key,id), JSONB payload, existing owner-key header RLS, complete personal-cloud records.
- public.echo_passkey_media_assets: per-owner private media indexes, linked to record IDs; private object storage remains separate.
- public.echo_text_backups: composite key (user_id,id), auth.uid ownership RLS, text-only account backup.
- **Production metadata check 2026-11-18:** `echo_passkey_records`, `echo_text_backups`, and `live_memory_v3_secure_records` all have `v3_revision BIGINT`. The first two retain V2 UPDATE triggers that advance the revision; the secure table has its own CAS guard. This observation corrects the former *pre-migration* description and does not claim a successful historical media migration.

### Verified production metadata (read-only SQL, no rows or private content queried)

| Check | Observed result |
| --- | --- |
| V3 CAS callable functions | Four: `live_memory_v3_cas_personal`, `live_memory_v3_cas_account`, `live_memory_v3_cas_account_scoped`, `live_memory_v3_cas_secure_account` |
| Execution mode | All four `SECURITY INVOKER`, each fixed `search_path=pg_catalog` |
| Revision preconditions | All four function definitions contain the expected-revision guard |
| `authenticated` EXECUTE | Granted on all four CAS functions |
| `anon` EXECUTE | Only `cas_personal`, which follows the separate owner-key personal-cloud model; never treat this as a general account-cloud authorization |
| PUBLIC EXECUTE | Not granted on any of the four |
| Legacy V2 write paths | Personal/account tables have row-level revision triggers with `OLD.v3_revision + 1` |
| Secure V3 table | `v3_revision` column and authenticated CAS guard trigger exist |
| Live auth flow and real-device CAS | **NOT RUN**, requires actual independent write tests and verified backups |

This result verifies only the deployed **database structure**, not that every client always uses the correct RPC, not that authenticated RLS is correctly enforced for a tested user, and not that an old web tab cannot race a new native device. Do not perform production data writes merely to turn these NOT RUN cases into PASS.

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
