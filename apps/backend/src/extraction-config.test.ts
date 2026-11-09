import assert from "node:assert/strict";
import { test } from "node:test";
import { extractionConfig } from "./extraction-config.ts";

const base = {
  EXTRACTION_ENABLED: "true",
  DATABASE_URL: "postgresql://fixture",
  TELEGRAM_BOT_TOKEN: "bot",
  TELEGRAM_WEBHOOK_SECRET: "secret",
  MASTRA_URL: "https://example.com",
  MASTRA_SERVICE_TOKEN: "service",
};
test("hosted extraction requires HTTPS and credentials before startup", () => {
  assert.ok(extractionConfig(base));
  assert.equal(extractionConfig({ EXTRACTION_ENABLED: "false" }), null);
  assert.throws(
    () => extractionConfig({ ...base, MASTRA_SERVICE_TOKEN: "" }),
    /MASTRA_SERVICE_TOKEN/,
  );
  assert.throws(() => extractionConfig({ ...base, MASTRA_URL: "http://example.com" }), /HTTPS/);
  assert.throws(
    () => extractionConfig({ ...base, MASTRA_URL: "https://example.com?token=secret" }),
    /base URL/,
  );
  assert.throws(() => extractionConfig({ ...base, DATABASE_URL: "" }), /DATABASE_URL/);
  assert.ok(
    extractionConfig({ ...base, MASTRA_URL: "http://127.0.0.1:4111", MASTRA_SERVICE_TOKEN: "" }),
  );
});
