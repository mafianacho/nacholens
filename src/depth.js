// Collection depth: how much of a repository a model covers.
//   diff  : only what a git change touches (changed use cases/steps, the components and tables they pass)
//   brief : the whole composition (components, links, main use cases, datastores) without drill-down
//   full  : the whole composition plus all the drill-down the schema allows
// `depth` is an optional model field. A model without it behaves exactly as before; nothing here
// ever fails a build. The checks return warnings (and notes), never errors: a model that does not
// follow its declared depth is still a valid model.
import { DEPTHS } from "./model.js";
import { parseDiff, ignoreReason, unmappedCategory } from "./diff.js";
import { fileLeads } from "./scan.js";

export { DEPTHS };

const STEP_DETAIL = ["trace", "data", "endpoints", "payload", "transforms"];
const COMPONENT_DETAIL = ["parts", "wires", "tables", "endpoints"];

/** `--depth` value + the model's declared depth -> { depth, error }. A flag that contradicts the model is an error. */
export function resolveDepth(model, flag) {
  if (flag !== undefined && !DEPTHS.includes(flag)) throw new Error(`--depth 은 ${DEPTHS.join("|")} 중 하나여야 합니다 (받은 값: ${JSON.stringify(flag)})`);
  const declared = model?.depth;
  if (flag !== undefined && declared !== undefined && declared !== flag)
    return { depth: null, error: `모델은 depth "${declared}" 로 선언되어 있는데 --depth ${flag} 가 지정됐습니다. 맞는 쪽을 고르세요 (모델의 depth 를 고치거나 --depth 를 빼세요)` };
  return { depth: flag ?? declared ?? null, declared: declared ?? null, error: null };
}

const list = (items, n = 4) => items.slice(0, n).join(", ") + (items.length > n ? ` 외 ${items.length - n}` : "");
const stepKey = (u, s) => `${u.id}/${s.id}`;
const allSteps = (model) => model.useCases.flatMap((u) => u.steps.map((s) => ({ u, s, key: stepKey(u, s) })));
const pathOf = (s) => [s.from, ...(s.via ?? []), s.to];
const pairKey = (a, b) => [a, b].sort().join("|");

function briefWarnings(model, w) {
  for (const k of COMPONENT_DETAIL) {
    const ids = model.components.filter((c) => c[k] !== undefined).map((c) => c.id);
    if (ids.length) w.push(`brief 수준인데 컴포넌트 ${ids.length}개에 ${k} 가 있습니다 (${list(ids)}) — drill-down 은 full 수준의 몫`);
  }
  for (const k of STEP_DETAIL) {
    const keys = allSteps(model).filter(({ s }) => s[k] !== undefined).map((x) => x.key);
    if (keys.length) w.push(`brief 수준인데 단계 ${keys.length}개에 ${k} 가 있습니다 (${list(keys)}) — drill-down 은 full 수준의 몫`);
  }
}

function fullWarnings(model, w) {
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const noTables = model.components.filter((c) => c.kind === "datastore" && !(c.tables?.length)).map((c) => c.id);
  if (noTables.length) w.push(`full 수준인데 datastore ${list(noTables)} 에 tables 가 없습니다 — 마이그레이션·스키마에서 table 과 column 을 읽어 쓰세요`);
  const noParts = model.components.filter((c) => c.kind === "service" && !(c.parts?.length)).map((c) => c.id);
  if (noParts.length) w.push(`full 수준인데 service ${list(noParts)} 에 parts 가 없습니다 — 내부 route/handler/service/adapter 를 읽어 쓰세요`);
  const noWires = model.components.filter((c) => c.parts?.length && !(c.wires?.length)).map((c) => c.id);
  if (noWires.length) w.push(`full 수준인데 ${list(noWires)} 에 parts 는 있으나 wires 가 없습니다 — 호출 지점을 본 배선을 쓰세요`);
  const noEndpoints = model.components.filter((c) => c.kind === "external" && !(c.endpoints?.length)).map((c) => c.id);
  if (noEndpoints.length) w.push(`full 수준인데 external ${list(noEndpoints)} 에 endpoints 가 없습니다 — 호출 지점에서 method·path 를 읽어 쓰세요`);
  const steps = allSteps(model);
  const noData = steps.filter(({ s }) => s.kind === "call" && byId.get(s.to)?.kind === "datastore" && !(s.data?.length)).map((x) => x.key);
  if (noData.length) w.push(`full 수준인데 datastore 를 부르는 단계 ${noData.length}개에 data 가 없습니다 (${list(noData)}) — 실제 쿼리의 op·columns 를 쓰세요`);
  const noEp = steps.filter(({ s }) => (s.kind === "call" || s.kind === "request") && byId.get(s.to)?.kind === "external" && !(s.endpoints?.length)).map((x) => x.key);
  if (noEp.length) w.push(`full 수준인데 external 을 부르는 단계 ${noEp.length}개에 endpoints 가 없습니다 (${list(noEp)})`);
  const noTrace = steps.filter(({ s }) => !s.trace && pathOf(s).some((id) => byId.get(id)?.parts?.length)).map((x) => x.key);
  if (noTrace.length) w.push(`full 수준인데 parts 가 있는 컴포넌트를 지나는 단계 ${noTrace.length}개에 trace 가 없습니다 (${list(noTrace)})`);
  if (!steps.some(({ s }) => s.payload?.length)) w.push("full 수준인데 payload 가 하나도 없습니다 — 오가는 요청·응답·SQL 의 형태를 한 단계 이상에 쓰세요");
}

/** diff: nothing in the model should lie outside the steps (and the changes) it describes */
function diffWarnings(model, changes, w, notes) {
  const steps = allSteps(model);
  const onPath = new Set(), hops = new Set(), tracedParts = new Set(), tableUse = new Set();
  for (const { s } of steps) {
    const p = pathOf(s);
    p.forEach((id) => onPath.add(id));
    for (let i = 0; i + 1 < p.length; i++) hops.add(pairKey(p[i], p[i + 1]));
    (s.trace ?? []).forEach((r) => tracedParts.add(r));
    (s.data ?? []).forEach((d) => tableUse.add(`${d.store}/${d.table}`));
  }
  const strayC = model.components.filter((c) => !onPath.has(c.id)).map((c) => c.id);
  if (strayC.length) w.push(`diff 수준인데 어떤 단계도 지나지 않는 컴포넌트가 있습니다 (${list(strayC)}) — 변경 단계가 지나는 컴포넌트만 넣으세요`);
  const strayL = model.links.filter((l) => !hops.has(pairKey(l.a, l.b))).map((l) => `${l.a}-${l.b}`);
  if (strayL.length) w.push(`diff 수준인데 어떤 단계도 건너지 않는 연결이 있습니다 (${list(strayL)})`);
  const strayT = model.components.flatMap((c) => (c.tables ?? []).filter((t) => !tableUse.has(`${c.id}/${t.name}`)).map((t) => `${c.id}.${t.name}`));
  if (strayT.length) w.push(`diff 수준인데 변경 단계가 읽거나 쓰지 않는 table 이 있습니다 (${list(strayT)}) — 단계의 data 가 가리키는 table 만 넣으세요`);
  const strayP = model.components.flatMap((c) => (c.parts ?? []).filter((p) => !tracedParts.has(`${c.id}/${p.id}`)).map((p) => `${c.id}/${p.id}`));
  if (strayP.length) w.push(`diff 수준인데 어떤 단계의 trace 에도 없는 part 가 있습니다 (${list(strayP)})`);
  if (!changes) {
    notes.push("diff 수준: 변경 범위(--repo --base 또는 --changes)가 없어 단계가 이번 변경에 닿는지는 검사하지 못했습니다 (구조만 검사)");
    return;
  }
  const hit = new Set((changes.steps ?? []).map((s) => `${s.useCase}/${s.step}`));
  const outside = steps.filter((x) => !hit.has(x.key)).map((x) => x.key);
  if (outside.length) w.push(`diff 수준인데 이번 변경에 닿지 않는 단계가 ${outside.length}개 있습니다 (${list(outside)}) — 증거가 변경 줄과 겹치는 단계만 넣으세요`);
  const modelSteps = new Set(steps.map((x) => x.key));
  const missing = [...hit].filter((k) => !modelSteps.has(k));
  if (missing.length) w.push(`변경이 닿는 단계가 모델에 없습니다 (${list(missing)})`);
}

/**
 * Rules of one depth. Returns { warnings, notes }. `changes` is the change overlay (diff scope), optional.
 * A model with no depth (depth === null) is not checked: that is the behaviour before depth existed.
 */
export function checkDepth(model, depth, { changes = null } = {}) {
  const warnings = [], notes = [];
  if (!depth) return { warnings, notes };
  if (depth === "brief") briefWarnings(model, warnings);
  else if (depth === "full") fullWarnings(model, warnings);
  else if (depth === "diff") diffWarnings(model, changes, warnings, notes);
  return { warnings, notes };
}

/** Counts a depth report quotes: how big the model is (nodes = components, steps across all use cases). */
export function sizeOf(model) {
  const steps = model.useCases.reduce((n, u) => n + u.steps.length, 0);
  const detail = { parts: 0, wires: 0, tables: 0, columns: 0, endpoints: 0 };
  for (const c of model.components) {
    detail.parts += c.parts?.length ?? 0; detail.wires += c.wires?.length ?? 0; detail.endpoints += c.endpoints?.length ?? 0;
    detail.tables += c.tables?.length ?? 0;
    for (const t of c.tables ?? []) detail.columns += t.columns?.length ?? 0;
  }
  return { components: model.components.length, links: model.links.length, useCases: model.useCases.length, steps, ...detail };
}

/* ---------------------------- scan --depth diff ---------------------------- */

const newSide = (h) => (h.newCount > 0 ? [h.newStart, h.newStart + h.newCount - 1] : [Math.max(1, h.newStart), h.newStart + 1]);
const inRanges = (ranges, line) => ranges.some((r) => r[0] <= line && line <= r[1]);
const rangeText = (rs) => rs.map((r) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`)).join(", ");

/**
 * Candidate list for a diff-depth model: the changed files (tests, docs, lock files and assets set apart with
 * their reason), the changed line ranges at head, and the scan leads (routes, gateways, data, clients, outbound
 * hosts, env-injected addresses) that sit INSIDE those ranges. Leads, not facts: the author reads the code.
 * `repo` comes from openRepo(); nothing is written.
 */
export function scanDiff(repo, baseRef, headRef) {
  const base = repo.resolve(baseRef), head = repo.resolve(headRef);
  const files = [], ignored = [];
  const leads = { routes: [], gateways: [], data: [], clients: [], outbound: [], outboundEnv: [] };
  for (const f of parseDiff(repo.diff(base, head))) {
    const why = ignoreReason(f.path);
    if (why) { ignored.push({ file: f.path, reason: why }); continue; }
    const whole = f.status === "A" || f.binary;
    const ranges = f.status === "D" || f.binary ? [] : f.hunks.map(newSide);
    files.push({
      file: f.path, status: f.status === "A" ? "added" : f.status === "D" ? "deleted" : "modified", category: unmappedCategory(f.path),
      lines: f.status === "D" ? "whole file" : f.binary ? "binary" : rangeText(ranges), hunks: f.hunks.length,
    });
    if (f.status === "D" || f.binary) continue;
    const text = repo.show(head, f.path);
    if (text === null || text.length > 400_000) continue;
    const lf = fileLeads(f.path, text);
    const keep = (x) => whole || inRanges(ranges, x.line);
    for (const [k, v] of [["routes", lf.routes], ["gateways", lf.gateways], ["data", lf.data], ["clients", lf.clients], ["outbound", lf.hosts], ["outboundEnv", lf.envs]])
      leads[k].push(...v.filter(keep));
  }
  return { depth: "diff", base, head, files, ignored, leads, stats: { changed: files.length + ignored.length, candidates: files.length, ignored: ignored.length } };
}

export function formatScanDiff(r) {
  const short = (s) => s.slice(0, 7);
  const line = (x) => `  ${x.file}:${x.line}  ${x.host ? `[${x.host}] ` : x.name ? `[${x.name}] ` : ""}${x.text}`;
  const sec = (title, hint, items) => [`## ${title} (${items.length}) — ${hint}`, ...items.map(line), ""].join("\n");
  return [
    `# nacholens scan --depth diff — 모델링 후보 ${short(r.base)}..${short(r.head)} (사실이 아닙니다. 코드를 직접 읽고 근거를 쓰세요)`,
    `변경 파일 ${r.stats.changed}개 · 모델링 후보 ${r.stats.candidates}개 · 무시 ${r.stats.ignored}개 (테스트·문서·잠금 파일·에셋)`,
    "diff 수준 모델은 아래 변경 줄에 닿는 유즈케이스·단계와, 그 단계가 지나는 컴포넌트·table 만 담습니다. 아래에 없는 구조는 넣지 마세요.", "",
    `## 변경 파일 (${r.files.length}) — 파일 · 상태 · 변경된 줄(head 기준) · 분류`,
    ...r.files.map((f) => `  ${f.file}  [${f.status}${f.category === "code" ? "" : ", " + f.category}]  줄 ${f.lines}${f.hunks ? ` (${f.hunks} hunk${f.hunks > 1 ? "s" : ""})` : ""}`), "",
    sec("변경 줄 안의 라우트", "유즈케이스의 trigger 후보", r.leads.routes),
    sec("변경 줄 안의 게이트웨이 단서", "via 후보", r.leads.gateways),
    sec("변경 줄 안의 데이터 접근", "call 단계·datastore 후보", r.leads.data),
    sec("변경 줄 안의 HTTP 호출", "external 호출 단계 후보", r.leads.clients),
    sec("변경 줄 안의 바깥 호스트", "external 컴포넌트 후보", r.leads.outbound),
    sec("변경 줄 안의 환경변수 주소", "이름만, 값은 보지 않음", r.leads.outboundEnv),
    r.ignored.length ? `## 무시 (${r.ignored.length})\n${r.ignored.map((i) => `  ${i.file}  [${i.reason}]`).join("\n")}\n` : "",
  ].join("\n");
}
