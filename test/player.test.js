// Runs the real player.js (and review.js) against a small fake DOM and a virtual clock (node:vm). Covers rules that are
// otherwise only visible in a browser: what moves on each step (and that it comes from the model only), which box
// carries a change tag, where each piece of information lives (never twice), the inside of a component, the scale
// rules, and the motion itself.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildPage } from "../src/page.js";
import { buildReview } from "../src/review.js";
import { validateModel } from "../src/model.js";
import { demoModel, demoAutoChanges, clone, tiny, readJson } from "./helpers.js";

/* ───────── fake DOM ───────── */
class ClassList {
  constructor(el) { this.el = el; }
  get list() { return (this.el.attrs.class ?? "").split(/\s+/).filter(Boolean); }
  add(c) { const a = this.list; if (!a.includes(c)) { a.push(c); this.el.attrs.class = a.join(" "); } }
  remove(c) { this.el.attrs.class = this.list.filter((x) => x !== c).join(" "); }
  contains(c) { return this.list.includes(c); }
  toggle(c, on = !this.contains(c)) { if (on) this.add(c); else this.remove(c); return on; }
}
class El {
  constructor(tag) { this.tagName = tag; this.attrs = {}; this.children = []; this._text = ""; this.hidden = false; this.listeners = {}; this.parentNode = null; this.classList = new ClassList(this); this.style = { setProperty(k, v) { this[k] = v; } }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; if (k === "hidden") this.hidden = false; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  get firstChild() { return this.children[0] ?? null; }
  get childNodes() { return this.children; }
  set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  fire(t, ev = {}) { (this.listeners[t] ?? []).forEach((f) => f({ preventDefault() {}, stopPropagation() {}, target: this, ...ev })); }
  click() { this.fire("click"); }
  getBoundingClientRect() { return { width: this.clientWidth ?? 0, height: this.clientHeight ?? 0 }; }
  all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  find(pred) { return this.all(pred)[0] ?? null; }
}
const has = (cls) => (e) => e.classList.contains(cls);

/* ───────── virtual clock: timers and animation frames ───────── */
function clock() {
  let t = 0, seq = 0;
  const timers = [], rafs = [];
  return {
    now: () => t,
    setTimeout: (fn, ms = 0) => { const id = ++seq; timers.push({ id, at: t + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    raf: (fn) => { const id = ++seq; rafs.push({ id, fn }); return id; },
    caf: (id) => { const i = rafs.findIndex((x) => x.id === id); if (i >= 0) rafs.splice(i, 1); },
    advance(ms, onFrame) {
      const end = t + ms;
      while (t < end) {
        t = Math.min(end, t + 16);
        for (;;) { const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0]; if (!due) break; timers.splice(timers.indexOf(due), 1); due.fn(); }
        rafs.splice(0).forEach((r) => r.fn(t));
        if (onFrame) onFrame(t);
      }
    }
  };
}

const IDS = ["app", "sv-model", "sv-changes", "sv-review-data", "sv-product", "sv-ref", "sv-depth", "sv-commit", "sv-overlay", "sv-q", "sv-list", "sv-stage", "sv-crumbs", "sv-caption", "sv-canvas", "sv-transport", "sv-review", "sv-insp"];
// lang: most tests read the Korean words (the --lang ko build); the English default has its own tests
function load({ model = demoModel(), changes = demoAutoChanges(), review = null, target = "html", hash = "", reduce = true, stage = [900, 520], storage = "memory", lang = "ko", clipboard = "ok" } = {}) {
  const html = buildPage(model, changes, { target, review, lang });
  const scripts = [...html.matchAll(/<script[^>]*>([^]*?)<\/script>/g)].map((m) => m[1]);
  const byId = {};
  for (const id of IDS) { byId[id] = new El(id === "sv-canvas" ? "svg" : "div"); byId[id].attrs.id = id; }
  for (const id of ["sv-ref", "sv-depth", "sv-overlay", "sv-crumbs", "sv-review"]) byId[id].hidden = true;
  byId["sv-model"]._text = scripts[0]; byId["sv-changes"]._text = scripts[1]; byId["sv-review-data"]._text = scripts[2];
  [byId["sv-stage"].clientWidth, byId["sv-stage"].clientHeight] = stage;
  const docListeners = {}, hist = [], ck = clock(), mem = {}, copied = [];
  const doc = {
    title: "", body: new El("body"), activeElement: null,
    getElementById: (id) => byId[id] ?? Object.values(byId).map((r) => r.find((c) => c.attrs.id === id)).find(Boolean) ?? null,
    createElement: (t) => new El(t), createElementNS: (_ns, t) => new El(t),
    createTextNode: (t) => { const e = new El("#text"); e._text = t; return e; },
    addEventListener: (t, f) => (docListeners[t] ??= []).push(f),
    documentElement: { getAttribute: (k) => (k === "data-target" ? target : k === "lang" ? lang : null), style: { setProperty() {} } }
  };
  const localStorage = storage === "blocked"
    ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }
    : { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } };
  const ctx = {
    document: doc, location: { hash }, history: { replaceState: (_s, _t, u) => hist.push(u) }, localStorage,
    matchMedia: () => ({ matches: reduce }), requestAnimationFrame: ck.raf, cancelAnimationFrame: ck.caf,
    setTimeout: ck.setTimeout, clearTimeout: ck.clearTimeout, performance: { now: ck.now },
    ResizeObserver: class { observe() {} }, innerHeight: 900,
    navigator: clipboard === "none" || clipboard === "stuck" ? {} : { clipboard: { writeText: (s) => (clipboard === "denied" ? Promise.reject(new Error("denied")) : (copied.push(s), Promise.resolve())) } }
  };
  doc.execCommand = (c) => { if (c === "copy") copied.push("execCommand:" + (doc.body.children.at(-1)?.value ?? "")); return clipboard !== "stuck"; };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(scripts[3], ctx);
  vm.runInContext(scripts[4], ctx);
  const key = (e) => { (docListeners.keydown ?? []).forEach((f) => f({ key: e, preventDefault() {}, target: doc.body })); };
  // values made inside the vm come from another realm; hand plain copies to the assertions
  const plain = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
  const sv = new Proxy(ctx.__nacholens, { get(t, k) { const v = t[k]; return typeof v === "function" ? (...a) => plain(v.apply(t, a)) : typeof v === "object" ? plain(v) : v; } });
  return { sv, rv: ctx.__nacholensReview, byId, hist, clock: ck, key, mem, copied, doc };
}
const layer = (byId, name) => byId["sv-canvas"].find(has("layer-" + name));
const sideLabels = (byId) => byId["sv-list"].all(has("lbl")).map((e) => e.textContent);
const node = (byId, id) => byId["sv-canvas"].find((e) => e.attrs["data-id"] === id);
const uc = (id) => demoModel().useCases.find((u) => u.id === id);

/* ───────── what moves (architecture) ───────── */
test("legs come from the step: request/response one way (via the gateway), call out and back, internal works in place", () => {
  const { sv } = load();
  sv.selectUseCase("list-orders");
  const L = uc("list-orders");
  const req = L.steps.findIndex((s) => s.id === "request"), call = L.steps.findIndex((s) => s.id === "session"), inner = L.steps.findIndex((s) => s.id === "shape"), res = L.steps.findIndex((s) => s.id === "response");
  assert.deepEqual(sv.legs(req), [{ type: "move", ids: ["browser", "gateway", "api"], tone: "req", text: L.steps[req].request }]);
  assert.deepEqual(sv.legs(call).map((l) => [l.ids, l.tone, l.text]), [[["api", "db"], "req", L.steps[call].request], [["db", "api"], "res", L.steps[call].response]]);
  assert.deepEqual(sv.legs(inner), [{ type: "work", at: "api" }]);
  assert.deepEqual(sv.legs(res)[0].ids, ["api", "gateway", "browser"]);
  assert.equal(sv.legs(res)[0].tone, "res");
});

test("caption tells what is moving now: request text on the way out, response text on the way back", () => {
  const { sv, byId, clock } = load({ reduce: false });
  sv.selectUseCase("list-orders");
  const L = uc("list-orders"), i = L.steps.findIndex((s) => s.id === "shipping");
  sv.go(i, true);
  clock.advance(150); // the caption swaps after a short fade
  assert.match(byId["sv-caption"].textContent, /^요청 → Shipping tracker/);
  assert.ok(byId["sv-caption"].textContent.includes(L.steps[i].request));
  for (let n = 0; n < 400 && sv.state.leg === 0; n++) clock.advance(16);
  clock.advance(150);
  assert.match(byId["sv-caption"].textContent, /^응답 → Order API/);
  assert.ok(byId["sv-caption"].textContent.includes(L.steps[i].response));
});

/* ───────── change marks ───────── */
test("change tags: only components that are changed AND on a changed step of the SELECTED flow", () => {
  const { sv } = load();
  sv.selectUseCase("sign-in"); assert.deepEqual(sv.tagged(), [], "sign-in has no changed step");
  sv.selectUseCase("sales-report"); assert.deepEqual(sv.tagged(), []);
  sv.selectUseCase("list-orders"); assert.deepEqual(sv.tagged(), ["api", "browser", "shipping"]);
  sv.selectUseCase("place-order"); assert.deepEqual(sv.tagged(), ["api"], "db is on the changed step but is not itself changed");
});

test("overlay off: no tags, no change words, no change note; without an overlay file there is no switch, no dock and one group", () => {
  const on = load();
  on.sv.selectUseCase("list-orders");
  assert.ok(on.byId["sv-list"].all(has("chg")).length > 0);
  on.sv.setOverlay(false);
  assert.deepEqual(on.sv.tagged(), []);
  assert.equal(on.byId["sv-list"].all(has("chg")).length, 0);
  on.sv.go(uc("list-orders").steps.findIndex((s) => s.id === "shipping"), false);
  assert.equal(on.byId["sv-insp"].all(has("note")).length, 0);
  const off = load({ changes: null });
  assert.equal(off.byId["sv-overlay"].hidden, true);
  assert.equal(off.byId["sv-review"].hidden, true, "nothing to review: the dock stays hidden");
  assert.deepEqual(off.byId["sv-list"].all(has("gh")).map((g) => g.textContent.replace(/\d+$/, "")), ["흐름"]);
  assert.deepEqual(off.sv.tagged(), []);
});

/* ───────── words: English by default, Korean with --lang ko ───────── */
test("the player speaks English by default: no Hangul in its own words on the overview, a playing step, inside a component and in the dock", () => {
  const hangul = /[\uac00-\ud7a3]/;
  const { sv, rv, byId } = load({ lang: "en", review: buildReview(demoModel(), demoAutoChanges(), { intent: readJson("models/demo-shop/intent.example.json") }) });
  const shown = () => Object.values(byId).filter((e) => !["sv-model", "sv-changes", "sv-review-data"].includes(e.attrs.id)).map((e) => e.textContent + " " + e.all(() => true).map((c) => [c.attrs["aria-label"], c.attrs.title, c.attrs.placeholder].filter(Boolean).join(" ")).join(" ")).join(" ");
  sv.selectUseCase("list-orders");
  assert.doesNotMatch(shown(), hangul, "overview");
  assert.match(byId["sv-insp"].textContent, /Flow overview/);
  assert.match(byId["sv-transport"].textContent, /Play/);
  assert.match(byId["sv-list"].textContent, /Changed in this work/);
  sv.go(uc("list-orders").steps.findIndex((s) => s.id === "shipping"), false);
  assert.doesNotMatch(shown(), hangul, "a step");
  assert.match(byId["sv-insp"].textContent, /What happens in step \d+/);
  sv.openDetail("api");
  assert.doesNotMatch(shown(), hangul, "inside a component");
  assert.match(byId["sv-canvas"].textContent, /Entry/);
  assert.match(byId["sv-review"].textContent, /Does it work as planned\?|What should be retested\?|Did any change miss the flows\?/);
  for (const tab of ["intent", "impact", "unmapped"]) { rv.open(tab); assert.doesNotMatch(byId["sv-review"].textContent, hangul, "dock " + tab); }
});

test("page language: <html lang> and the static labels follow --lang (en by default, ko on request)", () => {
  const en = buildPage(demoModel(), demoAutoChanges()), ko = buildPage(demoModel(), demoAutoChanges(), { lang: "ko" });
  assert.match(en, /<html lang="en"/); assert.match(ko, /<html lang="ko"/);
  assert.match(en, /placeholder="Search flows"/); assert.match(ko, /placeholder="흐름 검색"/);
  assert.match(en, /Highlight changes<\/button>/); assert.match(ko, /변경 강조<\/button>/);
  const body = (h) => h.slice(h.indexOf("<body>"), h.indexOf("<script"));
  assert.doesNotMatch(body(en), /[\uac00-\ud7a3]/, "no Hangul in the English page shell");
  const { byId } = load({ lang: "ko" });
  assert.match(byId["sv-transport"].textContent, /재생/);
});

/* ───────── one home for every piece of information ───────── */
test("no duplicates: the step name and change word live in the sidebar; the inspector has the narration, the reason and the evidence", () => {
  const { sv, byId } = load();
  sv.selectUseCase("list-orders");
  const L = uc("list-orders"), i = L.steps.findIndex((s) => s.id === "shipping"), st = L.steps[i];
  sv.go(i, false);
  const insp = byId["sv-insp"].textContent;
  assert.ok(sideLabels(byId).includes(st.label));
  assert.ok(!insp.includes(st.label), "the inspector does not repeat the step name");
  assert.ok(!/신규|변경|삭제/.test(insp.replace(/바뀜/g, "")), "nor the change word");
  assert.ok(insp.includes(st.narration));
  assert.match(insp, /Evidence code added/);
  const hit = byId["sv-insp"].all(has("hit")).map((e) => e.textContent);
  assert.ok(hit.length >= 1 && hit.every((t) => t.endsWith("바뀜")), "changed evidence ranges are marked in the one evidence list");
  assert.ok(!byId["sv-transport"].textContent.includes(st.label), "the transport does not name the step either");
});

test("transforms: listed in the inspector on the architecture, drawn as chips (and not listed) inside the component", () => {
  const { sv, byId } = load();
  sv.selectUseCase("list-orders");
  const i = uc("list-orders").steps.findIndex((s) => s.id === "shipping");
  sv.go(i, false);
  assert.match(byId["sv-insp"].textContent, /데이터 모양이 바뀌는 곳/);
  sv.openDetail("api");
  assert.equal(sv.state.mode, "detail");
  assert.ok(!/데이터 모양이 바뀌는 곳/.test(byId["sv-insp"].textContent));
  assert.ok(layer(byId, "notes").all(has("xchip")).length >= 1);
});

/* ───────── inside a component ───────── */
test("inside a service: parts in 진입/처리/어댑터 columns, only the parts this flow passes, neighbours as stubs (a gateway counts)", () => {
  const { sv, byId } = load();
  sv.selectUseCase("list-orders");
  sv.openDetail("api");
  const sc = sv.scene(), api = demoModel().components.find((c) => c.id === "api");
  const traced = new Set(uc("list-orders").steps.flatMap((s) => (s.trace ?? []).filter((r) => r.startsWith("api/")).map((r) => "p:" + r.slice(4))));
  const parts = Object.keys(sc.boxes).filter((id) => id.startsWith("p:"));
  assert.deepEqual(new Set(parts), traced);
  assert.equal(sc.hidden, api.parts.length - traced.size);
  assert.ok(sc.boxes["stub:gateway"] && sc.boxes["stub:gateway"].x < Math.min(...parts.map((p) => sc.boxes[p].x)), "the gateway calls in from the left");
  assert.ok(sc.boxes["stub:db"].x > Math.max(...parts.map((p) => sc.boxes[p].x)), "the database is called on the right");
  const heads = byId["sv-canvas"].all(has("colh")).map((e) => e.textContent);
  for (const h of ["부르는 쪽", "불리는 쪽"]) assert.ok(heads.includes(h));
  assert.ok(heads.some((h) => ["진입", "처리", "어댑터"].includes(h)));
});

test("inside: every moving box is a stub or a part named by the step's trace — nothing is inferred", () => {
  const { sv } = load();
  for (const u of demoModel().useCases) {
    sv.selectUseCase(u.id);
    sv.openDetail("api");
    u.steps.forEach((st, i) => {
      const allowed = new Set((st.trace ?? []).filter((r) => r.startsWith("api/")).map((r) => "p:" + r.slice(4)));
      for (const l of sv.legs(i)) for (const id of l.ids ?? [l.at]) assert.ok(id.startsWith("stub:") || allowed.has(id), `${u.id}/${st.id}: ${id}`);
      if (![st.from, ...(st.via ?? []), st.to].includes("api")) assert.deepEqual(sv.legs(i), [], `${u.id}/${st.id} does not touch the API`);
    });
    sv.closeDetail();
  }
});

test("inside: a step that does not pass the component, or has no trace there, says so instead of moving", () => {
  const m = clone(demoModel());
  const so = m.useCases.find((u) => u.id === "sign-in");
  delete so.steps.find((s) => s.id === "make-state").trace;
  assert.deepEqual(validateModel(m), []);
  const { sv, byId } = load({ model: m });
  sv.selectUseCase("sign-in");
  sv.openDetail("api");
  const consent = so.steps.findIndex((s) => s.id === "consent"), make = so.steps.findIndex((s) => s.id === "make-state");
  sv.go(consent, true);
  assert.deepEqual(sv.legs(consent), []);
  assert.match(byId["sv-caption"].textContent, /밖에서 일어납니다/);
  sv.go(make, true);
  assert.match(byId["sv-caption"].textContent, /내부 경로는 모델에 없습니다/);
  assert.equal(sv.state.finished, true, "it does not stall");
});

test("inside a datastore: tables, the ones this flow reaches first; the step's table gets the operation and its columns", () => {
  const { sv, byId } = load();
  sv.selectUseCase("list-orders");
  const i = uc("list-orders").steps.findIndex((s) => s.id === "query");
  sv.go(i, false);
  sv.openDetail("db");
  const step = uc("list-orders").steps[i], d = step.data[0];
  assert.deepEqual(sv.legs(i).map((l) => l.ids), [["stub:api", "t:" + d.table], ["t:" + d.table, "stub:api"]]);
  const card = node(byId, "t:" + d.table);
  assert.ok(card.classList.contains("hitcard"));
  assert.match(card.textContent, /읽기/);
  const hit = card.all(has("col-hit")).map((e) => e.textContent);
  assert.ok(hit.length > 0 && hit.every((c) => d.columns.includes(c)));
});

test("inside a third party: endpoint cards (method, path, sent/received fields); the called one is marked", () => {
  const { sv, byId } = load();
  sv.selectUseCase("list-orders");
  const i = uc("list-orders").steps.findIndex((s) => s.id === "shipping");
  sv.go(i, false);
  sv.openDetail("shipping");
  const ep = demoModel().components.find((c) => c.id === "shipping").endpoints[0];
  const card = node(byId, "e:" + ep.id);
  assert.match(card.textContent, new RegExp(ep.method));
  assert.match(card.textContent, /보냄.*받음/);
  assert.ok(card.classList.contains("hitcard"));
});

test("entering and leaving: only components with detail open; Esc and the back crumb return; a stub moves to its neighbour", () => {
  const { sv, byId, key } = load();
  sv.selectUseCase("list-orders");
  assert.equal(node(byId, "browser").getAttribute("role"), null, "no detail, not a button");
  assert.equal(node(byId, "api").getAttribute("role"), "button");
  sv.openDetail("browser"); assert.equal(sv.state.mode, "arch");
  node(byId, "api").click(); assert.equal(sv.state.mode, "detail"); assert.equal(byId["sv-crumbs"].hidden, false);
  node(byId, "stub:db").click(); assert.equal(sv.state.focus, "db", "the stub is a door to the neighbour's inside");
  key("Escape"); assert.equal(sv.state.mode, "arch"); assert.equal(byId["sv-crumbs"].hidden, true);
  sv.openDetail("api");
  byId["sv-crumbs"].find((e) => e.classList.contains("back")).click();
  assert.equal(sv.state.mode, "arch");
});

test("an item picked inside shows what its card does not: description, call relations, steps that pass it, evidence", () => {
  const { sv, byId } = load();
  sv.selectUseCase("list-orders");
  sv.openDetail("db");
  const t = demoModel().components.find((c) => c.id === "db").tables.find((x) => x.name === "orders");
  sv.selectItem("t:orders");
  const insp = byId["sv-insp"].textContent;
  assert.ok(insp.includes(t.detail));
  assert.match(insp, /이 흐름에서 지나는 단계/);
  for (const c of t.columns) assert.ok(!insp.includes(c.name + (c.type ?? "")), "columns stay on the card");
  sv.openDetail("api"); sv.closeDetail(); sv.openDetail("api");
  const part = Object.keys(sv.scene().boxes).find((id) => id.startsWith("p:"));
  sv.selectItem(part);
  assert.match(byId["sv-insp"].textContent, /부르는 곳/);
  assert.match(byId["sv-insp"].textContent, /단계 설명으로|흐름 개요로/);
});

/* ───────── scale ───────── */
test("scale: with more than 8 components only the ones the flow touches are drawn, and the rest are counted", () => {
  const m = tiny(), ev = [{ file: "a.js", lines: [1, 2], contains: "x" }];
  for (let i = 0; i < 7; i++) { m.components.push({ id: "x" + i, kind: "external", label: "X" + i, detail: "d", evidence: ev }); m.links.push({ a: "api", b: "x" + i, label: "l", evidence: ev }); }
  assert.deepEqual(validateModel(m), []);
  const { sv, byId } = load({ model: m, changes: null });
  assert.deepEqual(Object.keys(sv.scene().boxes).sort(), ["api", "db", "gw", "web"]);
  assert.equal(sv.scene().hidden, 7);
  assert.match(byId["sv-stage"].textContent, /무관한 컴포넌트 7개는 숨김/);
});

test("sidebar: changed flows first, unchanged ones folded; search filters; ticks count reviewed changed steps", () => {
  const { sv, byId } = load();
  const groups = byId["sv-list"].all(has("gh"));
  assert.deepEqual(groups.map((g) => g.getAttribute("aria-expanded")), ["true", "false"]);
  assert.equal(byId["sv-list"].all(has("uc")).length, 2, "two changed flows shown, two folded");
  byId["sv-q"].fire("input", { target: { value: "sales" } });
  assert.deepEqual(byId["sv-list"].all(has("uc")).map((b) => b.getAttribute("data-uc")), ["sales-report"]);
  byId["sv-q"].fire("input", { target: { value: "" } });
  sv.selectUseCase("list-orders");
  const badge = () => byId["sv-list"].find((e) => e.getAttribute("data-uc") === "list-orders").find(has("badge")).textContent;
  assert.equal(badge(), "리뷰 0/3");
  byId["sv-list"].all(has("check"))[0].click();
  assert.equal(badge(), "리뷰 1/3");
});

test("ticks survive blocked browser storage (they last for the visit)", () => {
  const { sv, byId } = load({ storage: "blocked" });
  sv.selectUseCase("list-orders");
  byId["sv-list"].all(has("check"))[0].click();
  assert.match(byId["sv-list"].textContent, /리뷰 1\/3/);
});

/* ───────── motion ───────── */
test("motion: the packet starts at the route start, eases in, moves forward only and ends on the callee with a ring", () => {
  const { sv, byId, clock } = load({ reduce: false });
  sv.selectUseCase("list-orders");
  const i = uc("list-orders").steps.findIndex((s) => s.id === "request");
  sv.go(i, true);
  const p0 = sv.packet(), box = sv.scene().boxes.browser;
  assert.ok(Math.abs(p0.x - (box.x + box.w / 2)) < 2, "first frame sits on the browser's edge, before any frame ran");
  const xs = [p0.x];
  clock.advance(4000, () => { const p = sv.packet(); if (p && sv.state.leg === 0 && !sv.state.finished) xs.push(p.x); });
  for (let k = 1; k < xs.length; k++) assert.ok(xs[k] >= xs[k - 1] - 1e-6, "never moves backwards");
  const total = xs[xs.length - 1] - xs[0], firstTenth = xs[Math.max(1, Math.round(xs.length / 10))] - xs[0];
  assert.ok(firstTenth < total / 10, "a start from rest speeds up gently");
  assert.equal(sv.state.finished, true);
  assert.ok(layer(byId, "trail").all(has("past")).length === 1, "the leg leaves a faint trail");
});

test("motion: a continuous run keeps the trail of earlier legs; a jump starts clean", () => {
  const { sv, byId, clock } = load();
  sv.selectUseCase("list-orders");
  sv.play();
  clock.advance(1);
  const after1 = layer(byId, "trail").children.length;
  clock.advance(1000);
  assert.ok(layer(byId, "trail").children.length > after1, "trail grows while playing");
  sv.go(5, true);
  assert.equal(layer(byId, "trail").children.length, sv.legs(5).length);
});

test("reduced motion: each step shows its result at once, play waits between steps, and play at the end starts over", () => {
  const { sv, byId, clock } = load();
  sv.selectUseCase("list-orders");
  const n = uc("list-orders").steps.length;
  sv.go(1, true);
  assert.equal(sv.state.finished, true, "the result shows at once");
  sv.play();
  assert.equal(sv.state.step, 2, "play goes on from the step shown");
  clock.advance(500);
  assert.equal(sv.state.step, 2, "and holds each result long enough to read it");
  clock.advance(600);
  assert.equal(sv.state.step, 3);
  clock.advance(20000);
  assert.equal(sv.state.step, n - 1); assert.equal(sv.state.playing, false);
  assert.match(byId["sv-transport"].textContent, /다시 재생/);
  sv.play();
  assert.equal(sv.state.step, 0);
});

test("pause in the middle of a leg and resume from the same point", () => {
  const { sv, clock } = load({ reduce: false });
  sv.selectUseCase("list-orders");
  sv.play();
  clock.advance(200);
  sv.pause();
  const t = sv.state.t, step = sv.state.step;
  clock.advance(3000);
  assert.equal(sv.state.t, t); assert.equal(sv.state.step, step);
  sv.play();
  clock.advance(32);
  assert.ok(sv.state.t > t);
});

/* ───────── URL ───────── */
test("html: the URL keeps the flow, step and inside view; a link opens them. artifact: the history is never touched", () => {
  const a = load({ hash: "#uc=place-order&step=2&focus=api" });
  assert.deepEqual([a.sv.state.uc, a.sv.state.step, a.sv.state.mode, a.sv.state.focus], ["place-order", 1, "detail", "api"]);
  a.sv.go(3, false);
  assert.equal(a.hist.at(-1), "#uc=place-order&step=4&focus=api");
  const b = load({ target: "artifact" });
  b.sv.go(2, false); b.sv.openDetail("api");
  assert.deepEqual(b.hist, []);
});

/* ───────── before/after with two models ───────── */
test("two models: the inspector shows what a modified step said before; the overview lists the steps that are gone", () => {
  const before = clone(demoModel());
  const lo = before.useCases.find((u) => u.id === "list-orders");
  lo.steps.find((s) => s.id === "query").label = "Read every order";
  lo.steps = lo.steps.filter((s) => s.id !== "shipping");
  lo.steps.splice(1, 0, { ...clone(lo.steps[0]), id: "legacy", label: "Old cache lookup" });
  const review = buildReview(demoModel(), demoAutoChanges(), { beforeModel: before });
  assert.equal(review.compare.mode, "two-models");
  const { sv, byId } = load({ review });
  sv.selectUseCase("list-orders");
  assert.match(byId["sv-insp"].textContent, /이번에 없어진 단계.*Old cache lookup/);
  sv.go(uc("list-orders").steps.findIndex((s) => s.id === "query"), false);
  assert.match(byId["sv-insp"].textContent, /변경 전.*단계 이름.*Read every order/);
});

test("the demo model itself renders every flow and every inside without errors", () => {
  const { sv } = load({ review: buildReview(demoModel(), demoAutoChanges(), { intent: readJson("models/demo-shop/intent.example.json") }) });
  for (const u of demoModel().useCases) {
    sv.selectUseCase(u.id);
    for (let i = 0; i < u.steps.length; i++) sv.go(i, true);
    for (const c of demoModel().components.filter((x) => x.parts || x.tables || x.endpoints)) { sv.openDetail(c.id); for (let i = 0; i < u.steps.length; i++) sv.go(i, true); sv.closeDetail(); }
  }
  assert.equal(sv.state.mode, "arch");
});

test("the top bar shows the model's depth as a chip, in both languages; no depth, no chip", () => {
  const withDepth = (depth) => ({ ...demoModel(), depth });
  const ko = load({ model: withDepth("brief") }).byId["sv-depth"];
  assert.equal(ko.hidden, false);
  assert.equal(ko.textContent, "깊이 2 · 한눈에");
  assert.equal(ko.title, "전체 구성만, 세부 없음");
  const en = load({ model: withDepth("diff"), lang: "en" }).byId["sv-depth"];
  assert.equal(en.textContent, "Depth 1 · Changes only");
  assert.equal(en.title, "Only the parts the change touches");
  assert.equal(load({ model: withDepth("full"), lang: "en" }).byId["sv-depth"].textContent, "Depth 3 · Detailed");
  assert.equal(load({ model: withDepth("full"), lang: "en" }).byId["sv-depth"].title, "The whole composition and its detail");
  const none = load({ model: tiny(), changes: null }).byId["sv-depth"];
  assert.equal(none.hidden, true);
  assert.equal(none.textContent, "");
});

/* ───────── 0.3.3: nothing changed, long labels, progress bar, phones ───────── */
const unchanged = (base = "abcdef1234567", head = "abcdef1234567") => ({ title: "no change", summary: "Nothing changed in this range.", ref: "x", components: [], steps: [], details: [], unmapped: [], ignored: [], generated: { by: "nacholens diff", base, head, modelCommit: head, lineTranslation: false } });

test("nothing changed: the range says so, the highlight switch is off, every flow is listed open (not hidden in a fold)", () => {
  const { byId } = load({ changes: unchanged(), lang: "en" });
  assert.equal(byId["sv-ref"].textContent, "abcdef1 · No changes");
  assert.equal(byId["sv-overlay"].getAttribute("disabled"), "");
  const groups = byId["sv-list"].all(has("gh"));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].getAttribute("aria-expanded"), "true");
  assert.equal(byId["sv-list"].all(has("uc")).length, demoModel().useCases.length);
  const ko = load({ changes: unchanged() }).byId["sv-ref"].textContent;
  assert.equal(ko, "abcdef1 · 변경 없음");
});

test("a real range keeps its arrow and the highlight switch stays usable", () => {
  const { byId } = load({ lang: "en" });
  assert.match(byId["sv-ref"].textContent, / → /);
  assert.equal(byId["sv-overlay"].getAttribute("disabled"), null);
});

test("nothing changed: the review dock is folded and says there is nothing to re-test instead of 0/0/0", () => {
  const model = demoModel(), changes = unchanged();
  const review = buildReview(model, changes, {});
  const { rv, byId } = load({ model, changes, review, lang: "en" });
  assert.equal(rv.state.collapsed, true);
  rv.open("impact");
  const text = byId["sv-review"].textContent;
  assert.doesNotMatch(text, /Direct 0 · Indirect 0/);
  assert.match(text, /No changed steps/);
});

test("a flow that is selected stays visible even when its group is folded; search also finds step names", () => {
  const { sv, byId } = load();
  const same = demoModel().useCases.map((u) => u.id).find((id) => !byId["sv-list"].all(has("uc")).some((b) => b.getAttribute("data-uc") === id));
  sv.selectUseCase(same);
  assert.ok(byId["sv-list"].all(has("uc")).some((b) => b.getAttribute("data-uc") === same), "current flow is listed");
  const label = demoModel().useCases.find((u) => u.id === same).steps[1].label;
  byId["sv-q"].fire("input", { target: { value: label.toLowerCase() } });
  assert.ok(byId["sv-list"].all(has("uc")).some((b) => b.getAttribute("data-uc") === same), "found by a step name");
});

test("long names are never silently cut: the label, the route and the caption carry the full text as a tooltip", () => {
  const { sv, byId } = load();
  sv.selectUseCase("list-orders");
  const lbl = byId["sv-list"].all(has("lbl"))[0];
  assert.ok(lbl.getAttribute("title") && lbl.getAttribute("title") === lbl.textContent);
  const m = byId["sv-list"].all(has("m"))[0];
  assert.equal(m.getAttribute("title"), m.textContent);
  sv.go(0, true);
  const txt = byId["sv-caption"].find(has("txt"));
  assert.equal(txt.getAttribute("title"), txt.textContent);
});

test("progress bar: a mark on changed steps, the current step is marked, each segment names its step", () => {
  const { sv, byId } = load();
  sv.selectUseCase("list-orders");
  sv.go(1, false);
  const segs = byId["sv-transport"].find(has("scrub")).children;
  const u = demoModel().useCases.find((x) => x.id === "list-orders");
  assert.equal(segs.length, u.steps.length);
  const chg = demoAutoChanges().steps.filter((c) => c.useCase === "list-orders").map((c) => c.step);
  u.steps.forEach((st, i) => {
    assert.equal(segs[i].classList.contains("chg"), chg.includes(st.id), "changed mark on " + st.id);
    assert.equal(segs[i].classList.contains("cur"), i === 1, "current mark on " + st.id);
    assert.ok(segs[i].getAttribute("title").startsWith((i + 1) + ". " + st.label));
  });
  assert.equal(segs[1].getAttribute("aria-current"), "step");
});

test("phones: below 700px the top bar and the transport wrap instead of widening the page", () => {
  const html = buildPage(demoModel(), demoAutoChanges(), { target: "html", lang: "en" });
  const css = html.match(/@media \(max-width: 700px\) \{[^]*?\n\}/)?.[0] ?? "";
  assert.match(css, /\.transport \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.topbar [^{]*\{[^}]*min-width: 0/);
  assert.match(css, /\.scrub \{[^}]*flex-basis: 100%/);
});

/* ───────── wires: routed around boxes, never under them ───────── */
const geom = (byId) => {
  const boxes = byId["sv-canvas"].all((e) => e.attrs["data-id"] && e.find((c) => c.tagName === "rect")).map((g) => { const r = g.find((c) => c.tagName === "rect"); return { id: g.attrs["data-id"], x0: +r.attrs.x, y0: +r.attrs.y, x1: +r.attrs.x + +r.attrs.width, y1: +r.attrs.y + +r.attrs.height }; });
  const wires = byId["sv-canvas"].all((e) => e.tagName === "path" && /(^| )(lk|wr)( |$)/.test(e.attrs.class ?? "")).map((p) => p.attrs.d.split(/(?=[ML])/).map((s) => s.slice(1).trim().split(/\s+/).map(Number)).map(([x, y]) => ({ x, y })));
  return { boxes, wires };
};
const hitsBox = (a, b, q, pad = 1) => { // does the segment a-b cut through the inside of box q (shrunk by pad)?
  let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, d] of [[-dx, a.x - (q.x0 + pad)], [dx, q.x1 - pad - a.x], [-dy, a.y - (q.y0 + pad)], [dy, q.y1 - pad - a.y]]) {
    if (p === 0) { if (d < 0) return false; } else { const r = d / p; if (p < 0) { if (r > t1) return false; t0 = Math.max(t0, r); } else { if (r < t0) return false; t1 = Math.min(t1, r); } }
  }
  return t1 - t0 > 0.02;
};
const near = (p, q) => p.x >= q.x0 - 6 && p.x <= q.x1 + 6 && p.y >= q.y0 - 6 && p.y <= q.y1 + 6;
function crowded(byId) { // [wires that run through a box they do not start or end at, wires lying on top of each other]
  const { boxes, wires } = geom(byId); let through = 0, stacked = 0;
  wires.forEach((w, i) => {
    const ends = boxes.filter((q) => near(w[0], q) || near(w[w.length - 1], q));
    for (const q of boxes) {
      if (ends.includes(q)) continue;
      if (w.some((p, k) => k && hitsBox(w[k - 1], p, q))) { through++; break; }
    }
    wires.slice(i + 1).forEach((v) => {
      let shared = 0;
      for (let k = 1; k < w.length; k++) for (let m = 1; m < v.length; m++) {
        const a = w[k - 1], b = w[k], c = v[m - 1], d = v[m];
        if (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < 3) shared += Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)));
        if (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < 3) shared += Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)));
      }
      if (shared > 12) stacked++;
    });
  });
  return [through, stacked];
}

test("wires: every flow, in the architecture and inside every component, runs between boxes - never through or under one, never on top of another wire", () => {
  for (const stage of [[1440, 760], [1000, 600]]) {
    const { sv, byId } = load({ stage });
    for (const u of demoModel().useCases) {
      sv.selectUseCase(u.id);
      assert.deepEqual(crowded(byId), [0, 0], `${u.id} architecture ${stage}`);
      for (const c of demoModel().components.filter((x) => x.parts || x.tables || x.endpoints)) {
        sv.openDetail(c.id);
        assert.deepEqual(crowded(byId), [0, 0], `${u.id} inside ${c.id} ${stage}`);
        sv.closeDetail();
      }
    }
  }
});

test("wires: drawn as orthogonal runs with rounded corners, and the travelling packet follows exactly the drawn wire", () => {
  const { sv, byId, clock } = load({ reduce: false });
  sv.selectUseCase("list-orders");
  const { wires } = geom(byId);
  assert.ok(wires.length > 0);
  wires.forEach((w) => w.forEach((p, k) => { if (!k) return; const dx = Math.abs(p.x - w[k - 1].x), dy = Math.abs(p.y - w[k - 1].y); assert.ok(dx < 0.01 || dy < 0.01 || Math.max(dx, dy) <= 10, "straight run or inside a corner: " + JSON.stringify([w[k - 1], p])); }));
  const i = uc("list-orders").steps.findIndex((x) => x.id === "session");
  sv.go(i, true); clock.advance(60);
  const run = layer(byId, "flow").find((e) => e.tagName === "path");
  assert.ok(run, "a leg is travelling");
  const norm = (d) => d.split(/(?=[ML])/).map((q) => q.slice(1).trim()).sort().join("|");
  assert.ok(byId["sv-canvas"].all((e) => e.tagName === "path" && /(^| )lk( |$)/.test(e.attrs.class ?? "")).some((e) => norm(e.attrs.d) === norm(run.attrs.d)), "the packet runs on a drawn wire");
});


/* ───────── copy a place for an LLM: text only / with its hierarchy ───────── */
const flush = () => new Promise((r) => setImmediate(r));
const btn = (root, mode) => root.all((e) => e.attrs["data-copy"] === mode);

test("copy: every flow row and every step row has a text-only and a with-context button; the stage, the inspector and the crumbs have them too", () => {
  const { sv, byId } = load();
  sv.selectUseCase("list-orders");
  const L = uc("list-orders");
  const list = byId["sv-list"];
  const rows = list.all(has("ucrow"));
  assert.ok(rows.length >= 2);
  rows.forEach((r) => { assert.equal(btn(r, "text").length, 1); assert.equal(btn(r, "ctx").length, 1); });
  const steps = list.all(has("st"));
  assert.equal(steps.length, L.steps.length);
  steps.forEach((r) => { assert.equal(btn(r, "text").length, 1); assert.equal(btn(r, "ctx").length, 1); });
  // the stage: one pair per component box, as a sibling of the box (clicking it must not open the box)
  const stage = byId["sv-canvas"];
  const pairs = stage.all(has("cps"));
  assert.equal(pairs.length, stage.all(has("nd")).length);
  pairs.forEach((g) => assert.equal(g.attrs["data-for"] && btn(g, "text").length + btn(g, "ctx").length, 2));
  // inspector: overview, a step and an item inside a component
  assert.equal(btn(byId["sv-insp"], "text").length, 1); assert.equal(btn(byId["sv-insp"], "ctx").length, 1);
  sv.go(0, false);
  assert.equal(btn(byId["sv-insp"], "ctx").length, 1);
  sv.openDetail("api");
  assert.equal(btn(byId["sv-crumbs"], "ctx").length, 1, "crumbs copy the component you are inside");
  const item = Object.keys(sv.scene().boxes).find((id) => !id.startsWith("stub:"));
  sv.selectItem(item);
  assert.equal(btn(byId["sv-insp"], "ctx").length, 1);
  assert.ok(stage.all(has("cps")).length >= 1, "items inside have their own pair");
});

test("copy: a step with context lists product > flow > step > components with a marker on the place; text only is just the words", async () => {
  const { sv, byId, copied } = load();
  sv.selectUseCase("list-orders");
  const L = uc("list-orders"), i = L.steps.findIndex((s) => s.id === "shipping"), st = L.steps[i];
  sv.go(i, false);
  const bar = byId["sv-insp"];
  btn(bar, "text")[0].click(); await flush();
  assert.equal(copied.at(-1), st.label + "\n" + st.narration, "text only: the step name and its narration, nothing else");
  btn(bar, "ctx")[0].click(); await flush();
  const ctx = copied.at(-1).split("\n");
  const demo = demoModel();
  assert.ok(ctx[0].includes(demo.product.name));
  const tree = ctx.slice(ctx.findIndex((l) => l.startsWith("계층")) + 1);
  assert.equal(tree[0], "제품: " + demo.product.name);
  assert.equal(tree[1], "  └ 흐름: " + L.title);
  assert.ok(tree[2].startsWith("    └ 단계 " + (i + 1) + ": " + st.label) && tree[2].endsWith("← 여기"));
  assert.ok(tree[3].startsWith("      └ 컴포넌트: "), "the components the step passes hang under the step");
  assert.ok(copied.at(-1).includes(demo.source.repo), "the repository the model describes");
  for (const e of st.evidence) assert.ok(copied.at(-1).includes(`${e.file}:${e.lines[0]}`), "evidence ranges let the LLM open the code");
});

test("copy: a flow lists its steps below it; the overview inspector copies the flow", async () => {
  const { sv, byId, copied } = load();
  sv.selectUseCase("list-orders");
  const L = uc("list-orders");
  btn(byId["sv-insp"], "ctx")[0].click(); await flush();
  const t = copied.at(-1);
  assert.ok(t.includes("  └ 흐름: " + L.title + "   ← 여기"));
  L.steps.forEach((s, i) => assert.ok(t.includes("    └ " + (i + 1) + ". " + s.label)));
  btn(byId["sv-list"].find((e) => e.getAttribute("data-uc") === "list-orders").parentNode, "text")[0].click(); await flush();
  assert.equal(copied.at(-1), [L.title, L.trigger, L.summary].join("\n"));
});

test("copy: a component box copies its name, kind and description; with context it sits under the flow and step on screen when it is part of them", async () => {
  const { sv, byId, copied } = load();
  sv.selectUseCase("list-orders");
  const L = uc("list-orders");
  sv.go(0, false);
  const demo = demoModel(), st = L.steps[0], cid = st.to;
  const c = demo.components.find((x) => x.id === cid);
  const pair = byId["sv-canvas"].all(has("cps")).find((g) => g.attrs["data-for"] === cid);
  assert.ok(pair);
  let opened = false; const before = JSON.stringify(sv.state);
  btn(pair, "text")[0].click(); await flush();
  assert.equal(JSON.stringify(sv.state), before, "copying does not open the box or change the step");
  assert.ok(copied.at(-1).startsWith(c.label.split("\n").map((x) => x.trim()).join(" — ")));
  assert.ok(copied.at(-1).includes(c.detail));
  btn(pair, "ctx")[0].click(); await flush();
  const t = copied.at(-1);
  assert.match(t, new RegExp("  └ 흐름: " + L.title.replace(/[()]/g, "\\$&")));
  assert.match(t, /← 여기/);
  assert.ok(t.includes("설명: " + c.detail));
  // a component the flow does not touch has no flow above it
  const away = demo.components.find((x) => !L.steps.some((s) => [s.from, ...(s.via ?? []), s.to].includes(x.id)));
  if (away) assert.ok(!sv.copyOf({ t: "comp", id: away.id }).context.includes("흐름:"));
});

test("copy: inside a component, a part/table/endpoint copies with its component and flow above it", () => {
  const { sv } = load();
  for (const cid of ["api", "db", "idp", "shipping"]) {
    const c = demoModel().components.find((x) => x.id === cid);
    if (!c) continue;
    sv.selectUseCase("list-orders");
    sv.go(0, false);
    sv.openDetail(cid);
    const ids = Object.keys(sv.scene().boxes).filter((id) => !id.startsWith("stub:"));
    for (const id of ids) {
      const out = sv.copyOf({ t: "item", id });
      assert.ok(out.text.length > 0);
      assert.ok(out.context.includes("컴포넌트: " + c.label.split("\n").map((x) => x.trim()).join(" — ")), `${cid} ${id}`);
      assert.match(out.context, /← 여기/);
    }
    sv.closeDetail();
  }
});

test("copy: the English page speaks English in the copied text and in its buttons", async () => {
  const { sv, byId, copied } = load({ lang: "en" });
  sv.selectUseCase("list-orders"); sv.go(0, false);
  const b = btn(byId["sv-insp"], "ctx")[0];
  assert.match(b.getAttribute("aria-label"), /^Copy with context/);
  b.click(); await flush();
  assert.match(copied.at(-1), /Hierarchy:/);
  assert.match(copied.at(-1), /← here/);
  assert.ok(!/[가-힣]/.test(copied.at(-1).split("\n").filter((l) => /^(Source|Hierarchy|This is)|^ *└ (Flow|Step)|^Path|^Kind/.test(l)).join("\n").replace(/(Flow|Step \d+): .*/g, "$1")), "the page's own words are English");
});

test("copy: feedback and fallbacks - a copy shows done for a moment; a blocked clipboard falls back to selection copy; nothing works: fail", async () => {
  let r = load();
  r.sv.selectUseCase("list-orders"); r.sv.go(0, false);
  let b = btn(r.byId["sv-insp"], "text")[0];
  b.click(); await flush();
  assert.ok(b.classList.contains("done"));
  assert.equal(r.doc.getElementById("sv-copy-status")?.textContent ?? r.doc.body.find((e) => e.attrs.id === "sv-copy-status")?.textContent, "복사했습니다");
  r.clock.advance(2000);
  assert.ok(!b.classList.contains("done"), "the mark goes away");
  r = load({ clipboard: "denied" });
  r.sv.selectUseCase("list-orders"); r.sv.go(0, false);
  btn(r.byId["sv-insp"], "text")[0].click(); await flush();
  assert.ok(r.copied.at(-1).startsWith("execCommand:"), "denied clipboard -> selection copy");
  r = load({ clipboard: "none" });
  r.sv.selectUseCase("list-orders"); r.sv.go(0, false);
  btn(r.byId["sv-insp"], "text")[0].click(); await flush();
  assert.ok(r.copied.at(-1).startsWith("execCommand:"));
  r = load({ clipboard: "stuck" });
  r.sv.selectUseCase("list-orders"); r.sv.go(0, false);
  b = btn(r.byId["sv-insp"], "text")[0]; b.click(); await flush();
  assert.ok(b.classList.contains("fail"));
});

test("copy: a change shows up in the copied context only while the highlight is on", () => {
  const { sv } = load();
  sv.selectUseCase("list-orders");
  const L = uc("list-orders");
  const changed = demoAutoChanges().steps.find((c) => c.useCase === "list-orders");
  assert.ok(changed);
  const k = L.steps.findIndex((s) => s.id === changed.step);
  assert.match(sv.copyOf({ t: "step", u: "list-orders", i: k }).context, /변경: /);
  sv.setOverlay(false);
  assert.ok(!/변경: /.test(sv.copyOf({ t: "step", u: "list-orders", i: k }).context));
});
