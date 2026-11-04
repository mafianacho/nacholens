// Model + change-overlay validation. This is the single source of truth for the schema
// (README documents it). Pure functions, no I/O, no dependencies.

export const KINDS = ["client", "gateway", "service", "datastore", "external"];
export const STEP_KINDS = ["request", "response", "call", "internal"];
export const CHANGE_KINDS = ["added", "modified", "removed"];
// optional collection depth (see src/depth.js): which part of a repository the model covers
export const DEPTHS = ["diff", "brief", "full"];
// optional drill-down detail (all fields optional; a model without them renders as before)
export const PART_ROLES = ["route", "handler", "middleware", "service", "port", "adapter", "job", "module"];
export const DATA_OPS = ["read", "insert", "update", "upsert", "delete"];
export const DETAIL_KINDS = ["part", "wire", "table", "endpoint"];
export const PAYLOAD_FORMATS = ["json", "http", "sql", "row", "text", "vector", "sse", "ws"];
// payload values are shapes and placeholders (<uuid>, <text>), never real people's data
const PERSONAL = [
  [/[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9-]+\.[A-Za-z]{2,}/, "이메일 주소"],
  [/\b0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}\b|\+\d{1,3}[- .]?\d{2,4}[- .]?\d{3,4}[- .]?\d{3,4}/, "전화번호"],
  [/\b\d{6}[- ]?[1-4]\d{6}\b/, "주민등록번호 형식"],
  [/\d{10,}/, "10자리 이상 숫자"],
];
const TABLE = /^[A-Za-z_][A-Za-z0-9_.]{0,62}$/;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_.\[\]]{0,62}$/;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "WS", "RPC", "SSE"];
// secret-looking strings are refused anywhere in a model: detail views name an auth scheme, never a value
const SECRET = /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN|xox[abprs]-[A-Za-z0-9-]{8,}|(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{16,})/;

const ID = /^[a-z][a-z0-9-]{0,47}$/;
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v, max = 400) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;

export function linkKey(a, b) {
  return [a, b].sort().join("|");
}

/** Ordered component ids a step travels through (from, via..., to). */
export function stepPath(step) {
  return [step.from, ...(step.via ?? []), step.to];
}

function checkEvidence(list, where, errors) {
  if (!Array.isArray(list) || list.length === 0) {
    errors.push(`${where}.evidence: 근거(evidence)가 1개 이상 필요합니다 (추측 금지)`);
    return;
  }
  list.forEach((e, i) => {
    const w = `${where}.evidence[${i}]`;
    if (!isObj(e)) return errors.push(`${w}: 객체여야 합니다`);
    if (
      !isStr(e.file, 300) ||
      e.file.startsWith("/") ||
      e.file.split("/").includes("..")
    )
      errors.push(`${w}.file: 저장소 기준 상대 경로여야 합니다`);
    if (
      !Array.isArray(e.lines) ||
      e.lines.length !== 2 ||
      !e.lines.every((n) => Number.isInteger(n) && n >= 1) ||
      e.lines[0] > e.lines[1]
    )
      errors.push(`${w}.lines: [시작,끝] 양의 정수 (시작<=끝)`);
    if (e.contains !== undefined && !isStr(e.contains, 200))
      errors.push(`${w}.contains: 1~200자 문자열`);
    for (const k of Object.keys(e))
      if (!["file", "lines", "contains"].includes(k))
        errors.push(`${w}: 알 수 없는 키 ${k}`);
  });
}

export function validateModel(model) {
  const errors = [];
  if (!isObj(model)) return ["model: 객체여야 합니다"];
  if (model.schemaVersion !== 1) errors.push("schemaVersion: 1 이어야 합니다");
  if (model.depth !== undefined && !DEPTHS.includes(model.depth)) errors.push(`depth: ${DEPTHS.join("|")} 중 하나 (선택 필드)`);

  const p = model.product;
  if (!isObj(p) || !ID.test(p.id ?? "") || !isStr(p.name, 80) || !isStr(p.description, 400))
    errors.push("product: {id(소문자-하이픈), name, description} 필요");

  const s = model.source;
  if (!isObj(s) || !isStr(s.repo, 100) || !isStr(s.commit, 64))
    errors.push("source: {repo, commit} 필요 (근거를 확인한 원본 커밋)");

  const comps = new Map();
  if (!Array.isArray(model.components) || model.components.length === 0)
    errors.push("components: 1개 이상 필요");
  else
    model.components.forEach((c, i) => {
      const w = `components[${i}]`;
      if (!isObj(c)) return errors.push(`${w}: 객체여야 합니다`);
      if (!ID.test(c.id ?? "")) errors.push(`${w}.id: 소문자-하이픈 id`);
      else if (comps.has(c.id)) errors.push(`${w}.id: 중복 ${c.id}`);
      else comps.set(c.id, c);
      if (!KINDS.includes(c.kind)) errors.push(`${w}.kind: ${KINDS.join("|")}`);
      if (!isStr(c.label, 60)) errors.push(`${w}.label: 1~60자`);
      if (!isStr(c.detail, 400)) errors.push(`${w}.detail: 1~400자`);
      for (const k of ["lane", "row"])
        if (c[k] !== undefined && !(Number.isInteger(c[k]) && c[k] >= 0 && c[k] <= 9))
          errors.push(`${w}.${k}: 0~9 정수`);
      checkEvidence(c.evidence, w, errors);
      checkComponentDetail(c, w, errors, comps);
    });
  // `connects` may point at a component declared later: check after all are known
  (model.components ?? []).forEach((c, i) => (isObj(c) && Array.isArray(c.parts) ? c.parts : []).forEach((pt, j) => {
    if (isObj(pt) && pt.connects !== undefined && (!comps.has(pt.connects) || pt.connects === c.id))
      errors.push(`components[${i}].parts[${j}].connects: 다른 선언된 컴포넌트 id`);
  }));

  const links = new Set();
  if (!Array.isArray(model.links) || model.links.length === 0)
    errors.push("links: 1개 이상 필요");
  else
    model.links.forEach((l, i) => {
      const w = `links[${i}]`;
      if (!isObj(l)) return errors.push(`${w}: 객체여야 합니다`);
      if (!comps.has(l.a) || !comps.has(l.b) || l.a === l.b)
        return errors.push(`${w}: a/b 는 서로 다른 선언된 컴포넌트여야 합니다`);
      const k = linkKey(l.a, l.b);
      if (links.has(k)) errors.push(`${w}: 같은 쌍의 연결이 중복됩니다 (${k})`);
      links.add(k);
      if (!isStr(l.label, 80)) errors.push(`${w}.label: 1~80자`);
      checkEvidence(l.evidence, w, errors);
    });

  const ucIds = new Set();
  if (!Array.isArray(model.useCases) || model.useCases.length === 0)
    errors.push("useCases: 1개 이상 필요");
  else
    model.useCases.forEach((u, i) => {
      const w = `useCases[${i}]`;
      if (!isObj(u)) return errors.push(`${w}: 객체여야 합니다`);
      if (!ID.test(u.id ?? "")) errors.push(`${w}.id: 소문자-하이픈 id`);
      else if (ucIds.has(u.id)) errors.push(`${w}.id: 중복 ${u.id}`);
      else ucIds.add(u.id);
      if (!isStr(u.title, 80)) errors.push(`${w}.title`);
      if (!isStr(u.summary, 400)) errors.push(`${w}.summary`);
      if (!isStr(u.trigger, 200)) errors.push(`${w}.trigger (예: GET /api/...)`);
      if (!Array.isArray(u.steps) || u.steps.length === 0)
        return errors.push(`${w}.steps: 1개 이상 필요`);
      const stepIds = new Set();
      u.steps.forEach((st, j) => {
        const sw = `${w}.steps[${j}]`;
        if (!isObj(st)) return errors.push(`${sw}: 객체여야 합니다`);
        if (!ID.test(st.id ?? "")) errors.push(`${sw}.id: 소문자-하이픈 id`);
        else if (stepIds.has(st.id)) errors.push(`${sw}.id: 중복 ${st.id}`);
        else stepIds.add(st.id);
        if (!STEP_KINDS.includes(st.kind))
          errors.push(`${sw}.kind: ${STEP_KINDS.join("|")}`);
        if (!isStr(st.label, 60)) errors.push(`${sw}.label: 1~60자`);
        if (!isStr(st.narration, 500)) errors.push(`${sw}.narration: 사람이 읽는 문장 1~500자`);
        if (st.kind === "request" || st.kind === "call")
          if (!isStr(st.request, 300)) errors.push(`${sw}.request: 요청 요약 필요`);
        if (st.kind === "response" || st.kind === "call")
          if (!isStr(st.response, 300)) errors.push(`${sw}.response: 응답 요약 필요`);
        if (!comps.has(st.from) || !comps.has(st.to)) {
          errors.push(`${sw}: from/to 는 선언된 컴포넌트여야 합니다`);
        } else if (st.kind === "internal") {
          if (st.from !== st.to || st.via !== undefined)
            errors.push(`${sw}: internal 단계는 from==to, via 없음`);
        } else {
          if (st.via !== undefined && !(Array.isArray(st.via) && st.via.every((v) => comps.has(v))))
            errors.push(`${sw}.via: 선언된 컴포넌트 id 배열`);
          else {
            const path = stepPath(st);
            for (let k = 0; k + 1 < path.length; k++)
              if (!links.has(linkKey(path[k], path[k + 1])))
                errors.push(`${sw}: ${path[k]}→${path[k + 1]} 연결(links)이 선언되지 않았습니다`);
          }
        }
        checkEvidence(st.evidence, sw, errors);
        checkStepDetail(st, sw, errors, comps, links);
      });
    });
  // unfilled template placeholders: say exactly where to write
  (function walk(v, path) {
    if (typeof v === "string") {
      if (/^TODO\b/.test(v)) errors.push(`${path}: 채워 주세요 → ${v.split("\n")[0]}`);
      if (SECRET.test(v)) errors.push(`${path}: 비밀값처럼 보이는 문자열 — 키·토큰·비밀번호는 어떤 형태로도 모델에 넣지 마세요 (인증은 방식 이름만)`);
    }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (isObj(v)) for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
  })(model, "model");
  return errors;
}

function checkNamed(list, where, errors, max, item) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length === 0 || list.length > max) { errors.push(`${where}: 1~${max}개 배열`); return []; }
  return list.map((x, i) => { if (!isObj(x)) { errors.push(`${where}[${i}]: 객체여야 합니다`); return null; } item(x, `${where}[${i}]`); return x; }).filter(Boolean);
}
function noExtra(o, keys, w, errors) { for (const k of Object.keys(o)) if (!keys.includes(k)) errors.push(`${w}: 알 수 없는 키 ${k}`); }

/** parts + wires (inside a client/gateway/service), tables (datastore), endpoints (external) */
function checkComponentDetail(c, w, errors) {
  const parts = new Set();
  if (c.parts !== undefined && !["client", "gateway", "service"].includes(c.kind)) errors.push(`${w}.parts: client|gateway|service 에만 둡니다`);
  checkNamed(c.parts, `${w}.parts`, errors, 40, (pt, pw) => {
    noExtra(pt, ["id", "label", "role", "detail", "connects", "evidence"], pw, errors);
    if (!ID.test(pt.id ?? "")) errors.push(`${pw}.id: 소문자-하이픈 id`);
    else if (parts.has(pt.id)) errors.push(`${pw}.id: 중복 ${pt.id}`);
    else parts.add(pt.id);
    if (!isStr(pt.label, 60)) errors.push(`${pw}.label: 1~60자`);
    if (!PART_ROLES.includes(pt.role)) errors.push(`${pw}.role: ${PART_ROLES.join("|")}`);
    if (!isStr(pt.detail, 300)) errors.push(`${pw}.detail: 1~300자`);
    checkEvidence(pt.evidence, pw, errors);
  });
  const wires = new Set();
  if (c.wires !== undefined && c.parts === undefined) errors.push(`${w}.wires: parts 가 먼저 필요합니다`);
  checkNamed(c.wires, `${w}.wires`, errors, 80, (wi, ww) => {
    noExtra(wi, ["from", "to", "label", "evidence"], ww, errors);
    if (!parts.has(wi.from) || !parts.has(wi.to) || wi.from === wi.to) errors.push(`${ww}: from/to 는 이 컴포넌트의 서로 다른 parts id`);
    const k = linkKey(wi.from ?? "", wi.to ?? "");
    if (wires.has(k)) errors.push(`${ww}: 같은 쌍의 배선이 중복됩니다 (${k})`);
    wires.add(k);
    if (!isStr(wi.label, 80)) errors.push(`${ww}.label: 1~80자 (무엇이 오가는지)`);
    checkEvidence(wi.evidence, ww, errors);
  });
  if (c.tables !== undefined && c.kind !== "datastore") errors.push(`${w}.tables: datastore 에만 둡니다`);
  const tnames = new Set();
  checkNamed(c.tables, `${w}.tables`, errors, 60, (t, tw) => {
    noExtra(t, ["name", "detail", "columns", "evidence"], tw, errors);
    if (!TABLE.test(t.name ?? "")) errors.push(`${tw}.name: 테이블 이름 (영문·숫자·_ .)`);
    else if (tnames.has(t.name)) errors.push(`${tw}.name: 중복 ${t.name}`);
    else tnames.add(t.name);
    if (!isStr(t.detail, 300)) errors.push(`${tw}.detail: 1~300자`);
    const cols = new Set();
    checkNamed(t.columns, `${tw}.columns`, errors, 80, (col, cw) => {
      noExtra(col, ["name", "type", "note"], cw, errors);
      if (!COLUMN.test(col.name ?? "")) errors.push(`${cw}.name: 컬럼 이름`);
      else if (cols.has(col.name)) errors.push(`${cw}.name: 중복 ${col.name}`);
      else cols.add(col.name);
      if (col.type !== undefined && !isStr(col.type, 40)) errors.push(`${cw}.type: 1~40자`);
      if (col.note !== undefined && !isStr(col.note, 120)) errors.push(`${cw}.note: 1~120자`);
    });
    if (t.columns === undefined) errors.push(`${tw}.columns: 1개 이상 필요`);
    checkEvidence(t.evidence, tw, errors);
  });
  if (c.endpoints !== undefined && c.kind !== "external") errors.push(`${w}.endpoints: external 에만 둡니다`);
  const eids = new Set();
  checkNamed(c.endpoints, `${w}.endpoints`, errors, 40, (ep, ew) => {
    noExtra(ep, ["id", "method", "path", "auth", "detail", "request", "response", "evidence"], ew, errors);
    if (!ID.test(ep.id ?? "")) errors.push(`${ew}.id: 소문자-하이픈 id`);
    else if (eids.has(ep.id)) errors.push(`${ew}.id: 중복 ${ep.id}`);
    else eids.add(ep.id);
    if (!METHODS.includes(ep.method)) errors.push(`${ew}.method: ${METHODS.join("|")}`);
    if (!isStr(ep.path, 200)) errors.push(`${ew}.path: 1~200자 (예: /v1/embeddings)`);
    if (ep.auth !== undefined && !isStr(ep.auth, 60)) errors.push(`${ew}.auth: 인증 방식 이름 1~60자 (값은 쓰지 않음)`);
    if (!isStr(ep.detail, 300)) errors.push(`${ew}.detail: 1~300자`);
    for (const side of ["request", "response"])
      checkNamed(ep[side], `${ew}.${side}`, errors, 30, (f, fw) => {
        noExtra(f, ["name", "note"], fw, errors);
        if (!isStr(f.name, 60)) errors.push(`${fw}.name: 필드 이름 1~60자`);
        if (f.note !== undefined && !isStr(f.note, 120)) errors.push(`${fw}.note: 1~120자`);
      });
    checkEvidence(ep.evidence, ew, errors);
  });
}

function checkPersonal(v, w, errors) {
  for (const [re, what] of PERSONAL) if (re.test(v)) errors.push(`${w}: ${what}처럼 보이는 값 — 실제 데이터 대신 형식 자리표시(<uuid>, <text>, <email>)를 쓰세요`);
}
/** step.payload: the concrete shape that travels (JSON, HTTP, SQL + bindings, a row), with placeholders */
function checkPayload(st, sw, errors) {
  if (st.payload === undefined) return;
  const legs = st.kind === "call" ? ["request", "response"] : st.kind === "request" ? ["request"] : st.kind === "response" ? ["response"] : [];
  if (!legs.length) return errors.push(`${sw}.payload: internal 단계에는 둘 수 없습니다 (오가는 데이터가 없음)`);
  checkNamed(st.payload, `${sw}.payload`, errors, 6, (x, w) => {
    noExtra(x, ["leg", "format", "title", "body", "bind", "columns", "evidence"], w, errors);
    if (!legs.includes(x.leg)) errors.push(`${w}.leg: ${legs.join("|")} (이 단계의 종류 ${st.kind})`);
    if (!PAYLOAD_FORMATS.includes(x.format)) errors.push(`${w}.format: ${PAYLOAD_FORMATS.join("|")}`);
    if (x.title !== undefined && !isStr(x.title, 80)) errors.push(`${w}.title: 1~80자`);
    if (x.body !== undefined) {
      if (!isStr(x.body, 2000)) errors.push(`${w}.body: 1~2000자`);
      else { if (x.body.split("\n").length > 40) errors.push(`${w}.body: 40줄 이하`); checkPersonal(x.body, `${w}.body`, errors); }
    }
    for (const k of ["bind", "columns"]) checkNamed(x[k], `${w}.${k}`, errors, 30, (b, bw) => {
      noExtra(b, ["name", "value"], bw, errors);
      if (!isStr(b.name, 60)) errors.push(`${bw}.name: 1~60자`);
      if (!isStr(b.value, 120)) errors.push(`${bw}.value: 1~120자 (형식 자리표시)`);
      else checkPersonal(b.value, `${bw}.value`, errors);
    });
    if (x.body === undefined && x.bind === undefined && x.columns === undefined) errors.push(`${w}: body, bind, columns 중 하나는 필요합니다`);
    checkEvidence(x.evidence, w, errors);
  });
}
/** step.transforms: how the data changes at a part on this step's trace (input shape -> output shape, field map) */
function checkTransforms(st, sw, errors) {
  if (st.transforms === undefined) return;
  if (!Array.isArray(st.trace)) return errors.push(`${sw}.transforms: trace 가 먼저 필요합니다`);
  const shape = (o, w) => {
    if (!isObj(o)) return errors.push(`${w}: {type, fields?} 객체`);
    noExtra(o, ["type", "fields"], w, errors);
    if (!isStr(o.type, 60)) errors.push(`${w}.type: 1~60자 (구조체·형식 이름)`);
    if (o.fields !== undefined) {
      if (!Array.isArray(o.fields) || o.fields.length === 0 || o.fields.length > 16 || o.fields.some((f) => !isStr(f, 80))) errors.push(`${w}.fields: 1~16개, 각 1~80자`);
    }
  };
  checkNamed(st.transforms, `${sw}.transforms`, errors, 12, (t, w) => {
    noExtra(t, ["at", "in", "out", "map", "evidence"], w, errors);
    if (!st.trace.includes(t.at)) errors.push(`${w}.at: 이 단계의 trace 에 있는 "컴포넌트/파트" (${t.at})`);
    shape(t.in, `${w}.in`); shape(t.out, `${w}.out`);
    checkNamed(t.map, `${w}.map`, errors, 16, (m, mw) => {
      noExtra(m, ["from", "to", "how"], mw, errors);
      if (!isStr(m.from, 60) || !isStr(m.to, 60)) errors.push(`${mw}: from/to 1~60자`);
      if (m.how !== undefined && !isStr(m.how, 80)) errors.push(`${mw}.how: 1~80자`);
    });
    checkEvidence(t.evidence, w, errors);
  });
}

/** step.trace (parts it passes), step.data (table access), step.endpoints (external endpoints it calls) */
function checkStepDetail(st, sw, errors, comps, links) {
  checkPayload(st, sw, errors);
  checkTransforms(st, sw, errors);
  const path = new Set(stepPath(st));
  const part = (ref) => {
    const [cid, pid] = String(ref).split("/");
    const c = comps.get(cid);
    return c && Array.isArray(c.parts) ? { c, p: c.parts.find((x) => isObj(x) && x.id === pid) } : null;
  };
  if (st.trace !== undefined) {
    if (!Array.isArray(st.trace) || st.trace.length === 0 || st.trace.length > 20) errors.push(`${sw}.trace: 1~20개 "컴포넌트/파트" 배열`);
    else {
      const refs = st.trace.map((r, i) => {
        const x = part(r);
        if (!x || !x.p) { errors.push(`${sw}.trace[${i}]: 선언된 "컴포넌트/파트" 가 아닙니다 (${r})`); return null; }
        if (!path.has(x.c.id)) errors.push(`${sw}.trace[${i}]: ${x.c.id} 는 이 단계가 지나는 컴포넌트가 아닙니다`);
        return { c: x.c, p: x.p };
      });
      for (let i = 0; i + 1 < refs.length; i++) {
        const a = refs[i], b = refs[i + 1];
        if (!a || !b) continue;
        if (a.c.id === b.c.id) {
          const ok = (a.c.wires ?? []).some((w) => isObj(w) && linkKey(w.from, w.to) === linkKey(a.p.id, b.p.id));
          if (!ok && a.p.id !== b.p.id) errors.push(`${sw}.trace: ${a.c.id}/${a.p.id}→${b.p.id} 배선(wires)이 선언되지 않았습니다`);
        } else if (!links.has(linkKey(a.c.id, b.c.id))) errors.push(`${sw}.trace: ${a.c.id}→${b.c.id} 연결이 없습니다`);
      }
    }
  }
  if (st.data !== undefined) {
    checkNamed(st.data, `${sw}.data`, errors, 12, (d, dw) => {
      noExtra(d, ["store", "table", "op", "columns", "evidence"], dw, errors);
      const c = comps.get(d.store);
      if (!c || c.kind !== "datastore") return errors.push(`${dw}.store: datastore 컴포넌트 id`);
      if (!path.has(d.store)) errors.push(`${dw}.store: 이 단계가 지나는 저장소가 아닙니다`);
      const t = (c.tables ?? []).find((x) => isObj(x) && x.name === d.table);
      if (!t) return errors.push(`${dw}.table: ${d.store}.tables 에 선언된 테이블 (${d.table})`);
      if (!DATA_OPS.includes(d.op)) errors.push(`${dw}.op: ${DATA_OPS.join("|")}`);
      if (d.columns !== undefined) {
        if (!Array.isArray(d.columns) || d.columns.length === 0) errors.push(`${dw}.columns: 컬럼 이름 배열`);
        else for (const col of d.columns) if (!(t.columns ?? []).some((x) => isObj(x) && x.name === col)) errors.push(`${dw}.columns: ${d.table} 에 선언되지 않은 컬럼 ${col}`);
      }
      checkEvidence(d.evidence, dw, errors);
    });
  }
  if (st.endpoints !== undefined) {
    if (!Array.isArray(st.endpoints) || st.endpoints.length === 0 || st.endpoints.length > 6) errors.push(`${sw}.endpoints: 1~6개 "컴포넌트/엔드포인트" 배열`);
    else st.endpoints.forEach((r, i) => {
      const [cid, eid] = String(r).split("/");
      const c = comps.get(cid);
      if (!c || !(c.endpoints ?? []).some((x) => isObj(x) && x.id === eid)) errors.push(`${sw}.endpoints[${i}]: 선언된 "컴포넌트/엔드포인트" 가 아닙니다 (${r})`);
      else if (!path.has(cid)) errors.push(`${sw}.endpoints[${i}]: ${cid} 는 이 단계가 지나는 컴포넌트가 아닙니다`);
    });
  }
}

export function validateChanges(changes, model) {
  const errors = [];
  if (changes === null || changes === undefined) return errors;
  if (!isObj(changes)) return ["changes: 객체여야 합니다"];
  if (!isStr(changes.title, 120)) errors.push("changes.title: 1~120자");
  if (!isStr(changes.summary, 600)) errors.push("changes.summary: 1~600자");
  if (!isStr(changes.ref, 200)) errors.push("changes.ref: 변경 출처 (PR/커밋)");
  const comps = new Set((model.components ?? []).map((c) => c.id));
  const steps = new Map();
  for (const u of model.useCases ?? [])
    for (const s of u.steps ?? []) steps.set(`${u.id}/${s.id}`, true);
  const seenC = new Set();
  if (!Array.isArray(changes.components)) errors.push("changes.components: 배열 필요");
  else
    changes.components.forEach((c, i) => {
      const w = `changes.components[${i}]`;
      if (!isObj(c) || !comps.has(c.id)) return errors.push(`${w}.id: 모델에 없는 컴포넌트`);
      if (seenC.has(c.id)) errors.push(`${w}.id: 중복 ${c.id}`);
      seenC.add(c.id);
      if (!CHANGE_KINDS.includes(c.change)) errors.push(`${w}.change: ${CHANGE_KINDS.join("|")}`);
      if (!isStr(c.note, 300)) errors.push(`${w}.note: 1~300자`);
    });
  const seenS = new Set();
  if (changes.steps !== undefined) {
    if (!Array.isArray(changes.steps)) errors.push("changes.steps: 배열이어야 합니다");
    else
      changes.steps.forEach((c, i) => {
        const w = `changes.steps[${i}]`;
        const key = isObj(c) ? `${c.useCase}/${c.step}` : "";
        if (!steps.has(key)) return errors.push(`${w}: 모델에 없는 useCase/step (${key})`);
        if (seenS.has(key)) errors.push(`${w}: 중복 ${key}`);
        seenS.add(key);
        if (!CHANGE_KINDS.includes(c.change)) errors.push(`${w}.change: ${CHANGE_KINDS.join("|")}`);
        if (!isStr(c.note, 300)) errors.push(`${w}.note: 1~300자`);
      });
  }
  // optional, produced by `nacholens diff`
  if (changes.unmapped !== undefined) {
    if (!Array.isArray(changes.unmapped) || changes.unmapped.length > 500) errors.push("changes.unmapped: 배열(최대 500)");
    else
      changes.unmapped.forEach((u, i) => {
        if (!isObj(u) || !isStr(u.file, 300) || !isStr(u.status, 20) || !isStr(u.lines, 300) || !isStr(u.hint, 400) ||
            (u.category !== undefined && !["code", "style", "config"].includes(u.category)))
          errors.push(`changes.unmapped[${i}]: {file,status,lines,hint,category?(code|style|config)} 필요`);
      });
  }
  if (changes.details !== undefined) {
    const known = new Set();
    for (const c of model.components ?? []) {
      for (const p of c.parts ?? []) known.add(`${c.id}|part|${p.id}`);
      for (const w of c.wires ?? []) known.add(`${c.id}|wire|${w.from}>${w.to}`);
      for (const t of c.tables ?? []) known.add(`${c.id}|table|${t.name}`);
      for (const e of c.endpoints ?? []) known.add(`${c.id}|endpoint|${e.id}`);
    }
    if (!Array.isArray(changes.details) || changes.details.length > 500) errors.push("changes.details: 배열(최대 500)");
    else changes.details.forEach((d, i) => {
      const w = `changes.details[${i}]`;
      if (!isObj(d) || !known.has(`${d.component}|${d.kind}|${d.id}`)) return errors.push(`${w}: 모델에 없는 상세 항목 (${isObj(d) ? `${d.component}/${d.kind}/${d.id}` : "?"})`);
      if (!CHANGE_KINDS.includes(d.change)) errors.push(`${w}.change: ${CHANGE_KINDS.join("|")}`);
      if (!isStr(d.note, 300)) errors.push(`${w}.note: 1~300자`);
    });
  }
  if (changes.ignored !== undefined) {
    if (!Array.isArray(changes.ignored) || changes.ignored.length > 2000) errors.push("changes.ignored: 배열(최대 2000)");
    else
      changes.ignored.forEach((u, i) => {
        if (!isObj(u) || !isStr(u.file, 300) || !isStr(u.reason, 40)) errors.push(`changes.ignored[${i}]: {file,reason} 필요`);
      });
  }
  return errors;
}
