// A3 compare, C1 intent check, C5 regression map: pure functions, CLI wiring, page embed and the panel itself.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { run, EXIT } from "../src/cli.js";
import { buildPage } from "../src/page.js";
import { makeDemoRepo } from "../src/demo.js";
import { buildCompare, checkIntent, validateIntent, buildImpact, discoverTests, triggerPaths, buildReview } from "../src/review.js";
import { demoModel, demoAutoChanges, readJson, clone, root } from "./helpers.js";

const intentExample = () => readJson("models/demo-shop/intent.example.json");
const tmp = () => mkdtempSync(join(tmpdir(), "sv-review-"));
const quiet = () => { const out = []; return { out, log: (m) => out.push(String(m)) }; };

// ───────── A3 ─────────
test("compare (overlay mode): an added step has nothing before, a modified step says the old text is unknown", () => {
  const c = buildCompare(demoModel(), demoAutoChanges());
  assert.equal(c.mode, "overlay");
  const uc = c.useCases.find((u) => u.id === "list-orders");
  const ship = uc.rows.find((r) => r.id === "shipping");
  assert.equal(ship.status, "added"); assert.equal(ship.before, null); assert.ok(ship.after.label);
  const shape = uc.rows.find((r) => r.id === "shape");
  assert.equal(shape.status, "modified"); assert.ok(shape.before && shape.after); assert.match(shape.note, /the model has no earlier version/);
  assert.equal(uc.rows.find((r) => r.id === "query").status, "same");
  assert.equal(uc.state, "changed");
  assert.equal(c.useCases.find((u) => u.id === "sales-report").state, "same");
  assert.deepEqual(c.summary, { useCases: 2, added: 1, removed: 0, modified: 3, moved: 0 });
});

test("compare (overlay mode): the path before leaves out components reached only by added steps", () => {
  const uc = buildCompare(demoModel(), demoAutoChanges()).useCases.find((u) => u.id === "list-orders");
  assert.ok(uc.pathAfter.includes("shipping")); assert.ok(!uc.pathBefore.includes("shipping"));
});

test("compare (two models): added, removed, modified-flow and moved steps are told apart", () => {
  const after = demoModel(), before = clone(after);
  const u = before.useCases.find((x) => x.id === "list-orders");
  u.steps = u.steps.filter((s) => s.id !== "shipping");            // added in `after`
  u.steps.splice(2, 0, { ...clone(after.useCases[2].steps[3]), id: "legacy", label: "Legacy step" }); // only in `before` -> removed
  before.useCases.find((x) => x.id === "place-order").steps.find((s) => s.id === "validate").label = "Old validate label"; // flow changed
  const o = before.useCases.find((x) => x.id === "sales-report");
  [o.steps[1], o.steps[2]] = [o.steps[2], o.steps[1]];            // moved
  const c = buildCompare(after, null, before);
  assert.equal(c.mode, "two-models");
  const rows = (id) => c.useCases.find((x) => x.id === id).rows;
  assert.equal(rows("list-orders").find((r) => r.id === "shipping").status, "added");
  const legacy = rows("list-orders").find((r) => r.id === "legacy");
  assert.equal(legacy.status, "removed"); assert.equal(legacy.after, null);
  assert.equal(rows("list-orders").findIndex((r) => r.id === "legacy"), rows("list-orders").findIndex((r) => r.id === "session") + 1);
  const val = rows("place-order").find((r) => r.id === "validate");
  assert.equal(val.status, "modified"); assert.deepEqual(val.fields, ["label"]); assert.equal(val.before.label, "Old validate label");
  assert.ok(rows("sales-report").some((r) => r.status === "moved"));
  assert.equal(rows("sign-in").every((r) => r.status === "same"), true);
});

test("compare (two models): a use case present on one side only is reported as added or removed", () => {
  const after = demoModel(), before = clone(after);
  before.useCases = before.useCases.filter((x) => x.id !== "sales-report");
  before.useCases.push({ ...clone(after.useCases[1]), id: "gone", title: "Gone" });
  const c = buildCompare(after, null, before);
  assert.equal(c.useCases.find((x) => x.id === "sales-report").state, "added");
  assert.equal(c.useCases.find((x) => x.id === "gone").state, "removed");
  assert.ok(c.useCases.find((x) => x.id === "gone").rows.every((r) => r.status === "removed" && r.after === null));
});

// ───────── C1 ─────────
test("intent: the bundled example validates against the demo model", () => {
  assert.deepEqual(validateIntent(intentExample(), demoModel()), []);
});

test("intent: validation rejects unknown components, duplicate ids, bad check types and missing use case", () => {
  const m = demoModel(), bad = intentExample();
  bad.expectations[1].id = bad.expectations[0].id;
  bad.expectations[2].check.first.from = "nowhere";
  bad.expectations[3].check.type = "magic";
  bad.expectations[4].useCase = "nope";
  delete bad.expectations[0].useCase;
  const e = validateIntent(bad, m).join("\n");
  assert.match(e, /duplicate/); assert.match(e, /component not in the model \(nowhere\)/); assert.match(e, /check\.type/); assert.match(e, /use case not in the model \(nope\)/); assert.match(e, /required when check is given/);
  assert.match(validateIntent({ schemaVersion: 1, title: "t", expectations: [] }, m).join(), /1-60 items/);
  assert.match(validateIntent({ ...intentExample(), expectations: [{ id: "a", text: "t", useCase: "list-orders", check: { type: "step", match: { text: "x", bogus: 1 } } }] }, m).join(), /unknown condition/);
});

test("intent: met, unmet and unknown come from the model, never from guessing", () => {
  const r = checkIntent(demoModel(), intentExample(), demoAutoChanges());
  const st = Object.fromEntries(r.results.map((x) => [x.id, x.status]));
  assert.deepEqual(st, { "ship-lookup": "met", "ship-fail-soft": "met", "login-first": "met", "admin-only": "met", "address-check": "unmet", "ship-wording": "unknown" });
  assert.deepEqual({ ...r.summary }, { total: 6, met: 4, unmet: 1, unknown: 1, touched: 2, uncovered: 3, changedSteps: 4 });
  const ship = r.results.find((x) => x.id === "ship-lookup");
  assert.equal(ship.touched, true); assert.equal(ship.proof[0].change, "added"); assert.match(ship.proof[0].evidence, /api\.js:\d+/);
  assert.equal(r.results.find((x) => x.id === "login-first").touched, false);
  assert.match(r.results.find((x) => x.id === "ship-wording").reason, /No automatic check/);
});

test("intent: order is unmet when the steps come in the wrong order, absent flips the verdict", () => {
  const m = demoModel();
  const mk = (check) => ({ schemaVersion: 1, title: "t", expectations: [{ id: "x", text: "t", useCase: "list-orders", check }] });
  const run1 = (check) => checkIntent(m, mk(check)).results[0];
  assert.equal(run1({ type: "order", first: { table: "sessions" }, then: { table: "orders" } }).status, "met");
  assert.equal(run1({ type: "order", first: { table: "orders" }, then: { table: "sessions" } }).status, "unmet");
  assert.match(run1({ type: "order", first: { table: "nothing" }, then: { table: "orders" } }).reason, /no step that should come first/);
  assert.equal(run1({ type: "absent", match: { to: "analytics" } }).status, "met");
  assert.equal(run1({ type: "absent", match: { to: "shipping" } }).status, "unmet");
  assert.equal(run1({ type: "step", match: { with: "gateway", kind: "request" } }).status, "met");
});

test("intent: changed steps that no expectation points at are listed as uncovered; a use-case-only unknown claims its use case", () => {
  const it = { schemaVersion: 1, title: "t", expectations: [{ id: "all-list", text: "주문 목록 전반", useCase: "list-orders" }] };
  const r = checkIntent(demoModel(), it, demoAutoChanges());
  assert.deepEqual(r.uncovered.map((u) => `${u.useCase}/${u.step}`), ["place-order/insert"]);
  assert.equal(checkIntent(demoModel(), it, null).summary.changedSteps, 0);
});

// ───────── C5 ─────────
test("impact: a use case that shares a changed table is indirect, with the reason and the step to re-check", () => {
  const im = buildImpact(demoModel(), demoAutoChanges());
  const lo = im.useCases.find((u) => u.id === "list-orders");
  assert.equal(lo.relation, "direct");
  const t = lo.reasons.find((r) => r.kind === "table");
  assert.equal(t.step, "query"); assert.match(t.text, /db\.orders/); assert.match(t.text, /place-order\/insert/);
  assert.ok(lo.recheck.some((r) => r.step === "query"));
  assert.equal(im.useCases.find((u) => u.id === "sales-report"), undefined);
  assert.equal(im.useCases.find((u) => u.id === "sign-in"), undefined);
});

test("impact: a use case with no changed step but a shared table is indirect", () => {
  const m = demoModel();
  const ch = { title: "t", summary: "s", ref: "r", components: [], steps: [{ useCase: "place-order", step: "insert", change: "modified", note: "n" }], unmapped: [], ignored: [] };
  const im = buildImpact(m, ch);
  const list = im.useCases.find((u) => u.id === "list-orders");
  assert.equal(list.relation, "indirect"); assert.deepEqual(list.direct, []);
  assert.equal(im.useCases.find((u) => u.id === "place-order").relation, "direct");
  assert.equal(im.summary.indirect, 1);
});

test("impact: a changed step's own parts, wires and endpoints are not repeated as reasons", () => {
  const lo = buildImpact(demoModel(), demoAutoChanges()).useCases.find((u) => u.id === "list-orders");
  assert.ok(!lo.reasons.some((r) => r.step === "shipping"));
});

test("impact: a changed endpoint definition reaches another use case that calls the same endpoint", () => {
  const m = demoModel();
  const other = clone(m.useCases.find((u) => u.id === "list-orders"));
  m.useCases.push({ ...other, id: "export-orders", title: "Export", trigger: "GET /api/orders/export", steps: other.steps.map((s) => ({ ...s, id: "x-" + s.id })) });
  const ch = { title: "t", summary: "s", ref: "r", components: [], steps: [{ useCase: "list-orders", step: "shipping", change: "modified", note: "n" }], unmapped: [], ignored: [] };
  const im = buildImpact(m, ch);
  const ex = im.useCases.find((u) => u.id === "export-orders");
  assert.equal(ex.relation, "indirect");
  assert.ok(ex.reasons.some((r) => r.kind === "endpoint" && r.ref === "shipping/track"));
});

test("triggerPaths / discoverTests: boundary-aware route matching and test states", () => {
  assert.deepEqual(triggerPaths("GET /api/auth/start → provider → GET /api/auth/callback"), ["/api/auth/start", "/api/auth/callback"]);
  const m = demoModel();
  const files = [
    { path: "test/orders.test.js", text: 'fetch("/api/orders"); fetch("/api/orders/7")' },
    { path: "test/archive.test.js", text: 'fetch("/api/orders-archive")' },
    { path: "test/report.test.js", text: 'get("/api/reports/sales")' },
  ];
  const t = discoverTests(m, files, ["test/report.test.js"]);
  assert.deepEqual(t.byUseCase["list-orders"].map((f) => f.file), ["test/orders.test.js"]);
  assert.deepEqual(t.byUseCase["place-order"].map((f) => f.file), ["test/orders.test.js"]);
  assert.deepEqual(t.byUseCase["sign-in"], []);
  const ch = { ...demoAutoChanges(), steps: [...demoAutoChanges().steps, { useCase: "sales-report", step: "analytics", change: "modified", note: "n" }, { useCase: "sign-in", step: "start", change: "modified", note: "n" }] };
  const im = buildImpact(m, ch, t);
  const state = Object.fromEntries(im.useCases.map((u) => [u.id, u.tests.state]));
  assert.equal(state["list-orders"], "covered"); assert.equal(state["sales-report"], "covered-changed"); assert.equal(state["sign-in"], "none-found");
  assert.equal(im.summary.withoutTests, 1);
  assert.equal(im.useCases[0].id, "sign-in", "direct + no test is listed first");
  assert.equal(buildImpact(m, ch, null).useCases.every((u) => u.tests.state === "unknown"), true);
});

test("buildReview: null without overlay, intent or before-model", () => {
  assert.equal(buildReview(demoModel(), null), null);
  const r = buildReview(demoModel(), demoAutoChanges(), { intent: intentExample() });
  assert.ok(r.compare && r.intent && r.impact);
});

test("cli impact on a real repo: a test file that mentions the route is found, and is reported as changed when the diff touches it", () => {
  const dir = tmp(), repoDir = join(dir, "repo"), { base } = makeDemoRepo(repoDir);
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const git = (...a) => execFileSync("git", a, { cwd: repoDir, env, encoding: "utf8" }).trim();
  const modelHead = git("rev-parse", "HEAD");
  mkdirSync(join(repoDir, "test"), { recursive: true });
  writeFileSync(join(repoDir, "test", "orders.test.js"), 'test("lists", () => get("/api/orders"));\n');
  git("add", "-A"); git("commit", "-q", "-m", "add orders test");
  const q = quiet(), out = join(dir, "impact.json");
  assert.equal(run(["impact", "--repo", repoDir, "--base", base, "--model", join(root, "models/demo-shop/model.json"), "--out", out], {}, q.log), EXIT.OK);
  const im = JSON.parse(readFileSync(out, "utf8"));
  const lo = im.useCases.find((u) => u.id === "list-orders");
  assert.equal(lo.tests.state, "covered-changed", "the test file was added inside base..head");
  assert.deepEqual(lo.tests.files.map((f) => f.file), ["test/orders.test.js"]);
  assert.equal(im.summary.testsKnown, true); assert.equal(im.summary.withoutTests, 0);
  // base = the commit that already has the test: the file exists but did not change
  const q2 = quiet();
  run(["impact", "--repo", repoDir, "--base", modelHead, "--model", join(root, "models/demo-shop/model.json"), "--out", out], {}, q2.log);
  assert.match(q2.out.join("\n"), /회귀 지도/);
});

// ───────── CLI + page ─────────
test("cli intent: exit 0 normally, 4 with --strict-intent when an expectation is unmet, 1 on a bad intent file", () => {
  const dir = tmp(), q = quiet();
  const base = ["intent", "--model", join(root, "models/demo-shop/model.json"), "--changes", join(root, "models/demo-shop/changes.auto.json"), "--intent", join(root, "models/demo-shop/intent.example.json")];
  assert.equal(run(base, {}, q.log), EXIT.OK);
  assert.match(q.out.join("\n"), /충족 4 · 미충족 1 · 확인 불가 1/);
  assert.equal(run([...base, "--strict-intent"], {}, q.log), EXIT.INTENT);
  const bad = join(dir, "bad.json"); writeFileSync(bad, JSON.stringify({ schemaVersion: 1, title: "t", expectations: [{ id: "A B", text: "t" }] }));
  assert.equal(run(["intent", "--model", join(root, "models/demo-shop/model.json"), "--intent", bad], {}, quiet().log), EXIT.MODEL);
  const outFile = join(dir, "r.json");
  run([...base, "--out", outFile], {}, quiet().log);
  assert.equal(JSON.parse(readFileSync(outFile, "utf8")).summary.unmet, 1);
});

test("cli build on the demo repo: review.json, panel data in the page, report summary, tests found by route", () => {
  const dir = tmp(), repoDir = join(dir, "repo");
  const { base } = makeDemoRepo(repoDir);
  const out = join(dir, "out"), q = quiet();
  const code = run(["build", "--repo", repoDir, "--base", base, "--model", join(root, "models/demo-shop/model.json"), "--intent", join(root, "models/demo-shop/intent.example.json"), "--out", out, "--strict-intent"], {}, q.log);
  assert.equal(code, EXIT.INTENT);
  assert.ok(existsSync(join(out, "review.json")));
  const rv = JSON.parse(readFileSync(join(out, "review.json"), "utf8"));
  assert.ok(rv.compare && rv.intent && rv.impact);
  assert.equal(rv.impact.summary.testsKnown, true);
  assert.equal(rv.impact.useCases.find((u) => u.id === "list-orders").tests.state, "none-found", "the demo shop has no tests mentioning the route");
  const rep = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  assert.equal(rep.review.intent.unmet, 1); assert.equal(rep.review.impact.direct, 2);
  const html = readFileSync(join(out, "demo-shop.html"), "utf8");
  assert.match(html, /id="sv-review-data"/); assert.match(html, /id="sv-review"/);
});

test("cli build with --before-model compares the flow itself", () => {
  const dir = tmp(), repoDir = join(dir, "repo"), { base } = makeDemoRepo(repoDir);
  const before = demoModel(); before.useCases.find((u) => u.id === "list-orders").steps = before.useCases.find((u) => u.id === "list-orders").steps.filter((s) => s.id !== "shipping");
  const bf = join(dir, "before.json"); writeFileSync(bf, JSON.stringify(before));
  const out = join(dir, "out");
  assert.equal(run(["build", "--repo", repoDir, "--base", base, "--model", join(root, "models/demo-shop/model.json"), "--before-model", bf, "--out", out], {}, quiet().log), EXIT.OK);
  const rv = JSON.parse(readFileSync(join(out, "review.json"), "utf8"));
  assert.equal(rv.compare.mode, "two-models");
  assert.equal(rv.compare.useCases.find((u) => u.id === "list-orders").rows.find((r) => r.id === "shipping").status, "added");
  const bad = join(dir, "bad.json"); writeFileSync(bad, JSON.stringify({ nope: 1 }));
  assert.equal(run(["build", "--repo", repoDir, "--base", base, "--model", join(root, "models/demo-shop/model.json"), "--before-model", bad, "--out", join(dir, "o2")], {}, quiet().log), EXIT.MODEL);
});

test("page: data first, then code (model, changes, review data, player, review dock); review data is null without a review and embedded safely", () => {
  const plain = buildPage(demoModel(), demoAutoChanges());
  assert.match(plain, /<section id="sv-review" class="dock" hidden/); assert.match(plain, /id="sv-review-data">null<\/script>/);
  const review = buildReview(demoModel(), demoAutoChanges(), { intent: { ...intentExample(), title: "</script><b>x" } });
  const html = buildPage(demoModel(), demoAutoChanges(), { review });
  assert.ok(!/<\/script><b>x/.test(html));
  const scripts = [...html.matchAll(/<script[^>]*>([^]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 5);
  assert.equal(JSON.parse(scripts[2]).intent.title, "</script><b>x");
});

// ───────── review dock (real review.js against a tiny fake DOM) ─────────
class El {
  constructor(tag) { this.tagName = tag; this.attrs = {}; this.children = []; this._text = ""; this.listeners = {}; this.hidden = false; const el = this; this.classList = { add: (c) => { el.cls.add(c); }, remove: (c) => { el.cls.delete(c); } }; this.cls = new Set(); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; if (k === "hidden") this.hidden = false; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  get firstChild() { return this.children[0] ?? null; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { this.children = []; this._text = String(v); }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  click() { (this.listeners.click ?? []).forEach((f) => f({ stopPropagation() {} })); }
  all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
}
function loadDock({ review = null, changes = demoAutoChanges(), hash = {}, lang = "ko" } = {}) {
  const html = buildPage(demoModel(), changes, { review, lang });
  const scripts = [...html.matchAll(/<script[^>]*>([^]*?)<\/script>/g)].map((m) => m[1]);
  const root = new El("section"); root.hidden = true;
  const data = new El("script"); data._text = scripts[2];
  const calls = [], mem = {};
  const ctx = {
    document: {
      getElementById: (id) => (id === "sv-review" ? root : id === "sv-review-data" ? data : null),
      createElement: (t) => new El(t), createElementNS: (_n, t) => new El(t), createTextNode: (t) => { const e = new El("#text"); e._text = t; return e; },
      documentElement: { getAttribute: (k) => (k === "lang" ? lang : null), style: { setProperty() {} } }
    },
    localStorage: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } }, innerHeight: 900, JSON, String, Array, Object,
    __nacholens: { model: demoModel(), changes, hash, selectUseCase: (id, i) => calls.push([id, i]) }
  };
  ctx.window = ctx;
  vm.runInNewContext(scripts[4], ctx);
  return { root, calls, dock: ctx.__nacholensReview };
}
const tabs = (root) => root.all((c) => c.attrs.role === "tab");
const tabNamed = (root, name) => tabs(root).find((t) => t.textContent.includes(name));
const byClass = (root, cls) => root.all((c) => (c.attrs.class ?? "").split(/\s+/).includes(cls));
const fullReview = () => buildReview(demoModel(), demoAutoChanges(), { intent: intentExample() });

test("dock: hidden with nothing to review; with an overlay only, three tracks and the planner/test ones say 없음", () => {
  assert.equal(loadDock({ changes: null }).root.hidden, true);
  const { root, dock } = loadDock();
  assert.equal(root.hidden, false);
  assert.deepEqual(tabs(root).map((t) => t.attrs["data-tab"]), ["intent", "impact", "unmapped"]);
  assert.match(tabNamed(root, "기획 의도").textContent, /없음/);
  assert.match(tabNamed(root, "회귀 테스트").textContent, /없음/);
  assert.equal(dock.state.tab, "unmapped", "opens on the first track with something left to check");
});

test("dock: each tab carries its status (a toned dot and the count still to check); ticking lowers it, a finished track shows a check", () => {
  const { root, dock } = loadDock({ review: fullReview() });
  const t = Object.fromEntries(dock.tracks().map((x) => [x.id, x]));
  assert.deepEqual([t.intent.left, t.impact.left, t.unmapped.left], [4, 2, 1], "intent: unmet + unknown + flows with uncovered changes");
  assert.match(tabNamed(root, "기획 의도").textContent, /기획.*4건 남음/);
  assert.equal(byClass(tabNamed(root, "기획 의도"), "dot")[0].attrs["data-tone"], "danger", "an unmet expectation makes the planner's track red");
  dock.open("unmapped");
  byClass(root, "dbody")[0].all((c) => c.attrs.role === "checkbox")[0].click();
  assert.equal(dock.tracks().find((x) => x.id === "unmapped").left, 0);
  assert.equal(byClass(tabNamed(root, "모델 밖 변경"), "ok").length, 1);
});

test("dock: intent — verdict words, met ones folded, uncovered changes grouped by flow; a step link moves the player", () => {
  const { root, dock, calls } = loadDock({ review: fullReview() });
  dock.open("intent");
  const body = byClass(root, "dbody")[0];
  const text = body.textContent;
  assert.match(text, /충족 4 · 미충족 1 · 확인 불가 1/); assert.match(text, /미충족/); assert.match(text, /확인 불가/);
  assert.match(text, /충족 4건 보기/);
  assert.match(text, /기획에 연결되지 않은 변경 3건/);
  byClass(body, "steplink").at(-1).click();
  assert.equal(calls.length, 1); assert.equal(typeof calls[0][1], "number");
});

test("dock: regression — relation and test-state words, the shared table, 테스트 미확인 without a repository; a title moves the player", () => {
  const { root, dock, calls } = loadDock({ review: fullReview() });
  dock.open("impact");
  const text = byClass(root, "dbody")[0].textContent;
  assert.match(text, /직접 영향/); assert.match(text, /db\.orders/); assert.match(text, /테스트 미확인/); assert.match(text, /저장소를 읽지 않아/);
  byClass(root, "plain")[0].click();
  assert.deepEqual(calls[0], ["list-orders", null]);
});

test("dock: changes the model does not cover — code folders with their files; config/style and ignored kept apart", () => {
  const { root, dock } = loadDock({ review: fullReview() });
  dock.open("unmapped");
  let body = byClass(root, "dbody")[0];
  assert.match(body.textContent, /public\//); assert.match(body.textContent, /format\.js/);
  assert.ok(!body.textContent.includes("styles.css"), "stylesheets are not code changes");
  body.all((c) => c.tagName === "button" && c.textContent.startsWith("설정·스타일"))[0].click();
  body = byClass(root, "dbody")[0]; assert.match(body.textContent, /styles\.css/);
  body.all((c) => c.tagName === "button" && c.textContent.startsWith("무시"))[0].click();
  body = byClass(root, "dbody")[0]; assert.match(body.textContent, /README\.md.*문서/);
});

test("dock: #dock=<tab> in the URL opens that tab; clicking the open tab folds the dock and again unfolds it", () => {
  const { root, dock } = loadDock({ review: fullReview(), hash: { dock: "impact" } });
  assert.deepEqual({ ...dock.state }, { tab: "impact", collapsed: false, ucat: "code" });
  tabNamed(root, "회귀 테스트").click();
  assert.equal(dock.state.collapsed, true); assert.ok(root.cls.has("collapsed"));
  tabNamed(root, "회귀 테스트").click();
  assert.equal(dock.state.collapsed, false);
});
