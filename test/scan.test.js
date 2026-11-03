// `scan` must find leads (not facts) in common stacks: Node (Express/Hono/Fastify/Next/Nest), Python (FastAPI/Flask/Django), Go (net/http/chi/gin).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { scanRepo, formatScan } from "../src/scan.js";
import { run } from "../src/cli.js";
import { makeDemoRepo } from "../src/demo.js";

function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), "sv-scan-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}
const has = (list, pred) => list.some(pred);
const route = (r, method, path) => has(r.routes, (x) => (x.method ?? "").toUpperCase() === method && x.path === path);

test("Express: stack, routes, postgres + redis drivers, axios client and env-based upstream", () => {
  const r = scanRepo(repoWith({
    "package.json": JSON.stringify({ dependencies: { express: "^4", pg: "^8", ioredis: "^5", axios: "^1" } }),
    "src/server.js": [
      'const express = require("express");', 'const { Pool } = require("pg");', 'const Redis = require("ioredis");', 'const axios = require("axios");',
      "const app = express();", "const pool = new Pool();",
      'app.get("/api/items", async (req, res) => {', '  const rows = await pool.query("SELECT * FROM items");', "  res.json(rows);", "});",
      'app.post("/api/items", create);',
      'const r = await axios.get(process.env.PAYMENTS_URL + "/charge");',
    ].join("\n"),
  }));
  assert.ok(r.stack.frameworks.includes("express"), JSON.stringify(r.stack));
  assert.ok(r.stack.languages.includes("javascript"));
  assert.ok(route(r, "GET", "/api/items") && route(r, "POST", "/api/items"));
  assert.ok(has(r.data, (x) => /pg|Pool/.test(x.text)), "pg driver");
  assert.ok(has(r.data, (x) => /ioredis|Redis/.test(x.text)), "redis driver");
  assert.ok(has(r.clients, (x) => /axios\.get/.test(x.text)), "http client call");
  assert.ok(has(r.outboundEnv, (x) => x.name === "PAYMENTS_URL"), "upstream configured by env var");
});

test("Hono / Fastify / Koa style routers are recognised", () => {
  const r = scanRepo(repoWith({
    "package.json": JSON.stringify({ dependencies: { hono: "^4", fastify: "^4" } }),
    "src/a.ts": 'const app = new Hono();\napp.get("/health", (c) => c.text("ok"));\napp.route("/v1", v1);\n',
    "src/b.ts": 'fastify.post("/orders", handler);\nrouter.delete("/orders/:id", remove);\n',
  }));
  for (const [m, p] of [["GET", "/health"], ["POST", "/orders"], ["DELETE", "/orders/:id"]]) assert.ok(route(r, m, p), `${m} ${p}`);
  assert.ok(r.stack.frameworks.includes("hono") && r.stack.frameworks.includes("fastify"));
});

test("Next.js: file-based API routes become route leads (pages/api and app router)", () => {
  const r = scanRepo(repoWith({
    "package.json": JSON.stringify({ dependencies: { next: "14" } }),
    "pages/api/users/[id].ts": "export default function handler(req, res) { res.json({}); }\n",
    "app/api/orders/route.ts": "export async function GET() {}\nexport async function POST(req) {}\n",
    "next.config.js": 'module.exports = { async rewrites() { return [{ source: "/api/:path*", destination: "https://backend.internal.example.org/:path*" }]; } };\n',
  }));
  assert.ok(has(r.routes, (x) => x.path === "/api/users/[id]"), JSON.stringify(r.routes));
  assert.ok(route(r, "GET", "/api/orders") && route(r, "POST", "/api/orders"));
  assert.ok(has(r.gateways, (x) => /rewrites|destination/.test(x.text)), "next rewrites are a gateway lead");
  assert.ok(r.stack.frameworks.includes("next"));
});

test("NestJS decorators with and without arguments", () => {
  const r = scanRepo(repoWith({
    "package.json": JSON.stringify({ dependencies: { "@nestjs/core": "10" } }),
    "src/cats.controller.ts": "@Controller('cats')\nexport class Cats {\n  @Get()\n  all() {}\n  @Post(':id')\n  one() {}\n}\n",
  }));
  assert.ok(has(r.routes, (x) => /@Get\(\)/.test(x.text)) && has(r.routes, (x) => /@Post/.test(x.text)));
  assert.ok(r.stack.frameworks.includes("nestjs"));
});

test("Python: FastAPI + Flask + Django routes, SQLAlchemy/psycopg/redis, requests/httpx clients, os.environ upstreams", () => {
  const r = scanRepo(repoWith({
    "requirements.txt": "fastapi==0.110\nflask\nsqlalchemy\npsycopg2-binary\nhttpx\nrequests\n",
    "app/main.py": [
      "from fastapi import FastAPI", "import httpx", "from sqlalchemy import create_engine", "import os, redis",
      "app = FastAPI()", 'engine = create_engine(os.environ["DATABASE_URL"])', "cache = redis.Redis()",
      '@app.get("/items/{item_id}")', "async def read(item_id: int):", '    r = httpx.get(os.environ["PRICING_URL"] + "/p")', "    return r.json()",
      '@app.post("/items")', "def create(): ...",
    ].join("\n"),
    "web/views.py": 'from flask import Flask\napp = Flask(__name__)\n@app.route("/ping", methods=["GET"])\ndef ping(): ...\n',
    "shop/urls.py": 'from django.urls import path\nurlpatterns = [path("orders/", views.orders), path("orders/<int:pk>/", views.order)]\n',
  }));
  assert.ok(route(r, "GET", "/items/{item_id}") && route(r, "POST", "/items"));
  assert.ok(has(r.routes, (x) => x.path === "/ping"));
  assert.ok(has(r.routes, (x) => x.path === "orders/"), "django path()");
  assert.ok(has(r.data, (x) => /create_engine/.test(x.text)) && has(r.data, (x) => /redis\.Redis/.test(x.text)));
  assert.ok(has(r.clients, (x) => /httpx\.get/.test(x.text)));
  assert.ok(has(r.outboundEnv, (x) => x.name === "PRICING_URL") && has(r.outboundEnv, (x) => x.name === "DATABASE_URL"));
  for (const f of ["fastapi", "flask", "django", "sqlalchemy", "httpx"]) assert.ok(r.stack.frameworks.includes(f), f);
  assert.ok(r.stack.languages.includes("python"));
});

test("Go: net/http (1.22 method patterns), chi, gin; database/sql, gorm, redis; http.Get; os.Getenv upstream; reverse proxy gateway", () => {
  const r = scanRepo(repoWith({
    "go.mod": "module example.com/shop\n\ngo 1.22\n\nrequire (\n\tgithub.com/go-chi/chi/v5 v5.0.0\n\tgithub.com/gin-gonic/gin v1.9.0\n\tgorm.io/gorm v1.25.0\n)\n",
    "main.go": [
      "package main", 'import ("database/sql"; "net/http"; "net/http/httputil"; "os")',
      "func main() {",
      '  mux := http.NewServeMux()', '  mux.HandleFunc("GET /orders/{id}", getOrder)', '  mux.HandleFunc("/health", health)',
      '  db, _ := sql.Open("postgres", os.Getenv("DATABASE_URL"))',
      '  r := chi.NewRouter()', '  r.Get("/chi/items", items)', '  r.Post("/chi/items", add)',
      '  g := gin.Default()', '  g.GET("/gin/ping", ping)',
      '  p := httputil.NewSingleHostReverseProxy(target)', '  resp, _ := http.Get(os.Getenv("TRACKING_URL") + "/t")',
      "}",
    ].join("\n"),
  }));
  assert.ok(route(r, "GET", "/orders/{id}"), JSON.stringify(r.routes.map((x) => [x.method, x.path])));
  for (const p of ["/health", "/chi/items", "/gin/ping"]) assert.ok(has(r.routes, (x) => x.path === p), p);
  assert.ok(has(r.data, (x) => /sql\.Open/.test(x.text)));
  assert.ok(has(r.gateways, (x) => /ReverseProxy/.test(x.text)), "reverse proxy is a gateway lead");
  assert.ok(has(r.clients, (x) => /http\.Get/.test(x.text)));
  assert.ok(has(r.outboundEnv, (x) => x.name === "TRACKING_URL"));
  for (const f of ["chi", "gin", "gorm"]) assert.ok(r.stack.frameworks.includes(f), f);
  assert.ok(r.stack.languages.includes("go"));
});

test("Gateway/infra files: nginx proxy_pass, Caddy reverse_proxy, k8s Ingress, docker-compose images", () => {
  const r = scanRepo(repoWith({
    "deploy/nginx.conf": "server {\n  location /api/ {\n    proxy_pass http://api:8081;\n  }\n}\n",
    "Caddyfile": "example.org {\n  reverse_proxy /api/* localhost:9000\n}\n",
    "k8s/ingress.yaml": "apiVersion: networking.k8s.io/v1\nkind: Ingress\nspec:\n  rules: []\n",
    "docker-compose.yml": "services:\n  gateway:\n    image: traefik:v3\n  db:\n    image: postgres:16\n",
  }));
  assert.ok(has(r.gateways, (x) => /proxy_pass/.test(x.text)));
  assert.ok(has(r.gateways, (x) => /reverse_proxy/.test(x.text)));
  assert.ok(has(r.gateways, (x) => /kind: Ingress/.test(x.text)));
  assert.ok(has(r.gateways, (x) => /traefik/.test(x.text)));
  assert.ok(has(r.data, (x) => /postgres/.test(x.text)), "compose database image");
});

test("noise control: tests, vendored code and unrelated .get() calls are not routes", () => {
  const r = scanRepo(repoWith({
    "package.json": "{}",
    "src/client.js": 'const v = cache.get("key");\nconst m = map.get("x");\napi.get(token);\n',
    "node_modules/x/index.js": 'app.get("/hidden", h);\n',
    "test/a.test.js": 'app.get("/in-test", h);\n',
  }));
  assert.equal(r.routes.length, 0, JSON.stringify(r.routes));
});

test("demo shop: scan finds its routes, sqlite, env-configured upstreams and clients (no private repo needed)", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "sv-scan-demo-")), "repo");
  makeDemoRepo(dir);
  const r = scanRepo(dir);
  assert.ok(has(r.routes, (x) => x.path === "/api/orders" || /GET \/api\/orders/.test(x.text)), JSON.stringify(r.routes.slice(0, 5)));
  assert.ok(has(r.data, (x) => /node:sqlite|DatabaseSync/.test(x.text)));
  assert.ok(has(r.outboundEnv, (x) => x.name === "EXTERNAL_URL") && has(r.outboundEnv, (x) => x.name === "API_URL"));
  assert.ok(has(r.clients, (x) => /fetch\(/.test(x.text)));
  assert.ok(has(r.gateways, (x) => /gateway\.js/.test(x.file)), "a forwarding fetch in gateway.js");
  assert.ok(r.stack.languages.includes("javascript"));
});

test("scan --json and the text report expose the new sections", () => {
  const dir = repoWith({ "package.json": JSON.stringify({ dependencies: { express: "4" } }), "a.js": 'app.get("/x", h);\n' });
  const out = [];
  assert.equal(run(["scan", "--repo", dir, "--json"], {}, (l) => out.push(l)), 0);
  const json = JSON.parse(out.join("\n"));
  for (const k of ["stack", "configs", "routes", "gateways", "data", "outbound", "outboundEnv", "clients"]) assert.ok(k in json, k);
  const text = formatScan(scanRepo(dir));
  for (const h of ["스택", "라우트", "게이트웨이", "데이터", "환경변수", "HTTP 클라이언트"]) assert.ok(text.includes(h), h);
});

test("real-repo noise: URLs in comments, SQL defaults, CI/Docker files and migration files are not leads; data leads are capped per file", () => {
  const imports = Array.from({ length: 9 }, (_, i) => `import sqlalchemy as sa${i}`).join("\n");
  const r = scanRepo(repoWith({
    "src/client.js": ["// see https://docs.example-docs.dev/guide", "# https://comment.example-docs.dev", "const base = 'https://api.payments-live.io/v1';"].join("\n"),
    "db/migrations/001.sql": "ALTER TABLE u ALTER COLUMN image SET DEFAULT 'https://img.sql-default.net/x';\n",
    ".github/workflows/ci.yml": "steps:\n  - run: curl https://install.ci-only.sh | sh\n",
    "Dockerfile": "RUN curl -fsSL https://bun.dockerfile-only.sh/install | bash\n",
    "README.md": "see https://readme.only.org\n",
    "backend/alembic/versions/a.py": imports + "\n",
    "backend/app/db.py": imports + "\nengine = create_engine(url)\n",
  }));
  assert.deepEqual(r.outbound.map((x) => x.host), ["api.payments-live.io"]);
  assert.ok(!r.data.some((x) => x.file.includes("alembic/versions")), "migration history is not a data-access lead");
  assert.ok(r.data.filter((x) => x.file === "backend/app/db.py").length <= 4, "per-file cap keeps one big file from hiding the rest");
  assert.ok(r.data.some((x) => /create_engine/.test(x.text)) || r.data.filter((x) => x.file === "backend/app/db.py").length === 4);
});

test("Go stdlib server: method dispatch inside a single handler is a route lead; net/http is named in the stack", () => {
  const r = scanRepo(repoWith({
    "go.mod": "module x\n\ngo 1.22\n",
    "cmd/main.go": 'package main\nimport "net/http"\nfunc main() {\n  router := http.NewServeMux()\n  router.HandleFunc("POST /api/students", h)\n}\n',
    "internal/h.go": 'package h\nimport "net/http"\nfunc New() http.HandlerFunc { return func(w http.ResponseWriter, r *http.Request) {\n  switch r.Method {\n  case http.MethodPost:\n  case http.MethodGet:\n  case http.MethodDelete:\n  }\n} }\n',
  }));
  assert.ok(route(r, "POST", "/api/students"));
  const dispatch = r.routes.filter((x) => x.file === "internal/h.go").map((x) => x.method).sort();
  assert.deepEqual(dispatch, ["DELETE", "GET", "POST"]);
  assert.ok(r.routes.some((x) => /dispatch/.test(x.path) || /method/.test(x.text)));
  assert.ok(r.stack.frameworks.includes("net/http"), JSON.stringify(r.stack));
});

test("Node and Python stdlib servers are named in the stack", () => {
  const r = scanRepo(repoWith({
    "api.js": 'import http from "node:http";\nswitch (req.method) {\n  case "GET": break;\n  case "PUT": break;\n}\n',
    "srv.py": "from http.server import BaseHTTPRequestHandler\nif request.method == 'POST':\n    pass\n",
  }));
  assert.ok(r.stack.frameworks.includes("node:http") && r.stack.frameworks.includes("http.server"), JSON.stringify(r.stack));
  assert.ok(r.routes.some((x) => x.file === "api.js" && x.method === "GET") && r.routes.some((x) => x.file === "srv.py" && x.method === "POST"));
});
