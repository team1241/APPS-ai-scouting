import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { type ApplicationState, submitApplication } from "../src/app/request-access/actions.ts";

const initial: ApplicationState = { status: "idle", values: {}, errors: {} };
const originalBackend = process.env.BACKEND_URL;
afterEach(() => {
  mock.restoreAll();
  if (originalBackend === undefined) delete process.env.BACKEND_URL;
  else process.env.BACKEND_URL = originalBackend;
});
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    id: "fake-id",
    name: "Applicant",
    email: "applicant@example.com",
    teamNumber: "1241",
    role: "mentor",
    adultAttested: "on",
  }))
    data.set(key, value);
  return data;
}
test("submission forwards only application data and shows receipt only after backend acceptance", async () => {
  process.env.BACKEND_URL = "https://backend.example.com";
  const fetch = mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(url.href, "https://backend.example.com/web/access-applications");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(JSON.parse(init.body as string).adultAttested, true);
    assert.equal(new Headers(init.headers).has("authorization"), false);
    return Response.json({ received: true }, { status: 202 });
  });
  const result = await submitApplication(initial, form());
  assert.equal(result.status, "received");
  assert.deepEqual(result.values, {});
  assert.equal(fetch.mock.callCount(), 1);
});
test("validation failures and unavailable service preserve details for retry without leaking errors", async () => {
  process.env.BACKEND_URL = "https://backend.example.com";
  mock.method(globalThis, "fetch", async () =>
    Response.json({ errors: { email: "Enter a valid email address." } }, { status: 400 }),
  );
  const invalid = await submitApplication(initial, form());
  assert.equal(invalid.status, "error");
  assert.equal(invalid.errors.email, "Enter a valid email address.");
  assert.equal(invalid.values.name, "Applicant");
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => {
    throw new Error("private connection details");
  });
  const failed = await submitApplication(initial, form());
  assert.equal(failed.status, "error");
  assert.equal(failed.values.adultAttested, "on");
  assert.ok(!failed.message?.includes("private"));
});
test("missing backend, insecure remote URL and unexpected acceptance response never claim completion", async () => {
  const fetch = mock.method(globalThis, "fetch", async () =>
    Response.json({ received: false }, { status: 202 }),
  );
  delete process.env.BACKEND_URL;
  assert.equal((await submitApplication(initial, form())).status, "error");
  process.env.BACKEND_URL = "http://remote.example.com";
  assert.equal((await submitApplication(initial, form())).status, "error");
  assert.equal(fetch.mock.callCount(), 0);
  process.env.BACKEND_URL = "https://backend.example.com";
  assert.equal((await submitApplication(initial, form())).status, "error");
});
