// Candidate finder for drafting a model. Output is a list of *leads* with file:line, not facts:
// the author must read the code and write evidence themselves. Read-only; uses `git ls-files`.
//
// Stacks understood: Node (Express, Hono, Fastify, Koa, Next, NestJS), Python (FastAPI, Flask, Django),
// Go (net/http, chi, gin, echo), Java (Spring annotations), plus infra files (nginx, Caddy, Ingress, compose, wrangler).
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP = /(^|\/)(node_modules|dist|build|out|\.git|vendor|coverage|\.wrangler|\.next|\.astro|\.venv|venv|__pycache__|target)\//;
const CODE = /\.(m?[jt]sx?|py|go|rs|java|kt|rb|php|cs|sql|toml|ya?ml|jsonc?|astro|vue|svelte|conf|hcl)$|(^|\/)Caddyfile$/i;
const TESTISH = /(^|\/)(tests?|__tests__|e2e|fixtures)\/|\.(test|spec)\.|_test\.go$|(^|\/)test_[^/]+\.py$/i;
const CONFIG_NAMES = /(^|\/)(wrangler\.(toml|jsonc?)|docker-compose[^/]*\.ya?ml|compose\.ya?ml|Dockerfile[^/]*|serverless\.ya?ml|vercel\.json|fly\.toml|netlify\.toml|_routes\.json|_worker\.js|openapi\.(json|ya?ml)|package\.json|go\.mod|requirements[^/]*\.txt|pyproject\.toml|Caddyfile|nginx[^/]*\.conf|[^/]+\.tf)$/;

/* ---------- stack ---------- */
const LANG_BY_EXT = { js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", go: "go", java: "java", kt: "kotlin", rb: "ruby", rs: "rust", php: "php", cs: "csharp" };
// package name (npm / pip / go module fragment) -> label
const LIBS = {
  express: "express", hono: "hono", fastify: "fastify", koa: "koa", next: "next", "@nestjs/core": "nestjs", "@hapi/hapi": "hapi", restify: "restify", nuxt: "nuxt", "@sveltejs/kit": "sveltekit", "itty-router": "itty-router",
  pg: "pg", mysql2: "mysql2", "better-sqlite3": "better-sqlite3", sqlite3: "sqlite3", mongoose: "mongoose", mongodb: "mongodb", ioredis: "ioredis", redis: "redis", "@prisma/client": "prisma", "drizzle-orm": "drizzle", typeorm: "typeorm", sequelize: "sequelize", knex: "knex", "@libsql/client": "libsql", axios: "axios", got: "got",
  fastapi: "fastapi", flask: "flask", django: "django", starlette: "starlette", aiohttp: "aiohttp", tornado: "tornado", sanic: "sanic", bottle: "bottle",
  sqlalchemy: "sqlalchemy", psycopg2: "psycopg2", "psycopg2-binary": "psycopg2", psycopg: "psycopg", asyncpg: "asyncpg", pymysql: "pymysql", pymongo: "pymongo", httpx: "httpx", requests: "requests",
  "gin-gonic/gin": "gin", "labstack/echo": "echo", "go-chi/chi": "chi", "gorilla/mux": "gorilla-mux", "gofiber/fiber": "fiber", "gorm.io/gorm": "gorm", "jackc/pgx": "pgx", "lib/pq": "pq", "redis/go-redis": "go-redis", "go-redis/redis": "go-redis",
};
const IMPORT_LIBS = [
  /(?:require\(\s*|from\s+|import\s+)["'](express|hono|fastify|koa|next|@nestjs\/core|pg|mysql2|better-sqlite3|sqlite3|mongoose|mongodb|ioredis|redis|axios|got)["']/g,
  /^\s*(?:from|import)\s+(fastapi|flask|django|starlette|aiohttp|sqlalchemy|psycopg2?|asyncpg|pymysql|pymongo|httpx|requests)\b/gm,
];

// standard-library servers (no framework to name)
const STD_SERVERS = [
  [/(?:from\s+|require\(\s*)["'](?:node:)?https?["']/, "node:http", /\.(m?[jt]sx?)$/],
  [/^\s*"net\/http"|^\s*import\s+"net\/http"|\bhttp\.NewServeMux\(|\bhttp\.ListenAndServe\(/m, "net/http", /\.go$/],
  [/^\s*(?:from|import)\s+http\.server\b/m, "http.server", /\.py$/],
];

function detectManifestLibs(file, text, add) {
  const base = file.slice(file.lastIndexOf("/") + 1);
  if (base === "package.json") {
    try {
      const j = JSON.parse(text);
      for (const k of Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.peerDependencies })) if (LIBS[k]) add(LIBS[k]);
    } catch { /* not valid json */ }
  } else if (/^requirements.*\.txt$|^pyproject\.toml$|^Pipfile$/.test(base)) {
    for (const ln of text.split("\n")) {
      const m = /^\s*["']?([A-Za-z0-9_.-]+)/.exec(ln);
      if (m && LIBS[m[1].toLowerCase()]) add(LIBS[m[1].toLowerCase()]);
      for (const k of Object.keys(LIBS)) if (/^[a-z0-9_-]+$/.test(k) && new RegExp(`["']${k}[\\s>=<~!\\]"']`, "i").test(ln)) add(LIBS[k]);
    }
  } else if (base === "go.mod") {
    for (const [k, v] of Object.entries(LIBS)) if ((k.includes("/") || k.includes(".")) && text.includes(k)) add(v);
  }
}

/* ---------- route leads ---------- */
const METHODS = "get|post|put|patch|delete|all|options|head";
const ROUTER_NAME = /^(app|router|api|server|fastify|hono|koa|route|routes|r|e|g|mux|engine|group|v\d+|\w*Router|\w*[Aa]pp|\w*Routes?)$/;
const RE_JS_ROUTE = new RegExp(`([A-Za-z_$][\\w$]*)\\.(${METHODS})\\(\\s*(["'\`])(\\/[^"'\`]*)\\3`, "i");
const RE_ROUTE_CALL = /\.route\(\s*["'`](\/[^"'`]*)["'`]/;
const RE_GO_HANDLE = /\.(?:HandleFunc|Handle)\(\s*"([^"]+)"/;
const RE_GO_VERB = /\.(Get|Post|Put|Patch|Delete|Options|Head|GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Any|ANY)\(\s*"(\/[^"]*)"/;
const RE_PY_DECO = /@[\w.]+\.(get|post|put|patch|delete|route|api_route|websocket)\(\s*["']([^"']*)["']/;
const RE_PY_METHODS = /methods\s*=\s*\[([^\]]*)\]/;
const RE_DJANGO = /\b(?:re_)?path\(\s*r?["']([^"']*)["']\s*,/;
const RE_SPRING = /@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:value\s*=\s*)?["']([^"']+)["']/;
const RE_NEST = /@(Get|Post|Put|Patch|Delete|All|Options|Head)\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/;

// hand-written routers: a string literal that is exactly "METHOD /path" (switch/case, key === "GET /x", route tables)
const RE_VERB_LITERAL = /["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/[^\s"'`]*)["'`]/;

function routeFromLine(file, ln, fileHasMethod = false) {
  return routeByFramework(file, ln) ?? literalRoute(file, ln) ?? dispatchRoute(file, ln, fileHasMethod);
}
// one handler that branches on the HTTP method (Go stdlib, Node http, Python http.server / hand-rolled)
function dispatchRoute(file, ln, fileHasMethod) {
  let m;
  if (file.endsWith(".go") && (m = /\bcase\s+http\.Method(Get|Post|Put|Patch|Delete|Head|Options)\b|\.Method\s*==\s*http\.Method(Get|Post|Put|Patch|Delete)\b/.exec(ln)))
    return { method: (m[1] ?? m[2]).toUpperCase(), path: "(method dispatch in one handler)" };
  if (/\.(m?[jt]sx?)$/.test(file) && fileHasMethod && (m = /\bcase\s+["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']\s*:/.exec(ln)))
    return { method: m[1], path: "(method dispatch in one handler)" };
  if (file.endsWith(".py") && (m = /\.method\s*(?:==|in)\s*[\(\[]?\s*["'](GET|POST|PUT|PATCH|DELETE)["']/.exec(ln)))
    return { method: m[1], path: "(method dispatch in one handler)" };
  return null;
}
function literalRoute(file, ln) {
  if (!/\.(m?[jt]sx?|py|go|java|kt|rb|php|cs)$/.test(file)) return null;
  const m = RE_VERB_LITERAL.exec(ln);
  return m ? { method: m[1], path: m[2] } : null;
}

function routeByFramework(file, ln) {
  const isGo = file.endsWith(".go"), isPy = file.endsWith(".py"), isJs = /\.(m?[jt]sx?|vue|svelte|astro)$/.test(file);
  let m;
  if (isPy) {
    if ((m = RE_PY_DECO.exec(ln))) {
      const verb = m[1].toLowerCase();
      let method = verb === "route" || verb === "api_route" ? "ANY" : verb.toUpperCase();
      const ms = RE_PY_METHODS.exec(ln);
      if (ms) method = ms[1].replace(/["'\s]/g, "").toUpperCase() || method;
      return { method, path: m[2] };
    }
    if (/urlpatterns|path\(|re_path\(/.test(ln) && (m = RE_DJANGO.exec(ln)) && /urls?\.py$|urlpatterns/.test(file + ln)) return { method: "ANY", path: m[1] };
    return null;
  }
  if (isGo) {
    if ((m = RE_GO_HANDLE.exec(ln))) {
      const mm = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/.*)$/.exec(m[1]);
      return mm ? { method: mm[1], path: mm[2] } : { method: "ANY", path: m[1] };
    }
    if ((m = RE_GO_VERB.exec(ln))) return { method: m[1].toUpperCase(), path: m[2] };
    return null;
  }
  if (file.endsWith(".java") || file.endsWith(".kt")) {
    return (m = RE_SPRING.exec(ln)) ? { method: m[1] === "Request" ? "ANY" : m[1].toUpperCase(), path: m[2] } : null;
  }
  if (isJs) {
    if ((m = RE_NEST.exec(ln))) return { method: m[1].toUpperCase(), path: m[2] ?? "" };
    if ((m = RE_JS_ROUTE.exec(ln)) && ROUTER_NAME.test(m[1])) return { method: m[2].toUpperCase(), path: m[4] };
    if ((m = RE_ROUTE_CALL.exec(ln))) return { method: "ANY", path: m[1] };
  }
  return null;
}

/** Next.js file-based routes: pages/api/** and app/**\/route.(ts|js). Returns [{method,path,line}] */
function nextRoutes(file, text) {
  let m = /(?:^|\/)pages\/api\/(.+)\.(?:[mc]?[jt]sx?)$/.exec(file);
  if (m) return [{ method: "ANY", path: "/api/" + m[1].replace(/\/?index$/, ""), line: 1 }];
  m = /(?:^|\/)app\/(.+)\/route\.(?:[mc]?[jt]sx?)$/.exec(file) ?? /(?:^|\/)app\/()route\.(?:[mc]?[jt]sx?)$/.exec(file);
  if (!m) return [];
  const dir = ("/" + (m[1] ?? "")).replace(/\/\([^/)]+\)/g, "");
  const out = [];
  text.split("\n").forEach((ln, i) => {
    const e = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.exec(ln);
    if (e) out.push({ method: e[1], path: dir === "" ? "/" : dir, line: i + 1 });
  });
  return out.length ? out : [{ method: "ANY", path: dir || "/", line: 1 }];
}

/* ---------- other leads ---------- */
const GATEWAY = [
  /\bproxy_pass\b/, /\breverse_proxy\b/, /\bNewSingleHostReverseProxy\b|\bReverseProxy\b/, /\bcreateProxyMiddleware\b|\bhttp-proxy\b|\bhttpProxy\b|\bproxyPass\b/,
  /^\s*kind:\s*Ingress\b|\bIngressRoute\b/, /\bimage:\s*["']?(?:[\w.\/-]*\/)?(?:traefik|nginx|envoyproxy|haproxy|kong|caddy)\b/,
  /\brewrites\s*\(|\bdestination:\s*["']https?:\/\//, /\baws_api_gateway|AWS::ApiGateway|\bapigateway\b/i,
  /\bfetch\(\s*[\w.$]+\s*\+\s*(?:req|request)\.(?:url|path)/, /\bconst\s+upstream\b|\bupstream\s*=/,
];
const DATA = [
  /\.(prepare|query|execute|exec)\(\s*[`"']\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i,
  /\b(new Pool|createPool|createClient|MongoClient|sqlite3?\.connect|redis\.)/,
  /(?:require\(\s*|from\s+|import\s+)["'](pg|mysql2?|better-sqlite3|sqlite3|mongoose|mongodb|ioredis|redis|@prisma\/client|drizzle-orm[^"']*|typeorm|sequelize|knex|@libsql\/client|node:sqlite)["']/,
  /\bnew\s+(Pool|Client|PrismaClient|Redis|DatabaseSync|MongoClient|Sequelize)\(/,
  /^\s*(?:from|import)\s+(sqlalchemy|psycopg2?|asyncpg|pymysql|pymongo|redis|sqlite3|motor|peewee|tortoise|databases)\b/,
  /\bcreate_engine\(|\bredis\.(Redis|from_url|StrictRedis)\(|\bsqlite3\.connect\(/,
  /\bsql\.Open\(|\bgorm\.Open\(|\bpgxpool\.New\(|\bpgx\.Connect\(|\bredis\.NewClient\(|\bmongo\.Connect\(|\bsqlx\.(Connect|Open)\(/,
  /^\s*image:\s*["']?(?:[\w.\/-]*\/)?(postgres|mysql|mariadb|mongo|redis|memcached|cassandra|clickhouse|elasticsearch|opensearch|rabbitmq|kafka)\b/,
];
// binding keys only count inside config files (otherwise `services: Foo[]` type fields match)
const DATA_CONFIG = /["']?\b(d1_databases|kv_namespaces|r2_buckets|queues|durable_objects|hyperdrive|services)\b["']?\s*[:=\[]/;
const CONFIG_FILE = /\.(toml|jsonc?|ya?ml)$/i;
const CLIENT = [
  /\bfetch\(/, /\baxios(?:\.\w+)?\(/, /\bgot(?:\.(?:get|post|put|patch|delete))?\(\s*["'`\w]/,
  /\brequests\.(get|post|put|patch|delete|request|Session)\b/, /\bhttpx\.(get|post|put|patch|delete|request|AsyncClient|Client)\b/, /\baiohttp\.ClientSession\b|\burllib\.request\.urlopen\b/,
  /\bhttp\.(Get|Post|NewRequest|NewRequestWithContext)\(/, /\b(?:RestTemplate|WebClient|HttpClient)\b/, /Net::HTTP/,
];
const ENV_NAME = "[A-Z][A-Z0-9_]{1,63}";
const ENV_READ = [
  new RegExp(`process\\.env\\.(${ENV_NAME})`, "g"), new RegExp(`process\\.env\\[["'](${ENV_NAME})["']\\]`, "g"),
  new RegExp(`os\\.environ(?:\\.get)?[\\[(]\\s*["'](${ENV_NAME})["']`, "g"), new RegExp(`os\\.getenv\\(\\s*["'](${ENV_NAME})["']`, "g"),
  new RegExp(`os\\.Getenv\\(\\s*"(${ENV_NAME})"`, "g"), new RegExp(`Deno\\.env\\.get\\(\\s*["'](${ENV_NAME})["']`, "g"),
];
const ENV_ADDRESS = /(URL|URI|HOST|ENDPOINT|ADDR|DSN|ORIGIN|UPSTREAM|BROKER|BACKEND)$|^(DATABASE|DB|REDIS|MONGO|POSTGRES|MYSQL|API|UPSTREAM)_/;
const ENV_SECRET = /(TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIAL)/;
const URLRE = /https?:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?::\d+)?[^\s"'`)<>]*/g;
const NOISE_HOSTS = /(^|\.)(w3\.org|example\.(com|org)|localhost|schema\.org|json-schema\.org|github\.com\/actions|npmjs\.org|mozilla\.org|apache\.org|opensource\.org|creativecommons\.org)$/i;

const PER_FILE_CAP = 4; // one big file must not hide the rest of the repo
// migration history is schema, not data access; these files also carry URLs that are not outbound calls
const NOISY_DATA_DIR = /(^|\/)(migrations?|alembic\/versions|db\/migrate|versions)\//i;
const NOISY_HOST_FILE = /\.(sql|md|mdx|lock|json|svg)$|(^|\/)(\.github|migrations?|alembic|docs?)\/|(^|\/)Dockerfile|\.gen\.[a-z]+$|pre-commit/i;

const clip = (s, n = 140) => { s = s.trim().replace(/\s+/g, " "); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

export function scanRepo(repoPath, { limit = 60 } = {}) {
  const list = execFileSync("git", ["-C", repoPath, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0").filter(Boolean);
  const out = { stack: { languages: [], frameworks: [] }, configs: [], routes: [], gateways: [], data: [], outbound: [], outboundEnv: [], clients: [], stats: { files: list.length, scanned: 0 } };
  const hosts = new Map(), envs = new Map(), langCount = {}, libs = new Set();
  for (const f of list) {
    if (SKIP.test(f)) continue;
    const ext = f.slice(f.lastIndexOf(".") + 1).toLowerCase();
    if (!TESTISH.test(f) && LANG_BY_EXT[ext]) langCount[LANG_BY_EXT[ext]] = (langCount[LANG_BY_EXT[ext]] ?? 0) + 1;
    const isConfig = CONFIG_NAMES.test(f) && !/package-lock/.test(f);
    if (isConfig) out.configs.push({ file: f, line: 1, text: f });
    if (!CODE.test(f) && !isConfig) continue;
    if (TESTISH.test(f)) continue;
    let text;
    try { if (statSync(join(repoPath, f)).size > 400_000) continue; text = readFileSync(join(repoPath, f), "utf8"); } catch { continue; }
    out.stats.scanned++;
    if (isConfig) detectManifestLibs(f, text, (l) => libs.add(l));
    for (const [re, label, only] of STD_SERVERS) if (only.test(f) && re.test(text)) libs.add(label);
    for (const re of IMPORT_LIBS) for (const m of text.matchAll(re)) if (LIBS[m[1].toLowerCase()]) libs.add(LIBS[m[1].toLowerCase()]);
    for (const r of nextRoutes(f, text)) out.routes.push({ file: f, line: r.line, method: r.method, path: r.path, text: `${r.method} ${r.path}  (file-based route)` });

    const lines = text.split("\n");
    const fileHasMethod = /\.method\b|\bMethod\b/.test(text);
    const noData = NOISY_DATA_DIR.test(f), noHosts = NOISY_HOST_FILE.test(f);
    const perFile = { data: 0, clients: 0, gateways: 0 };
    lines.forEach((ln, i) => {
      if (ln.length > 600) return;
      const rt = routeFromLine(f, ln, fileHasMethod);
      if (rt) out.routes.push({ file: f, line: i + 1, method: rt.method, path: rt.path, text: clip(ln) });
      const isComment = /^\s*(\/\/|#|\*|\/\*|<!--)/.test(ln);
      if (perFile.gateways < PER_FILE_CAP && GATEWAY.some((re) => re.test(ln))) { out.gateways.push({ file: f, line: i + 1, text: clip(ln) }); perFile.gateways++; }
      if (!noData && perFile.data < PER_FILE_CAP && (DATA.some((re) => re.test(ln)) || (CONFIG_FILE.test(f) && DATA_CONFIG.test(ln)))) { out.data.push({ file: f, line: i + 1, text: clip(ln) }); perFile.data++; }
      if (perFile.clients < PER_FILE_CAP && !isComment && CLIENT.some((re) => re.test(ln))) { out.clients.push({ file: f, line: i + 1, text: clip(ln) }); perFile.clients++; }
      for (const re of ENV_READ) for (const m of ln.matchAll(re)) {
        const name = m[1];
        if (ENV_SECRET.test(name) || !ENV_ADDRESS.test(name) || envs.has(name)) continue;
        envs.set(name, { file: f, line: i + 1, name, text: clip(ln) });
      }
      if (!noHosts && !isComment)
        for (const m of ln.matchAll(URLRE)) {
          const h = m[1].toLowerCase();
          if (NOISE_HOSTS.test(h)) continue;
          if (!hosts.has(h)) hosts.set(h, { file: f, line: i + 1, text: clip(ln), host: h });
        }
    });
  }
  out.outbound = [...hosts.values()];
  out.outboundEnv = [...envs.values()];
  out.stack.languages = Object.entries(langCount).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  out.stack.frameworks = [...libs].sort();
  for (const k of ["configs", "routes", "gateways", "data", "outbound", "outboundEnv", "clients"]) {
    out[k + "Total"] = out[k].length;
    out[k] = out[k].slice(0, limit);
  }
  return out;
}

export function formatScan(r) {
  const line = (x) => `  ${x.file}:${x.line}  ${x.host ? `[${x.host}] ` : x.name ? `[${x.name}] ` : ""}${x.text}`;
  const sec = (title, hint, items, total) =>
    [`## ${title} (${total}${total > items.length ? `, 상위 ${items.length}개 표시` : ""}) — ${hint}`, ...items.map(line), ""].join("\n");
  return [
    `# nacholens scan — 후보 목록 (사실이 아닙니다. 코드를 직접 읽고 근거를 쓰세요)`,
    `파일 ${r.stats.files}개 중 ${r.stats.scanned}개 검사`, "",
    `## 스택 — 언어: ${r.stack.languages.join(", ") || "(없음)"} · 프레임워크/라이브러리: ${r.stack.frameworks.join(", ") || "(없음)"}`, "",
    sec("설정/배포 파일", "게이트웨이·바인딩·컨테이너 구성을 확인", r.configs, r.configsTotal),
    sec("라우트 후보", "유즈케이스의 진입 요청(trigger)을 고르는 단서", r.routes, r.routesTotal),
    sec("게이트웨이 후보", "프록시·리버스 프록시·Ingress·리라이트 — gateway 컴포넌트와 via 의 단서", r.gateways, r.gatewaysTotal),
    sec("데이터 저장소 후보", "datastore 컴포넌트와 call 단계의 단서 (드라이버 import·연결·SQL·compose 이미지)", r.data, r.dataTotal),
    sec("바깥으로 나가는 호스트", "external 컴포넌트 후보 (호스트별 첫 위치)", r.outbound, r.outboundTotal),
    sec("환경변수로 주입되는 주소", "주소가 코드에 없고 설정으로 들어오는 external/내부 호출 (이름만, 값은 보지 않음)", r.outboundEnv, r.outboundEnvTotal),
    sec("HTTP 클라이언트 호출", "외부/내부 서비스를 부르는 코드 위치 — call 단계의 단서", r.clients, r.clientsTotal),
  ].join("\n");
}
