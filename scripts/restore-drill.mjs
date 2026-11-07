// Local-only infrastructure drill. Never accepts production/remote URLs or cleans an existing target.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import pg from "../apps/backend/node_modules/pg/lib/index.js";

const source = process.env.DATABASE_URL,
  target = process.env.RESTORE_DATABASE_URL;
for (const input of [source, target]) {
  const url = new URL(input ?? "postgresql://invalid");
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.pathname.startsWith("/scouting_gh10_"),
    "Only local scouting_gh10_* disposable databases allowed",
  );
}
assert.ok(source !== target, "Restore target must differ");
const src = new pg.Client({ connectionString: source }),
  dst = new pg.Client({ connectionString: target });
const directory = await mkdtemp(join(tmpdir(), "scouting-restore-"));
const start = performance.now();
try {
  await src.connect();
  await dst.connect();
  assert.equal(
    (
      await dst.query(
        "select count(*)::int n from pg_tables where schemaname not in ('pg_catalog','information_schema')",
      )
    ).rows[0].n,
    0,
    "Restore target must be empty",
  );
  const archive = join(directory, "database.dump");
  for (const [command, args, connection] of [
    ["pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", archive], source],
    [
      "pg_restore",
      [
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        new URL(target).pathname.slice(1),
        archive,
      ],
      target,
    ],
  ]) {
    const url = new URL(connection);
    const result = spawnSync(command, args, {
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || "5432",
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: url.pathname.slice(1),
      },
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `${command} failed (diagnostics withheld to avoid connection-secret disclosure)`,
    );
  }
  async function fingerprint(client) {
    const tables = (
      await client.query(
        "select schemaname,tablename from pg_tables where schemaname not in ('pg_catalog','information_schema') order by 1,2",
      )
    ).rows;
    const rows = [];
    for (const table of tables) {
      const ident = (value) => `"${value.replaceAll('"', '""')}"`;
      const result = await client.query(
        `select count(*)::int n, md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' order by row_to_json(t)::text),'')) digest from ${ident(table.schemaname)}.${ident(table.tablename)} t`,
      );
      rows.push({ schema: table.schemaname, table: table.tablename, ...result.rows[0] });
    }
    const protections = (
      await client.query(
        "select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname",
      )
    ).rows;
    const triggers = (
      await client.query(
        "select event_object_schema,event_object_table,trigger_name,action_statement from information_schema.triggers order by 1,2,3",
      )
    ).rows;
    const policies = (
      await client.query(
        "select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies order by 1,2,3",
      )
    ).rows;
    return { rows, protections, triggers, policies };
  }
  const expected = await fingerprint(src),
    actual = await fingerprint(dst);
  assert.deepEqual(actual, expected);
  assert.ok(
    expected.rows.some((row) => row.schema === "mastra"),
    "Seed durable Mastra state before verifying restore",
  );
  const report = {
    measuredAt: new Date().toISOString(),
    kind: "local full-database restore drill",
    elapsedMs: Math.round(performance.now() - start),
    tables: expected.rows.length,
    rows: expected.rows.reduce((sum, row) => sum + row.n, 0),
    verified: [
      "all row fingerprints",
      "public RLS flags",
      "tenant policy definitions",
      "immutable/outbox triggers",
      "Mastra schema included",
    ],
    limitations:
      "No role grants/ownership, Neon PITR, remote backup storage or production RTO/RPO verified. Target remains isolated; no workers started.",
  };
  if (process.argv[2]) await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
  else console.log(JSON.stringify(report, null, 2));
} finally {
  await src.end();
  await dst.end();
  await rm(directory, { recursive: true, force: true });
}
