// The public demo shop really runs end to end (so the model describing it is not fiction).
// Spawns the three processes on free ports; needs node:sqlite (Node >= 22.13), else skipped.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { root } from "./helpers.js";

const hasSqlite = await import("node:sqlite").then(() => true, () => false);
// A port that can be bound explicitly (some sandboxes only allow certain ranges); retried until one works.
async function bindablePort() {
  for (let i = 0; i < 50; i++) {
    const p = await new Promise((res) => { const s = createServer().listen(0, "127.0.0.1", () => { const n = s.address().port; s.close(() => res(n)); }); });
    const ok = await new Promise((res) => { const s = createServer().once("error", () => res(false)).listen(p, "127.0.0.1", () => s.close(() => res(true))); });
    if (ok) return p;
  }
  throw new Error("no bindable port");
}

// Each process listens on port 0 and prints the port it got; the next one is pointed at it.
function start(file, dir, env) {
  const child = spawn(process.execPath, [join(dir, file)], { env: { ...process.env, NODE_NO_WARNINGS: "1", ...env }, stdio: ["ignore", "pipe", "inherit"] });
  const port = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) resolve(Number(m[1])); });
    child.on("exit", (c) => reject(new Error(`${file} exited early (${c})`)));
    setTimeout(() => reject(new Error(`${file} did not start`)), 8000).unref();
  });
  return { child, port };
}

async function runShop(version, fn) {
  const dir = join(root, "demo/shop", version), kids = [];
  try {
    const ext = start("mock-external.js", dir, { EXTERNAL_PORT: "0" }); kids.push(ext.child);
    const extPort = await ext.port;
    // the API compares the browser Origin with its public origin, so the gateway port must be known up front
    const gwPort = await bindablePort();
    const api = start("api.js", dir, { API_PORT: "0", EXTERNAL_URL: `http://127.0.0.1:${extPort}`, PUBLIC_ORIGIN: `http://127.0.0.1:${gwPort}` }); kids.push(api.child);
    const apiPort = await api.port;
    const gw = start("gateway.js", dir, { PORT: String(gwPort), API_URL: `http://127.0.0.1:${apiPort}` }); kids.push(gw.child);
    await gw.port;
    await fn(`http://127.0.0.1:${gwPort}`);
  } finally { kids.forEach((k) => { k.removeAllListeners("exit"); k.kill(); }); }
}

for (const version of ["v1", "v2"]) {
  test(`demo shop ${version}: sign-in, order, list, report, replay and origin checks work through the gateway`, { skip: !hasSqlite }, async () => {
    await runShop(version, async (base) => {
      const get = (path, init = {}) => fetch(base + path, { redirect: "manual", ...init });
      const start = await get("/api/auth/start");
      assert.equal(start.status, 302);
      const provider = await fetch(start.headers.get("location"), { redirect: "manual" });
      const callback = provider.headers.get("location");
      assert.match(callback, /\/api\/auth\/callback\?code=demo-code&state=/);
      const done = await get(callback.replace(/^https?:\/\/[^/]+/, ""));
      assert.equal(done.status, 302);
      const cookie = done.headers.get("set-cookie").split(";")[0];
      assert.match(cookie, /^sid=/);
      assert.equal((await get(callback.replace(/^https?:\/\/[^/]+/, ""))).status, 400, "state works once");
      assert.equal((await get("/api/orders")).status, 401);
      const json = { "content-type": "application/json", cookie };
      assert.equal((await get("/api/orders", { method: "POST", headers: { ...json, origin: "http://evil.example" }, body: '{"item":"x","qty":1}' })).status, 403);
      assert.equal((await get("/api/orders", { method: "POST", headers: { ...json, origin: base }, body: '{"item":"Mug","qty":0}' })).status, 400);
      assert.equal((await get("/api/orders", { method: "POST", headers: { ...json, origin: base }, body: '{"item":"Mug","qty":2}' })).status, 201);
      const list = await (await get("/api/orders", { headers: { cookie } })).json();
      assert.equal(list.orders.length, 1);
      assert.equal(list.orders[0].item, "Mug");
      if (version === "v2") assert.equal(list.orders[0].shipping, "in_transit");
      else assert.equal(list.orders[0].shipping, undefined);
      assert.deepEqual(await (await get("/api/reports/sales", { headers: { cookie } })).json(), { total: 12840, orders: 37 });
    });
  });
}
