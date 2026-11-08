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
console.log("V3 CAS migration contract passed: additive schema, atomic revisions, RLS invoker, owner checks, no destructive updates.");
