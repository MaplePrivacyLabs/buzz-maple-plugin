// ACP v1 NDJSON over Buzz's host-owned process. No runtime dependencies.
export class AcpClient {
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

export async function selectModel(client, session, model) {
  if (!model) return;
  const option = session.configOptions?.find((item) => item.category === "model");
  if (!option) throw new Error("Maple does not advertise model selection");
  const choices = option.options?.flatMap((item) => item.options ?? [item]) ?? [];
  if (!choices.some((item) => item.value === model)) throw new Error("Selected model is unavailable in Maple");
  const result = await client.request("session/set_config_option", { sessionId: session.sessionId, configId: option.configId, value: model });
  const confirmed = result.configOptions?.find((item) => item.configId === option.configId);
  if (confirmed?.currentValue !== model) throw new Error("Maple did not confirm the selected model");
}
