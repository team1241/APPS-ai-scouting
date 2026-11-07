import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { finalizeExtraction } from "@ai-scouting/scouting";
import { extractSessionTurn } from "./mastra-client.ts";

test("session client uses the stable session and turn IDs and validates results", async () => {
  const result = finalizeExtraction({
    match: "Q1",
    team_number: 1241,
    climbed: false,
    notes: null,
  });
  const server = createServer(async (req, res) => {
    assert.equal(req.url, "/scouting/sessions/session-id/turn");
    assert.equal(req.headers.authorization, "Bearer secret");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), {
      turnId: "turn-id",
      text: "note",
      deferFinalization: true,
    });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    assert.deepEqual(
      await extractSessionTurn(
        `http://127.0.0.1:${address.port}`,
        "session-id",
        "turn-id",
        "note",
        "secret",
      ),
      result,
    );
    server.removeAllListeners("request");
    server.on("request", (_req, res) => {
      res.writeHead(302, { location: "http://127.0.0.1:1" });
      res.end();
    });
    await assert.rejects(
      extractSessionTurn(
        `http://127.0.0.1:${address.port}`,
        "session-id",
        "turn-id",
        "note",
        "secret",
      ),
    );
    server.removeAllListeners("request");
    server.on("request", (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ values: { climbed: "invalid" } }));
    });
    await assert.rejects(
      extractSessionTurn(
        `http://127.0.0.1:${address.port}`,
        "session-id",
        "turn-id",
        "note",
        "secret",
      ),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
