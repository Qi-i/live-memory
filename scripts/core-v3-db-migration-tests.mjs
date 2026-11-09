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
console.log("V3 CAS migration contract passed: additive schema, atomic revisions, RLS invoker, owner checks, no destructive updates.");
