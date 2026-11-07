import assert from "node:assert/strict";
import { test } from "node:test";
import { schedulePollInterval, schedulePollingStarted } from "./schedule-policy.ts";

const event = { start_date: "2026-03-13", timezone: "America/Toronto", archived: false };
test("polling starts at 6pm on the first event day, not the night before", () => {
  assert.equal(schedulePollingStarted(event, new Date("2026-03-12T22:00:00Z")), false);
  assert.equal(schedulePollingStarted(event, new Date("2026-03-13T21:59:59Z")), false);
  assert.equal(schedulePollingStarted(event, new Date("2026-03-13T22:00:00Z")), true);
  assert.equal(schedulePollingStarted(event, new Date("2026-03-14T04:00:00Z")), true);
  assert.equal(
    schedulePollingStarted({ ...event, archived: true }, new Date("2026-03-14T04:00:00Z")),
    false,
  );
  assert.equal(schedulePollInterval, 600_000);
});
test("start boundary follows event timezone including DST and SQL Date values", () => {
  assert.equal(
    schedulePollingStarted(
      { ...event, timezone: "America/Los_Angeles" },
      new Date("2026-03-14T00:59:59Z"),
    ),
    false,
  );
  assert.equal(
    schedulePollingStarted(
      { ...event, timezone: "America/Los_Angeles" },
      new Date("2026-03-14T01:00:00Z"),
    ),
    true,
  );
  const fall = { ...event, start_date: new Date("2026-11-01T00:00:00Z") };
  assert.equal(schedulePollingStarted(fall, new Date("2026-11-01T22:59:59Z")), false);
  assert.equal(schedulePollingStarted(fall, new Date("2026-11-01T23:00:00Z")), true);
});
