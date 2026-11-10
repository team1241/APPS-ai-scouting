import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { readContract, requirements } from "@ai-scouting/scouting";
import { DraftTestFailed, extractDraftTest, extractSessionTurn } from "./mastra-client.ts";

test("session client sends the pinned contract and messages and validates results", async () => {
  const contract = readContract(requirements);
  const messages = [{ role: "note" as const, text: "Q1 1241 no climb" }];
  const result = {
    specificationVersion: requirements.version,
    turns: [{ match: "Q1", team_number: 1241, climbed: false }],
  };
  const server = createServer(async (req, res) => {
    assert.equal(req.url, "/scouting/sessions/session-id/turn");
    assert.equal(req.headers.authorization, "Bearer secret");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { turnId: "turn-id", contract, messages });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = () =>
    extractSessionTurn(
      `http://127.0.0.1:${address.port}`,
      "session-id",
      "turn-id",
      contract,
      messages,
      "secret",
    );
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    server.removeAllListeners("request");
    server.on("request", (_req, res) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    });
  };
  try {
    assert.deepEqual(await call(), result);
    respond(302, {}, { location: "http://127.0.0.1:1" });
    await assert.rejects(call());
    respond(200, { values: { climbed: "invalid" } });
    await assert.rejects(call());
    respond(200, { ...result, specificationVersion: "other" });
    await assert.rejects(call(), /Specification mismatch/);
    respond(200, { ...result, turns: [] });
    await assert.rejects(call(), /turn count/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("draft test client classifies failures without exposing the sample", async () => {
  const contract = readContract(requirements);
  const messages = [{ role: "note" as const, text: "Q1 1241" }];
  let reply: { status: number; body: unknown } = {
    status: 200,
    body: { specificationVersion: contract.version, turns: [{ match: "Q1" }] },
  };
  const server = createServer(async (req, res) => {
    assert.equal(req.url, "/scouting/draft-test");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { contract, messages });
    res.statusCode = reply.status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = () => extractDraftTest(`http://127.0.0.1:${address.port}`, contract, messages);
  try {
    assert.deepEqual((await call()).turns, [{ match: "Q1" }]);
    reply = { status: 503, body: { error: "Extraction model unavailable" } };
    await assert.rejects(call, (e) => e instanceof DraftTestFailed && e.reason === "unavailable");
    reply = { status: 200, body: { specificationVersion: "other", turns: [{}] } };
    await assert.rejects(call, (e) => e instanceof DraftTestFailed && e.reason === "invalid");
  } finally {
    server.close();
  }
  await assert.rejects(
    () => extractDraftTest("http://127.0.0.1:1", contract, messages),
    (e) => e instanceof DraftTestFailed && e.reason === "unavailable",
  );
});
