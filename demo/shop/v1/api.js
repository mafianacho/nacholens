// Order API: sessions, orders, sales report. Talks to SQLite and to external services.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { saveState, consumeState, saveSession, findSession, listOrders, insertOrder } from "./db.js";

const EXTERNAL = process.env.EXTERNAL_URL ?? "http://127.0.0.1:8090";
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:8080";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMINS = new Set((process.env.ADMIN_EMAILS ?? "buyer@example.com").split(","));

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve(null); } });
});

function sessionOf(req) {
  const m = /(?:^|; )sid=([\w-]+)/.exec(req.headers.cookie ?? "");
  return m ? findSession(m[1]) : null;
}

async function route(req, res) {
  const url = new URL(req.url, "http://x");
  const key = `${req.method} ${url.pathname}`;

  if (key === "GET /api/auth/start") {
    const state = randomUUID();
    saveState(state);
    const to = new URL(EXTERNAL + "/authorize");
    to.searchParams.set("state", state);
    to.searchParams.set("redirect_uri", PUBLIC_ORIGIN + "/api/auth/callback");
    return send(res, 302, { redirect: to.toString() }, { location: to.toString() });
  }

  if (key === "GET /api/auth/callback") {
    if (!consumeState(url.searchParams.get("state") ?? "")) return send(res, 400, { error: "bad_state" });
    const token = await fetch(EXTERNAL + "/token", { method: "POST", body: JSON.stringify({ code: url.searchParams.get("code") }) });
    if (!token.ok) return send(res, 502, { error: "provider_failed" });
    const { email } = await token.json();
    const sid = randomUUID();
    saveSession(sid, email, SESSION_TTL_MS);
    return send(res, 302, { ok: true }, { location: "/", "set-cookie": `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}` });
  }

  const me = sessionOf(req);
  if (!me) return send(res, 401, { error: "unauthenticated" });

  if (key === "GET /api/orders") {
    const rows = listOrders(me.email);
    return send(res, 200, { orders: rows.map((o) => ({ id: o.id, item: o.item, qty: o.qty, createdAt: o.created_at })) });
  }

  if (key === "POST /api/orders") {
    if (req.headers.origin !== PUBLIC_ORIGIN) return send(res, 403, { error: "bad_origin" });
    const body = await readBody(req);
    if (!body || typeof body.item !== "string" || !Number.isInteger(body.qty) || body.qty < 1 || body.qty > 99)
      return send(res, 400, { error: "invalid_order" });
    const id = insertOrder(me.email, body.item.slice(0, 80), body.qty);
    return send(res, 201, { id });
  }

  if (key === "GET /api/reports/sales") {
    if (!ADMINS.has(me.email)) return send(res, 403, { error: "forbidden" });
    const r = await fetch(EXTERNAL + "/sales");
    if (!r.ok) return send(res, 502, { error: "analytics_unavailable" });
    return send(res, 200, await r.json());
  }

  send(res, 404, { error: "not_found" });
}

const server = http.createServer((req, res) => route(req, res).catch(() => send(res, 500, { error: "internal" })));
server.listen(Number(process.env.API_PORT ?? 8081), "127.0.0.1", () => console.log("listening on :" + server.address().port));
