import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

test("off mode starts HTTP without database availability, health remains query-free, and SIGTERM drains", {
  timeout: 10000,
}, async () => {
  const child = spawn(process.execPath, [new URL("./index.ts", import.meta.url).pathname], {
    env: {
      ...process.env,
      PORT: "0",
      EVENT_MODE: "off",
      EXTRACTION_ENABLED: "false",
      DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/unreachable",
      TELEGRAM_ORGANIZATION_ID: "10000000-0000-4000-8000-000000000010",
      TELEGRAM_BOT_TOKEN: "must-not-send",
      TELEGRAM_WEBHOOK_SECRET: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = /backend listening on (\d+)/.exec(output);
        if (match) resolve(Number(match[1]));
      });
      child.on("exit", () => reject(Error("HTTP process exited before readiness")));
    });
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual((await health.json()).workers, { mode: "off", active: false });
    const ended = once(child, "exit");
    child.kill("SIGTERM");
    assert.deepEqual(await ended, [0, null]);
    assert.equal(errors, "");
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});

test("off recovery cron exits without contacting database, Mastra or Telegram", {
  timeout: 10000,
}, async () => {
  const child = spawn(process.execPath, [new URL("./worker-run.ts", import.meta.url).pathname], {
    env: {
      ...process.env,
      EVENT_MODE: "off",
      EXTRACTION_ENABLED: "true",
      DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/unreachable",
    },
    stdio: "ignore",
  });
  assert.deepEqual(await once(child, "exit"), [0, null]);
});
