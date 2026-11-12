// Maple Buzz plugin; built for Buzz 1.0.0.
// ACP v1 NDJSON over Buzz's host-owned process. No runtime dependencies.
class AcpClient {
  constructor(process, notify = () => {}) {
    this.process = process;
    this.notify = notify;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.error = null;
    process.exited.then(() => this.fail(new Error("Maple process exited")), () => this.fail(new Error("Maple process failed")));
  }
  feed(chunk) {
    if (this.error) return;
    this.buffer += chunk;
    if (this.buffer.length > 4 * 1024 * 1024) return this.fail(new Error("ACP frame exceeds limit"));
    let end;
    while ((end = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { return this.fail(new Error("Invalid ACP output")); }
      if (!message || message.jsonrpc !== "2.0") return this.fail(new Error("Invalid ACP envelope"));
      if (message.method) {
        if (message.id !== undefined) {
          const reply = message.method === "session/request_permission"
            ? { result: { outcome: { outcome: "cancelled" } } }
            : { error: { code: -32601, message: "Client method not supported" } };
          void this.process.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, ...reply }) + "\n").catch(() => this.fail(new Error("ACP write failed")));
        } else this.notify(message.method, message.params);
      } else {
        const waiter = this.pending.get(message.id);
        if (!waiter) continue;
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(`Maple rejected ${waiter.method} (code ${message.error.code})`));
        else waiter.resolve(message.result);
      }
    }
  }
  request(method, params, { timeout = 30000, sent } = {}) {
    if (this.error) return Promise.reject(this.error);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`ACP ${method} timed out`)), timeout);
      this.pending.set(id, { method, resolve, reject, timer });
      Promise.resolve().then(() => this.process.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"))
        .then(() => sent?.(), () => this.fail(new Error("ACP write failed")))
        .catch(() => this.fail(new Error("ACP acknowledgement failed")));
    });
  }
  async cancel(sessionId) {
    if (!this.error) await this.process.write(JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }) + "\n");
  }
  fail(error) {
    if (this.error) return;
    this.error = error;
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.pending.clear();
  }
  async close() {
    this.fail(new Error("Maple connection closed"));
    await this.process.kill();
    await this.process.exited;
  }
}

async function selectModel(client, session, model) {
  if (!model) return;
  const option = session.configOptions?.find((item) => item.category === "model");
  if (!option) throw new Error("Maple does not advertise model selection");
  const choices = option.options?.flatMap((item) => item.options ?? [item]) ?? [];
  if (!choices.some((item) => item.value === model)) throw new Error("Selected model is unavailable in Maple");
  const result = await client.request("session/set_config_option", { sessionId: session.sessionId, configId: option.configId, value: model });
  const confirmed = result.configOptions?.find((item) => item.configId === option.configId);
  if (confirmed?.currentValue !== model) throw new Error("Maple did not confirm the selected model");
}


export const inject = ["react", "agents", "host"];
const PREFIX = "maple.acp.sessions.v1:";
const normalize = (value = {}) => ({ cwd: value.cwd?.trim() || "~/workspaces/buzz", model: value.model?.trim() || "", instructions: value.instructions || "" });

export function apply(ctx) {
  const { agents, host, react: React } = ctx;
  const kit = agents.harness;
  const slots = new Map();
  const prefix = (key) => PREFIX + encodeURIComponent(key) + ":";
  let disposed = false;

  async function release(slot) {
    const active = slot.active;
    if (active) {
      await slot.client.cancel(slot.sessionId).catch(() => {});
      let timer;
      await Promise.race([active.catch(() => {}), new Promise((resolve) => { timer = setTimeout(resolve, 5000); })]);
      clearTimeout(timer);
    }
    await Promise.allSettled([slot.client?.close(), slot.server?.close()]);
  }
  async function retire(key, forget = false) {
    const selected = [...slots.entries()].filter(([, slot]) => slot.agentKey === key);
    if (forget && selected.some(([, slot]) => slot.active)) throw new Error("Stop active work before resetting sessions");
    for (const [id, slot] of selected) {
      slots.delete(id);
      await slot.ready.catch(() => {});
      await release(slot);
    }
    if (forget) for (const id of Object.keys(await agents.storage.scan(prefix(key)))) await agents.storage.set(id, null);
  }
  ctx.on("dispose", async () => {
    disposed = true;
    await Promise.allSettled([...new Set([...slots.values()].map((slot) => slot.agentKey))].map((key) => retire(key)));
  });

  async function open(delivery, conversation, config) {
    if (disposed) throw new Error("Maple plugin is stopped");
    const id = prefix(delivery.agent.key) + encodeURIComponent(conversation.key);
    let slot = slots.get(id);
    const signature = JSON.stringify(config);
    if (slot && slot.signature !== signature) {
      await slot.ready;
      if (slot.active) throw new Error("Stop active work before changing Maple configuration");
      slots.delete(id);
      await release(slot);
      slot = undefined;
    }
    if (!slot) {
      slot = { id, agentKey: delivery.agent.key, signature, control: Promise.resolve(), active: null };
      slots.set(id, slot);
      slot.ready = (async () => {
        let process;
        try {
          const cwd = await host.resolveDirectory(config.cwd);
          const raw = await agents.storage.read(id);
          const saved = raw ? JSON.parse(raw) : null;
          const reusable = saved?.signature === signature && saved.cwd === cwd && typeof saved.sessionId === "string";
          slot.cwd = cwd;
          slot.server = await host.serveMcp(kit.tools(delivery.agent, conversation, { read: (path) => host.readFile(path, { cwd }) }));
          let client;
          const early = [];
          process = await host.spawn("maple", {
            cwd,
            env: { BUZZ_PRIVATE_KEY: null, BUZZ_AUTH_TAG: null, BUZZ_RELAY_URL: null },
            onStdout: (chunk) => client ? client.feed(chunk) : early.push(chunk),
            onStderr: () => {},
          });
          client = slot.client = new AcpClient(process, (method, params) => {
            if (method !== "session/update" || params?.sessionId !== slot.sessionId) return;
            const update = params.update;
            if (update?.sessionUpdate === "tool_call") slot.current?.step?.(update.title || "Maple tool");
          });
          for (const chunk of early) client.feed(chunk);
          const init = await client.request("initialize", { protocolVersion: 1, clientInfo: { name: "buzz-maple", version: "0.1.0" }, clientCapabilities: {} });
          if (init.protocolVersion !== 1 || !init.agentCapabilities?.mcpCapabilities?.http) throw new Error("Maple must support ACP v1 with HTTP MCP");
          slot.steering = init._meta?.steering?.supported === true;
          const params = { cwd, mcpServers: [{ type: "http", name: "buzz", url: slot.server.url, headers: slot.server.headers }] };
          const session = await client.request(reusable ? "session/load" : "session/new", reusable ? { ...params, sessionId: saved.sessionId } : params);
          slot.sessionId = reusable ? saved.sessionId : session.sessionId;
          if (typeof slot.sessionId !== "string" || !slot.sessionId) throw new Error("Maple returned no session ID");
          await selectModel(client, { ...session, sessionId: slot.sessionId }, config.model);
          slot.cursor = reusable ? saved.cursor : undefined;
          slot.primed = reusable && saved.primed === true;
          if (disposed) throw new Error("Plugin stopped during Maple startup");
          await save(slot);
          return slot;
        } catch (error) {
          if (slot.client) await slot.client.close().catch(() => {});
          else if (process) await process.kill().catch(() => {});
          await slot.server?.close().catch(() => {});
          if (slots.get(id) === slot) slots.delete(id);
          throw error;
        }
      })();
    }
    return slot.ready;
  }
  function save(slot) {
    return agents.storage.set(slot.id, JSON.stringify({ sessionId: slot.sessionId, cwd: slot.cwd, signature: slot.signature, cursor: slot.cursor, primed: slot.primed }));
  }

  async function deliver(delivery) {
    const conversation = await kit.conversation(delivery, "thread");
    if (!conversation || !delivery.current()) { delivery.ignored?.(); return { ok: true }; }
    const config = normalize(delivery.config);
    const slot = await open(delivery, conversation, config);
    let completion;
    const dispatch = slot.control.then(async () => {
      if (!delivery.current()) { delivery.ignored?.(); return; }
      delivery.signal.throwIfAborted();
      const prompt = await kit.turnPrompt(delivery, conversation, { cursor: slot.cursor });
      try {
        if (slot.active) {
          if (!slot.steering) throw new Error("Maple does not support active-turn steering");
          const active = slot.active;
          const result = await slot.client.request("_session/steering", { sessionId: slot.sessionId, prompt: [{ type: "text", text: prompt.text }], _meta: { steering: { idleBehavior: "promptRequired" } } });
          if (result.outcome === "injected") {
            slot.cursor = prompt.cursor;
            await save(slot);
            delivery.acknowledged?.();
            completion = active;
            return;
          }
          if (result.outcome !== "promptRequired") throw new Error("Unknown Maple steering outcome");
        }
        const instructions = slot.primed ? "" : await kit.systemPrompt(delivery, { scope: "thread", cwd: slot.cwd, instructions: config.instructions, tools: true });
        // Maple currently has no advertised systemPrompt append support. Keep
        // its own system prompt and provide Buzz's instructions in first input.
        const text = instructions ? `${instructions}\n\n${prompt.text}` : prompt.text;
        slot.current = delivery;
        let written;
        const sent = new Promise((resolve) => { written = resolve; });
        const request = slot.client.request("session/prompt", { sessionId: slot.sessionId, prompt: [{ type: "text", text }] }, { timeout: 25 * 60 * 1000, sent: written });
        const cancel = () => { void slot.client.cancel(slot.sessionId).catch(() => {}); };
        delivery.signal.addEventListener("abort", cancel, { once: true });
        delivery.interruptible?.(() => slot.client.cancel(slot.sessionId));
        const active = request.then((result) => {
          if (result.stopReason !== "end_turn" && result.stopReason !== "cancelled") throw new Error("Maple turn ended before completion");
          return { ok: true, ...(result.stopReason === "cancelled" ? { stopped: true } : {}) };
        });
        slot.active = active;
        const settled = active.finally(() => {
          delivery.signal.removeEventListener("abort", cancel);
          if (slot.active === active) { slot.active = null; slot.current = null; }
        });
        // Observe failure immediately, including before the write acknowledgement.
        settled.catch(() => {});
        completion = settled;
        await Promise.race([sent, active]);
        slot.cursor = prompt.cursor;
        slot.primed = true;
        await save(slot);
        delivery.acknowledged?.();
      } catch (error) {
        prompt.restore();
        throw error;
      }
    });
    slot.control = dispatch.catch(() => {});
    await dispatch;
    try { return await completion ?? { ok: true }; }
    catch (error) {
      // Rebuild visible context on the next explicit request after a failed turn.
      slot.cursor = undefined;
      await save(slot);
      throw error;
    }
  }

  const h = React.createElement;
  function Fields({ config, onChange, disabled }) {
    const fields = [["cwd", "Working directory", false], ["model", "Model ID (blank uses Maple's default)", false], ["instructions", "Instructions", true]];
    return h("div", { style: { display: "grid", gap: "var(--space-field-gap, 12px)" } }, ...fields.map(([name, label, multiline]) =>
      h("label", { key: name, style: { display: "grid", gap: "6px" } }, h("span", null, label), h(multiline ? "textarea" : "input", {
        value: config[name] ?? "", disabled, rows: multiline ? 5 : undefined,
        style: { width: "100%", font: "inherit", color: "inherit", background: "var(--surface-panel)", border: "1px solid var(--border-prominent)", borderRadius: "6px", padding: "8px" },
        onChange: (event) => onChange({ ...config, [name]: event.target.value }),
      }))));
  }
  function Settings({ agent, save: saveConfig }) {
    const [config, setConfig] = React.useState(normalize(agent.config));
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState("");
    const perform = async (fn) => {
      setBusy(true); setNotice("");
      try { await fn(); setNotice("Saved"); } catch (error) { setNotice(error.message); } finally { setBusy(false); }
    };
    return h("div", { style: { display: "grid", gap: "16px" } }, h(Fields, { config, onChange: setConfig, disabled: busy }),
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
        h("button", { type: "button", disabled: busy, onClick: () => perform(() => saveConfig(normalize(config))) }, "Save"),
        h("button", { type: "button", disabled: busy, onClick: () => perform(() => retire(agent.key, true)) }, "Reset conversation sessions")),
      h("p", { role: "status" }, notice),
      h("p", null, "Maple runs on this computer using its Maple sign-in. Reset starts fresh Buzz sessions; saved Maple tasks remain."));
  }
  agents.register({
    id: "maple", title: "Maple", description: "Maple ACP on this computer", timeoutMs: 30 * 60 * 1000, resumes: true,
    defaults: () => ({ config: normalize() }),
    carry: (config) => ({ instructions: config.instructions }),
    adopt: (carry, config) => ({ ...config, instructions: carry.instructions || "" }),
    summary: (agent) => normalize(agent.config).model || "Maple default model",
    Create: Fields,
    tabs: [{ id: "settings", title: "Maple", role: "settings", component: Settings }],
    retire: (key) => retire(key),
    run(delivery) {
      const done = deliver(delivery).catch(() => ({ ok: false, error: "Maple run failed. Check the worker's Maple sign-in, working directory and runtime; reset conversation sessions if a saved task is unavailable." }));
      delivery.workingUntil(done);
    },
  });
}
