import test from "node:test";
import assert from "node:assert/strict";
import { validateModel, validateChanges } from "../src/model.js";
import { demoModel, demoChanges, demoAutoChanges, tiny, clone } from "./helpers.js";
import { collectEvidence } from "../src/verify.js";
import { generateOverlay } from "../src/diff.js";

const has = (errors, needle) => errors.some((e) => e.includes(needle));

test("tiny fixture and the bundled demo-shop model are valid", () => {
  assert.deepEqual(validateModel(tiny()), []);
  assert.deepEqual(validateModel(demoModel()), []);
  assert.deepEqual(validateChanges(demoChanges(), demoModel()), []);
});

test("MVP requirement: at least two use cases, each with ordered steps and a gateway hop", () => {
  const m = demoModel();
  assert.ok(m.useCases.length >= 2);
  for (const u of m.useCases) {
    assert.ok(u.steps.length >= 3, u.id);
    assert.ok(u.steps.some((s) => (s.via ?? []).includes("gateway")), `${u.id} passes through the gateway`);
  }
});

test("every component, link and step carries evidence (no guesses)", () => {
  const m = demoModel();
  for (const c of m.components) assert.ok(c.evidence.length > 0, c.id);
  for (const l of m.links) assert.ok(l.evidence.length > 0, `${l.a}-${l.b}`);
  for (const u of m.useCases) for (const s of u.steps) assert.ok(s.evidence.length > 0, `${u.id}/${s.id}`);
});

const mutations = [
  ["step without evidence", (m) => (m.useCases[0].steps[0].evidence = []), "근거"],
  ["component without evidence", (m) => delete m.components[0].evidence, "components[0].evidence"],
  ["step references unknown component", (m) => (m.useCases[0].steps[1].to = "ghost"), "선언된 컴포넌트"],
  ["step over an undeclared link", (m) => (m.useCases[0].steps[0].via = []), "연결(links)이 선언되지 않았습니다"],
  ["internal step with via", (m) => (m.useCases[0].steps[2].via = ["gw"]), "internal"],
  ["call without response summary", (m) => delete m.useCases[0].steps[1].response, "response"],
  ["request without request summary", (m) => delete m.useCases[0].steps[0].request, "request"],
  ["duplicate component id", (m) => (m.components[1].id = "web"), "중복"],
  ["duplicate step id", (m) => (m.useCases[0].steps[1].id = "s1"), "중복"],
  ["link to the same component", (m) => (m.links[0].b = "web"), "서로 다른"],
  ["duplicate link pair", (m) => m.links.push(clone(m.links[0])), "중복"],
  ["unknown component kind", (m) => (m.components[0].kind = "mainframe"), "kind"],
  ["unknown step kind", (m) => (m.useCases[0].steps[0].kind = "teleport"), "kind"],
  ["missing narration", (m) => (m.useCases[0].steps[0].narration = ""), "narration"],
  ["absolute evidence path", (m) => (m.components[0].evidence[0].file = "/etc/passwd"), "상대 경로"],
  ["path traversal in evidence", (m) => (m.components[0].evidence[0].file = "../x"), "상대 경로"],
  ["reversed evidence lines", (m) => (m.components[0].evidence[0].lines = [9, 2]), "lines"],
  ["unknown evidence key", (m) => (m.components[0].evidence[0].note = "x"), "알 수 없는 키"],
  ["bad schemaVersion", (m) => (m.schemaVersion = 2), "schemaVersion"],
  ["no source commit", (m) => delete m.source, "source"],
  ["no use cases", (m) => (m.useCases = []), "useCases"],
];
for (const [name, mutate, needle] of mutations) {
  test(`rejects: ${name}`, () => {
    const m = tiny();
    mutate(m);
    const errors = validateModel(m);
    assert.ok(errors.length > 0, "expected at least one error");
    assert.ok(has(errors, needle), `expected "${needle}" in ${JSON.stringify(errors)}`);
  });
}

test("rejects a non-object model without throwing", () => {
  for (const v of [null, 3, "x", []]) assert.ok(validateModel(v).length > 0);
});

test("change overlay: unknown component / step / change kind are rejected", () => {
  const model = demoModel();
  const base = demoChanges();
  const cases = [
    ["unknown component", (c) => (c.components[0].id = "ghost"), "모델에 없는 컴포넌트"],
    ["unknown step", (c) => (c.steps[0].step = "ghost"), "모델에 없는 useCase/step"],
    ["bad change kind", (c) => (c.components[0].change = "tweaked"), "change"],
    ["missing ref", (c) => delete c.ref, "ref"],
    ["duplicate component", (c) => c.components.push(clone(c.components[0])), "중복"],
  ];
  for (const [name, mutate, needle] of cases) {
    const c = clone(base);
    mutate(c);
    const errors = validateChanges(c, model);
    assert.ok(has(errors, needle), `${name}: ${JSON.stringify(errors)}`);
  }
  assert.deepEqual(validateChanges(null, model), []);
});

test("demo-shop: auto overlay is valid, every use case has evidence, a gateway hop and a changed step somewhere", () => {
  const m = demoModel();
  assert.deepEqual(validateChanges(demoAutoChanges(), m), []);
  assert.ok(m.useCases.length >= 4);
  for (const u of m.useCases) for (const s of u.steps) assert.ok(s.evidence.length > 0, `${u.id}/${s.id}`);
  assert.ok(demoAutoChanges().steps.length > 0 && demoAutoChanges().unmapped.length > 0, "the demo shows both a changed step and the 'not in the model' warning");
});

// Private product models (never in the public tree) are checked only when their folder is supplied.
test("private example models validate when NACHOLENS_PRIVATE is set", { skip: !process.env.NACHOLENS_PRIVATE }, async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(process.env.NACHOLENS_PRIVATE, "models");
  const names = readdirSync(dir);
  assert.ok(names.length > 0);
  for (const name of names) assert.deepEqual(validateModel(JSON.parse(readFileSync(join(dir, name, "model.json"), "utf8"))), [], name);
});

// ---------- optional drill-down detail ----------
function detailed() {
  const m = tiny();
  const ev = [{ file: "a.js", lines: [1, 2], contains: "x" }];
  const api = m.components.find((c) => c.id === "api");
  api.parts = [
    { id: "route", label: "GET /x", role: "route", detail: "d", evidence: ev },
    { id: "svc", label: "Service", role: "service", detail: "d", evidence: ev },
    { id: "repo", label: "Repo", role: "adapter", detail: "d", connects: "db", evidence: ev },
  ];
  api.wires = [{ from: "route", to: "svc", label: "call", evidence: ev }, { from: "svc", to: "repo", label: "query", evidence: ev }];
  m.components.find((c) => c.id === "db").tables = [{ name: "users", detail: "d", columns: [{ name: "id", type: "uuid" }, { name: "email" }], evidence: ev }];
  m.components.push({ id: "ext", kind: "external", label: "Ext", detail: "d", evidence: ev,
    endpoints: [{ id: "embed", method: "POST", path: "/v1/embeddings", auth: "Bearer API key", detail: "d", request: [{ name: "input" }], response: [{ name: "data[].embedding" }], evidence: ev }] });
  m.links.push({ a: "api", b: "ext", label: "l", evidence: ev });
  const steps = m.useCases[0].steps;
  steps[0].trace = ["api/route"];
  steps[1].trace = ["api/svc", "api/repo"];
  steps[1].data = [{ store: "db", table: "users", op: "read", columns: ["email"], evidence: ev }];
  steps.splice(2, 0, { id: "s5", kind: "call", from: "api", to: "ext", label: "L", narration: "N", request: "R", response: "P", endpoints: ["ext/embed"], evidence: ev });
  return m;
}

test("detail fields are optional: a model without them is valid, a fully detailed one is valid too", () => {
  assert.deepEqual(validateModel(tiny()), []);
  assert.deepEqual(validateModel(detailed()), []);
});

test("detail fields are checked: kinds, references, wires along a trace, columns, evidence", () => {
  const bad = (fn, re) => { const m = detailed(); fn(m); const e = validateModel(m); assert.ok(e.some((x) => re.test(x)), `${re} not in ${JSON.stringify(e)}`); };
  bad((m) => { m.components.find((c) => c.id === "api").parts[0].evidence = []; }, /parts\[0\]\.evidence/);
  bad((m) => { m.components.find((c) => c.id === "api").parts[0].role = "thing"; }, /role/);
  bad((m) => { m.components.find((c) => c.id === "db").parts = [{ id: "x", label: "x", role: "module", detail: "d", evidence: [{ file: "a.js", lines: [1, 1] }] }]; }, /client\|gateway\|service 에만/);
  bad((m) => { m.components.find((c) => c.id === "api").tables = []; }, /datastore 에만/);
  bad((m) => { m.components.find((c) => c.id === "api").wires.pop(); }, /svc→repo 배선/);
  bad((m) => { m.useCases[0].steps[0].trace = ["api/nope"]; }, /선언된 "컴포넌트\/파트"/);
  bad((m) => { m.useCases[0].steps[0].trace = ["db/route"]; }, /trace\[0\]/);
  bad((m) => { m.useCases[0].steps[1].data[0].columns = ["password"]; }, /선언되지 않은 컬럼 password/);
  bad((m) => { m.useCases[0].steps[1].data[0].op = "write"; }, /op: read\|insert/);
  bad((m) => { delete m.useCases[0].steps[1].data[0].evidence; }, /data\[0\]\.evidence/);
  bad((m) => { m.useCases[0].steps[2].endpoints = ["ext/nope"]; }, /엔드포인트/);
  bad((m) => { m.components.find((c) => c.id === "ext").endpoints[0].method = "FETCH"; }, /method/);
  bad((m) => { m.components.find((c) => c.id === "api").parts[2].connects = "api"; }, /connects/);
});

test("secrets are refused anywhere in a model (auth is named, never given)", () => {
  for (const v of ["Bearer abcdefghijklmnop1234", "sk-abcdefghijklmnopqrstuv", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0", "-----BEGIN PRIVATE KEY-----"]) {
    const m = detailed();
    m.components.find((c) => c.id === "ext").endpoints[0].auth = v.slice(0, 60);
    assert.ok(validateModel(m).some((e) => /비밀값처럼/.test(e)), v);
  }
  const ok = detailed();
  ok.components.find((c) => c.id === "ext").endpoints[0].auth = "Bearer API key (env TRACKER_API_KEY)";
  assert.deepEqual(validateModel(ok), []);
});

test("detail evidence is verified and diffed: table access belongs to its step, parts/tables/endpoints show up as changes.details", () => {
  const m = detailed();
  const ev = collectEvidence(m);
  assert.ok(ev.some((e) => e.owner.type === "detail" && e.owner.kind === "endpoint" && e.owner.id === "embed"));
  assert.ok(ev.some((e) => e.where.includes("data db.users") && e.owner.type === "step"));
  const diffText = ["diff --git a/a.js b/a.js", "--- a/a.js", "+++ b/a.js", "@@ -1,2 +1,2 @@", "-x", "+x2", " y"].join("\n");
  const o = generateOverlay({ model: m, diffText, meta: {} });
  assert.ok(o.details.some((d) => d.component === "ext" && d.kind === "endpoint" && d.id === "embed"));
  assert.ok(o.details.some((d) => d.component === "api" && d.kind === "wire" && d.id === "route>svc"));
  assert.deepEqual(validateChanges(o, m), []);
  assert.ok(validateChanges({ ...o, details: [{ component: "api", kind: "part", id: "ghost", change: "added", note: "n" }] }, m).some((e) => /모델에 없는 상세/.test(e)));
});

// ---------- step.payload / step.transforms (optional) ----------
const firstCall = (m) => m.useCases.flatMap((u) => u.steps).find((s) => s.kind === "call" && s.trace);
const ev1 = () => [{ file: "db.js", lines: [1, 1] }];
test("payload: format and leg are checked, values are placeholders (real-looking personal data is refused)", () => {
  const m = clone(demoModel());
  const st = firstCall(m);
  st.payload = [{ leg: "request", format: "sql", body: "SELECT 1", bind: [{ name: "?1", value: "<email>" }], evidence: ev1() }];
  assert.deepEqual(validateModel(m), []);
  for (const [bad, needle] of [
    [{ leg: "sideways", format: "sql", body: "x", evidence: ev1() }, ".leg"],
    [{ leg: "request", format: "yaml", body: "x", evidence: ev1() }, ".format"],
    [{ leg: "request", format: "json", evidence: ev1() }, "body, bind, columns"],
    [{ leg: "request", format: "json", body: "x" }, "evidence"],
    [{ leg: "request", format: "json", body: '{"email":"kim@gmail.com"}', evidence: ev1() }, "이메일"],
    [{ leg: "request", format: "json", body: '{"tel":"010-1234-5678"}', evidence: ev1() }, "전화번호"],
    [{ leg: "request", format: "row", columns: [{ name: "id", value: "12345678901" }], evidence: ev1() }, "10자리"],
    [{ leg: "request", format: "json", body: "x", evidence: ev1(), extra: 1 }, "알 수 없는 키"],
  ]) {
    st.payload = [bad];
    assert.ok(has(validateModel(m), needle), `${needle}: ${JSON.stringify(validateModel(m))}`);
  }
  st.payload = [{ leg: "request", format: "json", body: '{"email":"buyer@example.com"}', evidence: ev1() }];
  assert.deepEqual(validateModel(m), [], "example.com addresses are documentation, not personal data");
  const internal = m.useCases.flatMap((u) => u.steps).find((s) => s.kind === "internal");
  internal.payload = [{ leg: "request", format: "json", body: "x", evidence: ev1() }];
  assert.ok(has(validateModel(m), "internal 단계에는 둘 수 없습니다"));
});

test("transforms: must sit on a part of the step's trace, with in/out shapes and evidence", () => {
  const m = clone(demoModel());
  const st = firstCall(m);
  const ok = { at: st.trace[0], in: { type: "A", fields: ["x"] }, out: { type: "B" }, map: [{ from: "x", to: "y", how: "z" }], evidence: ev1() };
  st.transforms = [ok];
  assert.deepEqual(validateModel(m), []);
  for (const [bad, needle] of [
    [{ ...ok, at: "api/nowhere" }, ".at"],
    [{ ...ok, in: { fields: ["x"] } }, ".in.type"],
    [{ ...ok, out: { type: "B", fields: [] } }, ".out.fields"],
    [{ ...ok, map: [{ from: "x" }] }, "from/to"],
    [{ ...ok, evidence: [] }, "evidence"],
  ]) {
    st.transforms = [bad];
    assert.ok(has(validateModel(m), needle), `${needle}: ${JSON.stringify(validateModel(m))}`);
  }
  delete st.trace; st.transforms = [ok];
  assert.ok(has(validateModel(m), "trace 가 먼저 필요합니다"));
});

test("payload and transform evidence is collected (verify checks it against the source and diff marks the step)", () => {
  const m = clone(demoModel());
  const st = firstCall(m);
  const uc = m.useCases.find((u) => u.steps.includes(st));
  st.payload = [{ leg: "request", format: "sql", body: "x", evidence: [{ file: "p.js", lines: [3, 4] }] }];
  st.transforms = [{ at: st.trace[0], in: { type: "A" }, out: { type: "B" }, evidence: [{ file: "t.js", lines: [7, 7] }] }];
  const ev = collectEvidence(m).filter((e) => e.e.file === "p.js" || e.e.file === "t.js");
  assert.equal(ev.length, 2);
  assert.ok(ev.every((e) => e.owner.type === "step" && e.owner.uc === uc.id && e.owner.step === st.id));
});
