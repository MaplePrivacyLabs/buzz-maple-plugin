import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../src/plugin.js";

function fixture({ storage = new Map(), steering = "injected", http = true } = {}) {
  const calls = [];
  const servers = [];
  const processes = [];
  const prompts = [];
  let type, dispose;
  const reply = (process, id, result) => queueMicrotask(() => process.stdout(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"));
  const ctx = {
    react: { createElement() {}, useState() {} },
    on: (_, callback) => { dispose = callback; },
    agents: {
      register: (value) => { type = value; },
      storage: { read: async (key) => storage.get(key) ?? null, scan: async (prefix) => Object.fromEntries([...storage].filter(([key]) => key.startsWith(prefix))), set: async (key, value) => value === null ? storage.delete(key) : storage.set(key, value) },
      harness: {
        conversation: async (delivery) => delivery.allowed === false ? undefined : { key: "channel/thread", channel: "channel", root: "thread", topLevel: false },
        tools: (agent) => { assert.equal(agent.pubkey, "agent"); return async () => ({}); },
        turnPrompt: async (delivery, _, options) => { prompts.push(options); return { text: delivery.text, cursor: delivery.text, restore() {} }; },
        systemPrompt: async () => "Buzz instructions: send visible replies with Buzz tools",
      },
    },
    host: {
      resolveDirectory: async () => "/work",
      readFile: async () => new Uint8Array(),
      serveMcp: async () => { const server = { url: "http://127.0.0.1:1234/mcp", headers: [{ name: "Authorization", value: "Bearer fixture-only" }], close: async () => { server.closed = true; } }; servers.push(server); return server; },
      spawn: async (id, options) => {
        assert.equal(id, "maple");
        assert.equal(options.env.BUZZ_PRIVATE_KEY, null);
        let exit;
        const process = { stdout: options.onStdout, exited: new Promise((resolve) => { exit = resolve; }), kill: async () => { process.killed = true; exit(0); }, write: async (data) => {
          const message = JSON.parse(data);calls.push(message);
          if (message.method === "initialize") reply(process, message.id, { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http } }, _meta: { steering: { supported: true } } });
          else if (message.method === "session/new") reply(process, message.id, { sessionId: "session-1" });
          else if (message.method === "session/load") reply(process, message.id, {});
          else if (message.method === "session/prompt") process.promptId = message.id;
          else if (message.method === "_session/steering") reply(process, message.id, { outcome: steering });
          else if (message.method === "session/cancel") finish(process, "cancelled");
        } };
        processes.push(process);return process;
      },
    },
  };
  function finish(process = processes[0], stopReason = "end_turn") { reply(process, process.promptId, { stopReason }); }
  function send(text, more = {}) {
    let done;
    const delivery = { agent: { key: "agent-key", pubkey: "agent", owner: "owner" }, config: { cwd: "/work" }, text, signal: new AbortController().signal, current: () => true, workingUntil: (value) => { done = value; }, ...more };
    type.run(delivery);
    return done;
  }
  apply(ctx);
  return { calls, servers, processes, prompts, storage, send, finish, dispose: () => dispose(), type };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise((resolve) => setImmediate(resolve)); }
  assert.fail("fixture did not reach expected protocol state");
}

test("denied admission starts no agent or MCP server", async () => {
  const f = fixture();assert.equal((await f.send("teammate", { allowed: false })).ok, true);
  assert.equal(f.processes.length, 0);assert.equal(f.servers.length, 0);await f.dispose();
});

test("native HTTP MCP is passed to ACP, cursor advances, and state never stores the bearer", async () => {
  const f = fixture();const first = f.send("owner request with teammate context");
  await until(() => f.processes[0]?.promptId);
  const init = f.calls.find((call) => call.method === "initialize");assert.deepEqual(init.params.clientCapabilities, {});
  const session = f.calls.find((call) => call.method === "session/new");assert.equal(session.params.mcpServers[0].type, "http");
  assert.equal(session.params.mcpServers[0].headers[0].value, "Bearer fixture-only");
  const prompt = f.calls.find((call) => call.method === "session/prompt");assert.match(prompt.params.prompt[0].text, /Buzz instructions/);
  f.finish();assert.equal((await first).ok, true);
  const second = f.send("follow-up");await until(() => f.calls.filter((call) => call.method === "session/prompt").length === 2);
  assert.equal(f.prompts[1].cursor, "owner request with teammate context");
  assert.doesNotMatch(f.calls.filter((call) => call.method === "session/prompt")[1].params.prompt[0].text, /Buzz instructions/);
  f.finish();await second;
  assert.doesNotMatch(JSON.stringify([...f.storage]), /fixture-only|Authorization/);
  await f.dispose();assert.equal(f.servers[0].closed, true);assert.equal(f.processes[0].killed, true);
});

test("a live follow-up steers without cancellation or duplicate prompt", async () => {
  const f = fixture();const first = f.send("first");await until(() => f.processes[0]?.promptId);
  const second = f.send("steer");await until(() => f.calls.some((call) => call.method === "_session/steering"));
  const steer = f.calls.find((call) => call.method === "_session/steering");
  assert.equal(steer.params._meta.steering.idleBehavior, "promptRequired");
  assert.equal(f.calls.filter((call) => call.method === "session/prompt").length, 1);
  assert.equal(f.calls.some((call) => call.method === "session/cancel"), false);
  f.finish();await first;await second;await f.dispose();
});

test("saved sessions reload with fresh HTTP MCP bindings after plugin restart", async () => {
  const storage = new Map();const first = fixture({ storage });const run = first.send("first");await until(() => first.processes[0]?.promptId);first.finish();await run;await first.dispose();
  const next = fixture({ storage });const resumed = next.send("next");await until(() => next.processes[0]?.promptId);
  assert.equal(next.calls.some((call) => call.method === "session/new"), false);
  const load = next.calls.find((call) => call.method === "session/load");assert.equal(load.params.sessionId, "session-1");assert.equal(load.params.mcpServers[0].type, "http");
  next.finish();await resumed;await next.dispose();
});

test("HTTP-MCP capability failure closes both process and tool server", async () => {
  const f = fixture({ http: false });assert.equal((await f.send("first")).ok, false);
  assert.equal(f.servers[0].closed, true);assert.equal(f.processes[0].killed, true);await f.dispose();
});

test("idle steering race submits exactly one fresh prompt", async () => {
  const f = fixture({ steering: "promptRequired" });const first = f.send("first");await until(() => f.processes[0]?.promptId);
  const oldPrompt = f.processes[0].promptId;
  const second = f.send("next");await until(() => f.calls.filter((call) => call.method === "session/prompt").length === 2);
  f.processes[0].stdout(JSON.stringify({ jsonrpc: "2.0", id: oldPrompt, result: { stopReason: "end_turn" } }) + "\n");
  f.finish();await first;await second;
  assert.equal(f.calls.filter((call) => call.method === "session/prompt").length, 2);
  assert.equal(f.calls.some((call) => call.method === "session/cancel"), false);await f.dispose();
});

test("unloading an active plugin cancels the task before closing its tool server", async () => {
  const f = fixture();const run = f.send("first");await until(() => f.processes[0]?.promptId);
  await f.dispose();await run;
  assert.equal(f.calls.filter((call) => call.method === "session/cancel").length, 1);
  assert.equal(f.servers[0].closed, true);assert.equal(f.processes[0].killed, true);
});
