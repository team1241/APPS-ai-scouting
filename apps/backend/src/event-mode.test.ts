import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkerControl, eventMode, eventWindowActive } from "./event-mode.ts";

const event = {
  start_date: "2026-03-07",
  end_date: "2026-03-08",
  timezone: "America/Toronto",
  attending: true,
  archived: false,
};
test("auto windows use event-local dates across DST and ignore archived/unattended events", () => {
  assert.equal(eventWindowActive([event], new Date("2026-03-07T04:59:59Z")), false);
  assert.equal(eventWindowActive([event], new Date("2026-03-07T05:00:00Z")), true);
  assert.equal(eventWindowActive([event], new Date("2026-03-09T03:59:59Z")), true);
  assert.equal(eventWindowActive([event], new Date("2026-03-09T04:00:00Z")), false);
  assert.equal(
    eventWindowActive([{ ...event, archived: true }], new Date("2026-03-08T12:00Z")),
    false,
  );
  assert.equal(
    eventWindowActive([{ ...event, attending: false }], new Date("2026-03-08T12:00Z")),
    false,
  );
});
test("idle and manual override make no polling queries; activity bursts expire and stopped controls cannot restart", async () => {
  let reads = 0,
    time = new Date("2026-03-01T12:00Z");
  const control = createWorkerControl(
    "auto",
    async () => {
      reads++;
      return [event];
    },
    () => time,
  );
  await control.refresh();
  for (let i = 0; i < 100; i++) assert.equal(control.active(), false);
  assert.equal(reads, 1);
  control.wake();
  assert.equal(control.active(), true);
  time = new Date(time.getTime() + 120001);
  assert.equal(control.active(), false);
  time = new Date("2026-03-08T12:00Z");
  assert.equal(control.active(), true);
  control.stop();
  control.wake();
  await control.refresh();
  assert.equal(control.active(), false);
  assert.equal(reads, 1);
  for (const mode of ["on", "off"] as const) {
    const override = createWorkerControl(mode, async () => {
      throw Error("Must not read");
    });
    await override.refresh();
    override.wake();
    assert.equal(override.active(), mode === "on");
  }
  assert.equal(eventMode({}), "on");
  assert.throws(() => eventMode({ EVENT_MODE: "invalid" }));
});

test("worker loop pauses claims, serializes work and drains one in-flight pass on shutdown", async (context) => {
  const { startWorkerLoop } = await import("./worker-loop.ts");
  context.mock.timers.enable({ apis: ["setInterval"] });
  let enabled = false,
    calls = 0,
    release: (() => void) | undefined;
  const stop = startWorkerLoop(
    () => {
      calls++;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    () => enabled,
  );
  context.mock.timers.tick(15000);
  assert.equal(calls, 0);
  enabled = true;
  context.mock.timers.tick(5000);
  assert.equal(calls, 1);
  context.mock.timers.tick(15000);
  assert.equal(calls, 1);
  let stopped = false;
  const stopping = stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  release?.();
  await stopping;
  assert.equal(stopped, true);
  context.mock.timers.tick(15000);
  assert.equal(calls, 1);
});

test("a committed event change during refresh triggers a trailing cache reload", async () => {
  let calls = 0,
    release: ((rows: (typeof event)[]) => void) | undefined;
  const control = createWorkerControl(
    "auto",
    () => {
      calls++;
      return calls === 1
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve([event]);
    },
    () => new Date("2026-03-08T12:00Z"),
  );
  const first = control.refresh();
  const second = control.refresh();
  release?.([]);
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert.equal(control.active(), true);
});
