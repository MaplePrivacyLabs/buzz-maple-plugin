import { test } from "node:test";
import assert from "node:assert/strict";
import { AcpClient, selectModel } from "../src/acp.js";

function fixture() {
  let exit;
  const writes = [];
  const process = { exited: new Promise((resolve) => { exit = resolve; }), write: async (data) => { writes.push(JSON.parse(data)); }, kill: async () => { exit(0); } };
  const client = new AcpClient(process);
  return { client, writes, exit };
}

test("ACP correlates split NDJSON responses and concurrent requests", async () => {
  const { client, writes } = fixture();
  const a = client.request("initialize", {});
  const b = client.request("session/new", {});
  await Promise.resolve(); await Promise.resolve();
  assert.equal(writes.length, 2);
  client.feed('{"jsonrpc":"2.0","id":2,"result":{"session');
  client.feed('Id":"s"}}\n{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}\n');
  assert.deepEqual(await a, { protocolVersion: 1 });
  assert.deepEqual(await b, { sessionId: "s" });
  await client.close();
});

test("malformed output and process exit reject pending requests", async () => {
  const first = fixture();
  const invalid = first.client.request("initialize", {});
  first.client.feed("not json\n");
  await assert.rejects(invalid, /Invalid ACP/);
  await first.client.close();
  const second = fixture();
  const exited = second.client.request("session/prompt", {});
  second.exit(1);
  await assert.rejects(exited, /process exited/);
});

test("client refuses an unexpected permission request instead of auto-allowing", async () => {
  const { client, writes } = fixture();
  client.feed('{"jsonrpc":"2.0","id":77,"method":"session/request_permission","params":{}}\n');
  await Promise.resolve();
  assert.deepEqual(writes[0].result, { outcome: { outcome: "cancelled" } });
  await client.close();
});

test("model selection requires a supported ID and explicit confirmation", async () => {
  const calls = [];
  const client = { request: async (method, params) => { calls.push({ method, params }); return { configOptions: [{ configId: "model", currentValue: "chosen" }] }; } };
  const session = { sessionId: "s", configOptions: [{ configId: "model", category: "model", options: [{ value: "chosen" }] }] };
  await selectModel(client, session, "chosen");
  assert.equal(calls[0].method, "session/set_config_option");
  assert.equal(calls[0].params.value, "chosen");
  await assert.rejects(selectModel(client, session, "unknown"), /unavailable/);
  await assert.rejects(selectModel({ request: async () => ({}) }, session, "chosen"), /did not confirm/);
});
