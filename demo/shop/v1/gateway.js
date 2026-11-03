// Edge gateway: serves the static client and forwards /api/* to the API after a rate-limit check.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const API = process.env.API_URL ?? "http://127.0.0.1:8081";
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");
const LIMIT_PER_MINUTE = 120;
const hits = new Map();

function allowed(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const h = hits.get(ip);
  if (!h || h.minute !== minute) { hits.set(ip, { minute, n: 1 }); return true; }
  return ++h.n <= LIMIT_PER_MINUTE;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = http.createServer(async (req, res) => {
  const requestId = randomUUID();
  if (!allowed(req.socket.remoteAddress ?? "?")) { res.writeHead(429); return res.end("slow down"); }

  if (req.url.startsWith("/api/")) {
    const upstream = await fetch(API + req.url, {
      method: req.method,
      headers: { ...req.headers, host: new URL(API).host, "x-request-id": requestId },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
      duplex: "half",
      redirect: "manual",
    }).catch(() => null);
    if (!upstream) { res.writeHead(502); return res.end("bad gateway"); }
    const headers = Object.fromEntries(upstream.headers);
    delete headers["content-encoding"];
    res.writeHead(upstream.status, { ...headers, "x-request-id": requestId });
    return res.end(Buffer.from(await upstream.arrayBuffer()));
  }

  const name = req.url === "/" ? "index.html" : req.url.slice(1).replace(/[^\w.-]/g, "");
  const ext = name.slice(name.lastIndexOf("."));
  try {
    res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream" });
    res.end(await readFile(join(PUBLIC_DIR, name)));
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
server.listen(Number(process.env.PORT ?? 8080), "127.0.0.1", () => console.log("listening on :" + server.address().port));
