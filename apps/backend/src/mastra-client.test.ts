import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { finalizeExtraction } from "@ai-scouting/scouting";
import { extractNote } from "./mastra-client.ts";

test("client sends bearer credentials, validates output, and refuses redirects", async () => {
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-service-token");
    assert.equal(req.url, "/api/workflows/scouting-extraction/start-async");
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        status: "success",
        result: finalizeExtraction({ match: "Q42", team_number: 1241, climbed: null, notes: null }),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const result = await extractNote(
      `http://127.0.0.1:${address.port}`,
      "note",
      "test-service-token",
    );
    assert.deepEqual(result.missing, ["climbed"]);
    server.removeAllListeners("request");
    server.on("request", (_req, res) => {
      res.writeHead(302, { location: "http://127.0.0.1:1" });
      res.end();
    });
    await assert.rejects(
      extractNote(`http://127.0.0.1:${address.port}`, "note", "test-service-token"),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
