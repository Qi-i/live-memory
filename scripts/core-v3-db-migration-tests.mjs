import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/015_v3_cas_revision.sql", import.meta.url), "utf8",
);
assert.match(sql, /alter table public\.echo_text_backups\s+add column if not exists v3_revision bigint not null default 1/i);
assert.match(sql, /alter table public\.echo_passkey_records\s+add column if not exists v3_revision bigint not null default 1/i);
assert.match(sql, /new\.v3_revision := old\.v3_revision \+ 1/);
for (const provider of ["account", "personal"]) {
  const name = "public.live_memory_v3_cas_" + provider;
  const start = sql.indexOf("create or replace function " + name);
  assert.ok(start >= 0, "Missing " + name + " RPC");
  const fn = sql.slice(start, sql.indexOf("$body$;", start) + 7);
  assert.match(fn, /security invoker/i, name + " must preserve tenant RLS");
  assert.match(fn, /set search_path = pg_catalog/i, name + " must pin search_path");
  assert.match(fn, /p_expected_revision bigint/);
  assert.match(fn, /v3_revision = p_expected_revision/);
  assert.match(fn, /V3_REVISION_CONFLICT/, name + " must reject stale clients");
  assert.match(fn, /p_payload ->> 'id' is distinct from p_id/);
}
assert.match(sql, /v_user uuid := \(select auth\.uid\(\)\)/);
assert.match(sql, /v_owner text := public\.live_memory_owner_key\(\)/);
assert.match(sql, /revoke all on function public\.live_memory_v3_cas_account\(.+\) from public, anon/);
assert.match(sql, /grant execute on function public\.live_memory_v3_cas_personal\(.+\) to anon, authenticated/);
assert.doesNotMatch(sql, /\b(drop table|truncate|delete from|update public\.echo_text_backups set|update public\.echo_passkey_records set)\b/i,
  "V3 schema migrations must never rewrite the user's existing records");
assert.match(sql, /before insert or update on public\.echo_text_backups/);
assert.match(sql, /before insert or update on public\.echo_passkey_records/);
const fence = await readFile(new URL("../supabase/migrations/018_v3_server_cutover_fence.sql", import.meta.url), "utf8");
assert.match(fence, /create table if not exists public\.live_memory_v3_writer_modes/i);
assert.match(fence, /enable row level security/i);
assert.match(fence, /V3_LEGACY_WRITE_FENCED/);
assert.match(fence, /pg_advisory_xact_lock/);
assert.match(fence, /set_config\('live_memory\.v3_writer','1',true\)/);
assert.match(fence, /set_config\('live_memory\.v3_writer','0',true\)/);
assert.match(fence, /public\.live_memory_v3_activate_personal/);
assert.match(fence, /public\.live_memory_v3_activate_account/);
assert.match(fence, /grant select,insert on public\.live_memory_v3_writer_modes/);
assert.doesNotMatch(fence, /grant[^\n]*\bupdate\b|grant[^\n]*\bdelete\b/i,
  "Owner clients must not undo the write fence or edit cutover markers");
assert.doesNotMatch(fence, /\bsecurity definer\b/i,
  "Writer cutover must not bypass RLS");
assert.doesNotMatch(fence, /\b(drop table|truncate|delete from public\.echo_|update public\.echo_).*?;/i,
  "Cutover migration cannot alter real archives");
const activationGate = await readFile(
  new URL("../supabase/migrations/020_v3_owner_activation_cas_gate.sql", import.meta.url),"utf8",
);
assert.match(activationGate, /revoke all on function public\.live_memory_v3_activate_personal\(\)\s+from public, anon, authenticated/i,
  "Anonymous users with legacy leaked owner keys must not be able to lock out V2");
assert.match(activationGate, /revoke insert on public\.live_memory_v3_writer_modes from anon/i);
assert.match(activationGate, /for insert to authenticated\s+with check\s*\(\s*provider='account'/i,
  "Authenticated clients must not use a leaked passkey ownerKey to insert a personal cutover marker");
for (const provider of ["account","personal"]) {
  const name = "public.live_memory_v3_cas_" + provider;
  const from = activationGate.indexOf("create or replace function " + name);
  assert.ok(from >= 0, "Missing secure V3 CAS " + provider);
  const body = activationGate.slice(from,activationGate.indexOf("$body$;",from)+7);
  assert.match(body,/security invoker/i);
  assert.match(body,/pg_advisory_xact_lock/);
  assert.match(body,/V3_OWNER_NOT_ACTIVATED/);
  assert.match(body,/public\.live_memory_v3_writer_modes/);
  assert.ok(body.indexOf("V3_OWNER_NOT_ACTIVATED")<body.indexOf("set_config('live_memory.v3_writer','1',true)"),
    "Never enable V3 writer flag until activation has been checked");
}
assert.doesNotMatch(activationGate, /\b(drop table|truncate|delete from public\.echo_|update public\.echo_).*?;/i,
  "Activation gate must not alter any real archive");
const mediaCutover = await readFile(
  new URL("../supabase/migrations/021_v3_private_storage_cutover_gate.sql",import.meta.url),"utf8",
);
assert.match(mediaCutover,/V3_STORAGE_CUTOVER_GATE_REQUIRES_MEDIA_AUDIT/);
assert.match(mediaCutover,/bucket_id='echo-private-media-v3'/);
assert.match(mediaCutover,/public\.live_memory_v3_writer_modes/);
assert.match(mediaCutover,/provider='personal' and identity=public\.live_memory_owner_key\(\)/);
assert.match(mediaCutover,/live-memory-v3-media:/);
assert.doesNotMatch(mediaCutover,/\b(drop table|truncate|delete from storage\.objects|update storage\.objects)\b/i,
  "Storage gate cannot edit or delete existing objects");
const mediaCAS = await readFile(
  new URL("../supabase/migrations/022_v3_personal_media_cas_integrity.sql",import.meta.url),"utf8",
);
assert.match(mediaCAS,/create or replace function public\.live_memory_v3_cas_personal/);
assert.match(mediaCAS,/security invoker/i);
assert.match(mediaCAS,/V3_OWNER_NOT_ACTIVATED/);
assert.match(mediaCAS,/V3_MEDIA_PAYLOAD_NOT_PORTABLE/);
assert.match(mediaCAS,/storage\.objects as media_object/);
assert.match(mediaCAS,/echo-private-media-v3/);
assert.match(mediaCAS,/recordId' is distinct from p_id/);
assert.match(mediaCAS,/item\.value->>'src' is distinct from ''/);
assert.ok(mediaCAS.indexOf("V3_OWNER_NOT_ACTIVATED") <
  mediaCAS.indexOf("V3_MEDIA_PAYLOAD_NOT_PORTABLE") &&
  mediaCAS.indexOf("V3_MEDIA_PAYLOAD_NOT_PORTABLE") <
  mediaCAS.indexOf("set_config('live_memory.v3_writer','1',true)"),
  "Activation, media validation and writer privilege must be checked in that order");
assert.doesNotMatch(mediaCAS,/\bsecurity definer\b/i);
assert.doesNotMatch(mediaCAS,/\b(drop table|truncate|delete from storage\.objects|update public\.echo_)\b/i);
const accountFence = await readFile(
  new URL("../supabase/migrations/023_v3_account_session_scoped_cas.sql",import.meta.url),"utf8",
);
assert.match(accountFence,/create or replace function public\.live_memory_v3_cas_account_scoped/);
assert.match(accountFence,/p_expected_user uuid/);
assert.match(accountFence,/auth\.uid\(\)\) is distinct from p_expected_user/);
assert.match(accountFence,/V3_ACCOUNT_SESSION_CHANGED/);
assert.match(accountFence,/security invoker/i);
assert.match(accountFence,/public\.live_memory_v3_cas_account\(/);
assert.match(accountFence,/revoke all on function public\.live_memory_v3_cas_account_scoped/);
assert.doesNotMatch(accountFence,/\bsecurity definer\b/i);
assert.doesNotMatch(accountFence,/\b(drop table|truncate|delete from public\.echo_|update public\.echo_)\b/i);
const stagingSQL=await readFile(
  new URL("../supabase/migrations/024_v3_authenticated_media_staging.sql",import.meta.url),"utf8",
);
assert.match(stagingSQL,/echo-v3-media-staging/);
assert.match(stagingSQL,/public=false/);
assert.match(stagingSQL,/for insert to authenticated/);
assert.match(stagingSQL,/for select to authenticated/);
assert.match(stagingSQL,/auth\.uid\(\)/);
assert.match(stagingSQL,/storage\.foldername\(name\)/);
assert.match(stagingSQL,/split_part\(name,'\/',5\)/);
assert.doesNotMatch(stagingSQL,/for (update|delete)|security definer/i,
  "Staged pictures must remain immutable and auth-account scoped");
assert.doesNotMatch(stagingSQL,/\b(delete from storage\.objects|update storage\.objects|update public\.echo_|truncate)\b/i,
  "Staging bucket migration must never change historical objects or records");
const fullMediaArchive = await readFile(
  new URL("../supabase/migrations/025_v3_authenticated_full_media_archive.sql", import.meta.url), "utf8",
);
assert.match(fullMediaArchive, /create table if not exists public\.live_memory_v3_secure_records/);
assert.match(fullMediaArchive, /alter table public\.live_memory_v3_secure_records enable row level security/);
assert.match(fullMediaArchive, /create policy "v3 secure archive account select"/);
assert.match(fullMediaArchive, /create policy "v3 secure archive account insert"/);
assert.match(fullMediaArchive, /create policy "v3 secure archive account update"/);
assert.match(fullMediaArchive, /user_id=\(select auth\.uid\(\)\)/);
assert.match(fullMediaArchive, /create or replace function public\.live_memory_v3_cas_secure_account/);
assert.match(fullMediaArchive, /security invoker set search_path=pg_catalog/);
assert.match(fullMediaArchive, /V3_SECURE_DIRECT_WRITE_FENCED/);
assert.match(fullMediaArchive, /V3_SECURE_MEDIA_NOT_STAGED/);
assert.match(fullMediaArchive, /V3_SECURE_REVISION_CONFLICT/);
assert.match(fullMediaArchive, /V3_SECURE_ACCOUNT_CHANGED/);
assert.match(fullMediaArchive, /pg_advisory_xact_lock/);
assert.match(fullMediaArchive, /storage\.objects as object/);
assert.match(fullMediaArchive, /echo-v3-media-staging/);
assert.match(fullMediaArchive, /revoke all on function public\.live_memory_v3_cas_secure_account/);
assert.doesNotMatch(fullMediaArchive, /security definer|for delete|grant\s+delete|delete from storage\.objects|drop table|truncate/i,
  "The new full-media private mirror must never bypass tenant RLS or delete historical data");
const verifiedCutover = await readFile(
  new URL("../supabase/migrations/026_v3_verified_account_cutover_approval.sql",import.meta.url),"utf8",
);
assert.match(verifiedCutover,/create table if not exists public\.live_memory_v3_cutover_approvals/);
assert.match(verifiedCutover,/alter table public\.live_memory_v3_cutover_approvals enable row level security/);
assert.match(verifiedCutover,/grant select on public\.live_memory_v3_cutover_approvals to authenticated/);
assert.doesNotMatch(verifiedCutover,/grant insert on public\.live_memory_v3_cutover_approvals|grant update on public\.live_memory_v3_cutover_approvals/i);
assert.match(verifiedCutover,/live_memory_v3_secure_account_readiness/);
assert.match(verifiedCutover,/V3_ACCOUNT_CUTOVER_NOT_APPROVED/);
assert.match(verifiedCutover,/V3_ACCOUNT_CUTOVER_ARCHIVE_CHANGED/);
assert.match(verifiedCutover,/V3_ACCOUNT_ACTIVATION_GUARD_REQUIRED/);
assert.match(verifiedCutover,/hashtextextended\('lm-v3\|account\|'/);
assert.match(verifiedCutover,/missing_legacy_count/);
assert.match(verifiedCutover,/lock table public\.live_memory_v3_secure_records in share mode/);
assert.match(verifiedCutover,/v_approval\.media_bytes_verified/);
assert.match(verifiedCutover,/v_approval\.personal_sources_verified/);
assert.match(verifiedCutover,/v_approval\.full_backup_verified/);
assert.match(verifiedCutover,/security invoker/);
assert.doesNotMatch(verifiedCutover,/\bsecurity definer\b|drop table|delete from storage\.objects|update public\.echo_/i,
  "Cutover approval must never bypass RLS or modify legacy records");
console.log("V3 CAS migration contract passed: additive schema, atomic revisions, RLS invoker, owner checks, no destructive updates.");
