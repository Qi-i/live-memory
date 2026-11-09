import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";

/**
 * Only runs in the CI's disposable PostgreSQL 17 service, after executing
 * the EXACT deployed V3 migration SQL. No production URL or credential.
 *
 * Session A updates a row but holds its row lock before COMMIT.
 * Session B attempts the same expected revision and MUST wait for that lock,
 * then fail with V3_REVISION_CONFLICT when A commits.
 */
assert.equal(process.env.PGHOST, "127.0.0.1", "Never run on a remote database");
assert.equal(process.env.PGDATABASE, "v3_contract", "Only the ephemeral database is allowed");

function openSession(name) {
  const child = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    env: { ...process.env, PGAPPNAME: name },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  child.stdin.on("error", () => {}); // A terminated psql may already have closed stdin.
  const done = new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.on("error", error => resolve({ code: -1, stdout, stderr: String(error) }));
  });
  return {
    child, done,
    send(sql) { child.stdin.write(sql + "\n"); },
    end() { child.stdin.end(); },
    output() { return { stdout, stderr }; },
  };
}

async function run(sql) {
  const client = openSession("v3-race-audit");
  client.send(sql);
  client.end();
  return client.done;
}

async function waitFor(condition, label, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await pause(75);
  }
  throw new Error("Timed out: " + label);
}

const ownerKey = "a".repeat(64);
const contexts = [
  {
    name: "personal",
    prefix: `set role anon;\nset request.headers = '{"x-live-memory-owner-key":"${ownerKey}"}';`,
    fn: "live_memory_v3_cas_personal",
    table: "echo_passkey_records",
  },
  {
    name: "account",
    prefix: `set role authenticated;\nset request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';`,
    fn: "live_memory_v3_cas_account",
    table: "echo_text_backups",
  },
];

for (const context of contexts) {
  const id = "v3-parallel-" + context.name;
  const initial = await run(`${context.prefix}
select v3_revision from public.${context.fn}(
  '${id}', '{"id":"${id}","title":"initial"}'::jsonb, null
);`);
  assert.equal(initial.code, 0, `Setup failed (${context.name}): ${initial.stderr}`);
  assert.match(initial.stdout, /(?:^|\n)1\s*(?:\n|$)/);

  const writerA = openSession("v3-race-writer-a-" + context.name);
  const writerBName = "v3-race-writer-b-" + context.name;
  let writerB;
  try {
    writerA.send(`${context.prefix}
begin;
select v3_revision from public.${context.fn}(
  '${id}', '{"id":"${id}","title":"writer-a"}'::jsonb, 1
);`);
    await waitFor(() => writerA.output().stdout.trim().split(/\s+/).includes("2"),
      `Writer A did not lock the ${context.name} row`);
    assert.equal(writerA.output().stderr.trim(), "", "Writer A must not have SQL errors");

    writerB = openSession(writerBName);
    writerB.send(`${context.prefix}
select v3_revision from public.${context.fn}(
  '${id}', '{"id":"${id}","title":"writer-b"}'::jsonb, 1
);`);
    writerB.end();

    // Proof of actual overlap: B must wait on a PostgreSQL lock while A still
    // holds the record. A serial retry-only test cannot satisfy this check.
    await waitFor(async () => {
      const probe = await run(`select count(*) from pg_stat_activity
        where application_name = '${writerBName}'
          and wait_event_type = 'Lock' and state = 'active';`);
      return probe.code === 0 && Number(probe.stdout.trim()) > 0;
    }, `Second ${context.name} writer never blocked behind the first transaction`, 5500);

    writerA.send("commit;");
    writerA.end();
    const [a, b] = await Promise.all([writerA.done, writerB.done]);
    assert.equal(a.code, 0, `Winner commit failed: ${a.stderr}`);
    assert.notEqual(b.code, 0, "Concurrent stale CAS must be rejected");
    assert.match(b.stderr, /V3_REVISION_CONFLICT/,
      `Concurrent stale CAS failed for an unrelated reason: ${b.stderr}`);

    const verified = await run(`${context.prefix}
select v3_revision || ':' || (payload->>'title')
from public.${context.table} where id = '${id}';`);
    assert.equal(verified.code, 0, `Final query failed: ${verified.stderr}`);
    assert.equal(verified.stdout.trim(), "2:writer-a",
      "Only the first committed writer can update the record");
    console.log("PASS: " + context.name + " row lock, simultaneous CAS conflict and committed payload");
  } finally {
    // On any failure, release the row lock and both test processes immediately.
    if (!writerA.child.killed) { writerA.send("rollback;"); writerA.end(); writerA.child.kill(); }
    if (writerB && !writerB.child.killed) writerB.child.kill();
  }
}
console.log("PASS: real two-session V3 PostgreSQL CAS races for both cloud providers.");
