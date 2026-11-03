// Review layer: three read-only views derived from the model + change overlay.
//   compare  (A3) before/after rows per use case
//   intent   (C1) planner expectations checked against the model (met | unmet | unknown)
//   impact   (C5) which other use cases a change can break, and whether tests mention them
// Everything here is a pure function of its inputs (model, changes, intent, test files). Nothing is
// guessed: an expectation without a mechanical check is `unknown`, an untestable claim stays that way.
import { ignoreReason, COMPONENT_NOTE } from "./diff.js";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v, max = 400) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const stepKey = (u, s) => `${u}/${s}`;
const pathOf = (st) => [st.from, ...(st.via ?? []), st.to];
const evText = (st) => (st.evidence ?? []).slice(0, 2).map((e) => `${e.file}:${e.lines[0]}${e.lines[1] !== e.lines[0] ? "-" + e.lines[1] : ""}`).join(", ");

/** ordered, consecutive-deduplicated list of the components a use case visits */
export function usePath(model, uc) {
  const out = [];
  for (const st of uc.steps) for (const c of pathOf(st)) if (out[out.length - 1] !== c) out.push(c);
  return out;
}

// ───────────────────────────── A3: before / after ─────────────────────────────

const FLOW_FIELDS = ["kind", "from", "to", "label", "request", "response"];
const flowSig = (st) => FLOW_FIELDS.map((k) => st[k] ?? "").join("\u0001") + "\u0001" + (st.via ?? []).join(",");
const cell = (m, st) => ({
  label: st.label, kind: st.kind, route: pathOf(st).map((c) => (m.components.find((x) => x.id === c)?.label ?? c).split("\n")[0]).join(" → "),
  ...(st.request ? { request: st.request } : {}), ...(st.response ? { response: st.response } : {}),
});

/**
 * Rows aligned by step id. With `beforeModel` (a model written against the base commit) the flow itself is
 * compared; without it, the overlay decides: added = nothing before, removed = nothing after, modified = same flow,
 * code changed (the old text is not known, and the row says so).
 */
export function buildCompare(model, changes = null, beforeModel = null) {
  const cs = new Map((changes?.steps ?? []).map((s) => [stepKey(s.useCase, s.step), s]));
  const mode = beforeModel ? "two-models" : "overlay";
  const ids = [...model.useCases.map((u) => u.id), ...(beforeModel?.useCases ?? []).map((u) => u.id).filter((id) => !model.useCases.some((u) => u.id === id))];
  const useCases = ids.map((id) => {
    const a = model.useCases.find((u) => u.id === id), b = beforeModel ? beforeModel.useCases.find((u) => u.id === id) : a;
    const A = a?.steps ?? [], B = b?.steps ?? [];
    const rows = [];
    if (beforeModel) {
      const aIds = new Set(A.map((s) => s.id)), bIds = new Set(B.map((s) => s.id));
      const commonB = B.filter((s) => aIds.has(s.id)).map((s) => s.id), commonA = A.filter((s) => bIds.has(s.id)).map((s) => s.id);
      const orderMoved = new Set(commonA.filter((sid, i) => commonB[i] !== sid));
      for (const sa of A) {
        const sb = B.find((s) => s.id === sa.id);
        const ch = cs.get(stepKey(id, sa.id));
        if (!sb) { rows.push({ id: sa.id, status: "added", before: null, after: cell(model, sa), note: "This step is not in the model before the change." }); continue; }
        const diffs = FLOW_FIELDS.filter((k) => (sa[k] ?? "") !== (sb[k] ?? "")).concat((sa.via ?? []).join(",") !== (sb.via ?? []).join(",") ? ["via"] : []);
        const status = diffs.length ? "modified" : orderMoved.has(sa.id) ? "moved" : ch ? "modified" : "same";
        rows.push({
          id: sa.id, status, before: cell(beforeModel, sb), after: cell(model, sa),
          ...(diffs.length ? { fields: diffs, note: `Changed fields: ${diffs.join(", ")}` } : orderMoved.has(sa.id) ? { note: "The step order changed." } : ch ? { note: ch.note } : {}),
        });
        // removed before-steps are inserted right after their nearest earlier common step
        const idxB = B.findIndex((s) => s.id === sa.id);
        for (let k = idxB + 1; k < B.length && !aIds.has(B[k].id); k++) rows.push({ id: B[k].id, status: "removed", before: cell(beforeModel, B[k]), after: null, note: "This step is not in the model after the change." });
      }
      // before-steps that open the use case, before any common step
      const lead = [];
      for (let k = 0; k < B.length && !aIds.has(B[k].id); k++) lead.push({ id: B[k].id, status: "removed", before: cell(beforeModel, B[k]), after: null, note: "This step is not in the model after the change." });
      rows.unshift(...lead);
    } else {
      for (const st of A) {
        const ch = cs.get(stepKey(id, st.id));
        if (!ch) rows.push({ id: st.id, status: "same", before: cell(model, st), after: cell(model, st) });
        else if (ch.change === "added") rows.push({ id: st.id, status: "added", before: null, after: cell(model, st), note: ch.note });
        else if (ch.change === "removed") rows.push({ id: st.id, status: "removed", before: cell(model, st), after: null, note: ch.note });
        else rows.push({ id: st.id, status: "modified", before: cell(model, st), after: cell(model, st), note: `${ch.note} (the model has no earlier version, so the flow is shown unchanged)`, codeOnly: true });
      }
    }
    // overlay mode: the "before" path is the after path without the steps this work added
    let pathBefore, pathAfter = a ? usePath(model, a) : [];
    if (beforeModel) pathBefore = b ? usePath(beforeModel, b) : [];
    else pathBefore = a ? usePath(model, { ...a, steps: a.steps.filter((s) => cs.get(stepKey(id, s.id))?.change !== "added") }) : [];
    const changed = rows.filter((r) => r.status !== "same").length;
    return {
      id, title: (a ?? b).title, trigger: (a ?? b).trigger, state: !a ? "removed" : !b ? "added" : changed ? "changed" : "same",
      pathBefore, pathAfter,
      pathLabels: Object.fromEntries([...model.components, ...(beforeModel?.components ?? [])].map((c) => [c.id, c.label.split("\n")[0]])),
      rows, changedRows: changed,
    };
  });
  const sum = (st) => useCases.reduce((n, u) => n + u.rows.filter((r) => r.status === st).length, 0);
  return { mode, useCases, summary: { useCases: useCases.filter((u) => u.state !== "same").length, added: sum("added"), removed: sum("removed"), modified: sum("modified"), moved: sum("moved") } };
}

// ───────────────────────────── C1: intent check ─────────────────────────────

const CHECKS = ["step", "absent", "order"];
const MATCH_KEYS = ["kind", "from", "to", "with", "table", "op", "text"];

/** a matcher is a plain object; `text` is a list of alternatives joined by | (case-insensitive substring, no regex) */
function validateMatcher(m, w, errors, model) {
  if (!isObj(m)) return errors.push(`${w}: must be an object with at least one of kind/from/to/with/table/op/text`);
  for (const k of Object.keys(m)) if (!MATCH_KEYS.includes(k)) errors.push(`${w}.${k}: unknown condition (${MATCH_KEYS.join("|")})`);
  if (!MATCH_KEYS.some((k) => m[k] !== undefined)) errors.push(`${w}: has no condition`);
  if (m.kind !== undefined && !["request", "response", "call", "internal"].includes(m.kind)) errors.push(`${w}.kind: request|response|call|internal`);
  for (const k of ["from", "to", "with"]) if (m[k] !== undefined && !model.components.some((c) => c.id === m[k])) errors.push(`${w}.${k}: component not in the model (${m[k]})`);
  if (m.op !== undefined && !["read", "insert", "update", "upsert", "delete"].includes(m.op)) errors.push(`${w}.op: read|insert|update|upsert|delete`);
  if (m.table !== undefined && !isStr(m.table, 80)) errors.push(`${w}.table: 1-80 characters`);
  if (m.text !== undefined && !isStr(m.text, 120)) errors.push(`${w}.text: 1-120 characters (separate alternatives with |)`);
}

export function validateIntent(intent, model) {
  const errors = [];
  if (!isObj(intent)) return ["intent: must be an object"];
  if (intent.schemaVersion !== 1) errors.push("intent.schemaVersion: 1");
  if (!isStr(intent.title, 160)) errors.push("intent.title: 1-160 characters (what the work set out to build)");
  if (intent.source !== undefined && !isStr(intent.source, 300)) errors.push("intent.source: 1-300 characters (where the plan lives)");
  if (!Array.isArray(intent.expectations) || intent.expectations.length === 0 || intent.expectations.length > 60) return [...errors, "intent.expectations: an array of 1-60 items"];
  const seen = new Set();
  intent.expectations.forEach((e, i) => {
    const w = `intent.expectations[${i}]`;
    if (!isObj(e)) return errors.push(`${w}: must be an object`);
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(e.id ?? "")) errors.push(`${w}.id: lowercase letters, digits and - (1-41 characters)`);
    else if (seen.has(e.id)) errors.push(`${w}.id: duplicate ${e.id}`);
    seen.add(e.id);
    if (!isStr(e.text, 300)) errors.push(`${w}.text: 1-300 characters (the planner's own words)`);
    if (e.useCase !== undefined && !model.useCases.some((u) => u.id === e.useCase)) errors.push(`${w}.useCase: use case not in the model (${e.useCase})`);
    if (e.check === undefined) return; // allowed: stays `unknown`
    const c = e.check;
    if (!isObj(c) || !CHECKS.includes(c.type)) return errors.push(`${w}.check.type: ${CHECKS.join("|")}`);
    if (e.useCase === undefined) errors.push(`${w}.useCase: required when check is given`);
    if (c.type === "order") {
      for (const k of Object.keys(c)) if (!["type", "first", "then"].includes(k)) errors.push(`${w}.check.${k}: unknown field`);
      validateMatcher(c.first, `${w}.check.first`, errors, model); validateMatcher(c.then, `${w}.check.then`, errors, model);
    } else {
      for (const k of Object.keys(c)) if (!["type", "match"].includes(k)) errors.push(`${w}.check.${k}: unknown field`);
      validateMatcher(c.match, `${w}.check.match`, errors, model);
    }
  });
  return errors;
}

function stepMatches(model, st, m) {
  if (m.kind !== undefined && st.kind !== m.kind) return false;
  if (m.from !== undefined && st.from !== m.from) return false;
  if (m.to !== undefined && st.to !== m.to) return false;
  if (m.with !== undefined && !pathOf(st).includes(m.with)) return false;
  if (m.table !== undefined || m.op !== undefined) {
    const hit = (st.data ?? []).some((d) => (m.table === undefined || d.table === m.table) && (m.op === undefined || d.op === m.op));
    if (!hit) return false;
  }
  if (m.text !== undefined) {
    const hay = [st.label, st.narration, st.request, st.response, ...(st.data ?? []).map((d) => `${d.table} ${(d.columns ?? []).join(" ")}`)].filter(Boolean).join(" ").toLowerCase();
    if (!m.text.toLowerCase().split("|").map((t) => t.trim()).filter(Boolean).some((t) => hay.includes(t))) return false;
  }
  return true;
}

/**
 * Status per expectation: met (the model shows it, with the steps as proof), unmet (the use case exists but the
 * model shows no such step / the opposite), unknown (no mechanical check, or nothing to compare).
 * `touched` marks expectations whose proof steps were changed by this work, so the planner re-reads them.
 * `uncovered` = changed steps that no expectation points at (candidates for scope drift; a human decides).
 */
export function checkIntent(model, intent, changes = null) {
  const cs = new Map((changes?.steps ?? []).map((s) => [stepKey(s.useCase, s.step), s]));
  const proofOf = (uc, st) => ({ useCase: uc.id, step: st.id, label: st.label, evidence: evText(st), change: cs.get(stepKey(uc.id, st.id))?.change ?? null });
  const results = intent.expectations.map((e) => {
    const base = { id: e.id, text: e.text, ...(e.useCase ? { useCase: e.useCase } : {}) };
    if (!e.check) return { ...base, status: "unknown", reason: "No automatic check. Add a check that names the model step that proves it, or have a person confirm it.", proof: [] };
    const uc = model.useCases.find((u) => u.id === e.useCase);
    const find = (m) => uc.steps.filter((s) => stepMatches(model, s, m));
    let status, reason, proof = [];
    if (e.check.type === "step") {
      const hit = find(e.check.match);
      status = hit.length ? "met" : "unmet"; proof = hit.map((s) => proofOf(uc, s));
      reason = hit.length ? `${hit.length} matching ${hit.length === 1 ? "step" : "steps"}.` : "No step of this use case matches.";
    } else if (e.check.type === "absent") {
      const hit = find(e.check.match);
      status = hit.length ? "unmet" : "met"; proof = hit.map((s) => proofOf(uc, s));
      reason = hit.length ? "A step that should not exist is there." : "No step matches (as intended).";
    } else {
      const f = find(e.check.first), t = find(e.check.then);
      const idx = (s) => uc.steps.indexOf(s);
      if (!f.length || !t.length) {
        status = "unmet"; proof = [...f, ...t].map((s) => proofOf(uc, s));
        reason = `This use case has no ${!f.length ? "step that should come first" : "step that should come later"}.`;
      } else if (f.some((a) => t.every((b) => idx(a) < idx(b)))) {
        status = "met"; proof = [...f, ...t].map((s) => proofOf(uc, s)); reason = "The step that should come first comes before the later one.";
      } else {
        status = "unmet"; proof = [...f, ...t].map((s) => proofOf(uc, s)); reason = "The order is reversed, or the earlier step is missing.";
      }
    }
    return { ...base, status, reason, proof, touched: proof.some((p) => p.change) };
  });
  const referenced = new Set(results.flatMap((r) => r.proof.map((p) => stepKey(p.useCase, p.step))));
  // an expectation also claims its whole use case's changed steps when it has no check but names the use case
  for (const e of intent.expectations) if (e.useCase && !e.check) for (const s of changes?.steps ?? []) if (s.useCase === e.useCase) referenced.add(stepKey(s.useCase, s.step));
  const stepOf = (k) => { const [u, s] = k.split("/"); const uc = model.useCases.find((x) => x.id === u); return { uc, st: uc?.steps.find((x) => x.id === s) }; };
  const uncovered = (changes?.steps ?? []).filter((s) => !referenced.has(stepKey(s.useCase, s.step))).map((s) => {
    const { uc, st } = stepOf(stepKey(s.useCase, s.step));
    return { useCase: s.useCase, step: s.step, label: st?.label ?? s.step, useCaseTitle: uc?.title ?? s.useCase, change: s.change, evidence: st ? evText(st) : "" };
  });
  const count = (k) => results.filter((r) => r.status === k).length;
  return { title: intent.title, source: intent.source ?? null, results, uncovered, summary: { total: results.length, met: count("met"), unmet: count("unmet"), unknown: count("unknown"), touched: results.filter((r) => r.touched).length, uncovered: uncovered.length, changedSteps: (changes?.steps ?? []).length } };
}

// ───────────────────────────── C5: regression map ─────────────────────────────

/**
 * Other use cases that share something the change touched:
 *  - table   a changed step reads/writes a table another use case also uses
 *  - endpoint / part / wire   a changed detail item (own evidence changed) that a step of another use case passes
 *  - component   a component whose own evidence (start-up/config) changed and the use case passes through it
 * `direct` = the use case holds a changed step itself. Components that are merely endpoints of a changed step
 * are NOT used as a link (every use case passes the API: that would flag everything).
 */
export function buildImpact(model, changes = null, tests = null) {
  const csteps = changes?.steps ?? [];
  const changedKeys = new Set(csteps.map((s) => stepKey(s.useCase, s.step)));
  const info = new Map(model.useCases.map((u) => [u.id, { direct: [], reasons: [] }]));
  const stepOf = (uid, sid) => model.useCases.find((u) => u.id === uid)?.steps.find((s) => s.id === sid);
  for (const c of csteps) info.get(c.useCase)?.direct.push({ step: c.step, change: c.change, label: stepOf(c.useCase, c.step)?.label ?? c.step });

  // what the changed steps touch
  const touchedTables = new Map(), touchedEndpoints = new Map();
  for (const c of csteps) {
    const st = stepOf(c.useCase, c.step);
    for (const d of st?.data ?? []) touchedTables.set(`${d.store}.${d.table}`, [...(touchedTables.get(`${d.store}.${d.table}`) ?? []), { useCase: c.useCase, step: c.step, op: d.op }]);
    for (const e of st?.endpoints ?? []) touchedEndpoints.set(e, [...(touchedEndpoints.get(e) ?? []), { useCase: c.useCase, step: c.step }]);
  }
  const detailHits = new Map((changes?.details ?? []).map((d) => [`${d.component}|${d.kind}|${d.id}`, d]));
  const strongComps = new Set((changes?.components ?? []).filter((c) => c.note.startsWith(COMPONENT_NOTE)).map((c) => c.id));

  for (const u of model.useCases) {
    const r = info.get(u.id);
    for (const st of u.steps) {
      const here = { useCase: u.id, step: st.id, label: st.label };
      const own = changedKeys.has(stepKey(u.id, st.id)); // a changed step already explains its own parts, wires and endpoints
      for (const d of st.data ?? []) {
        const k = `${d.store}.${d.table}`;
        const src = (touchedTables.get(k) ?? []).filter((x) => x.useCase !== u.id);
        if (src.length) r.reasons.push({ kind: "table", ref: k, ...here, text: `Does ${d.op} on table ${k}, the same table as the changed ${src.map((x) => `${x.useCase}/${x.step} (${x.op})`).join(", ")}.` });
        if (!own && detailHits.has(`${d.store}|table|${d.table}`)) r.reasons.push({ kind: "table", ref: k, ...here, text: `The definition (schema) evidence of table ${k} changed in this work.` });
      }
      for (const e of st.endpoints ?? []) {
        const src = (touchedEndpoints.get(e) ?? []).filter((x) => x.useCase !== u.id);
        if (src.length) r.reasons.push({ kind: "endpoint", ref: e, ...here, text: `Calls the external endpoint ${e}, the same call as the changed ${src.map((x) => `${x.useCase}/${x.step}`).join(", ")}.` });
        const [c, id] = e.split("/");
        if (!own && detailHits.has(`${c}|endpoint|${id}`)) r.reasons.push({ kind: "endpoint", ref: e, ...here, text: `The definition evidence of endpoint ${e} changed in this work.` });
      }
      const trace = st.trace ?? [];
      trace.forEach((p, i) => {
        const [c, id] = p.split("/");
        if (!own && detailHits.has(`${c}|part|${id}`)) r.reasons.push({ kind: "part", ref: p, ...here, text: `Passes the part ${p}, whose evidence code changed in this work.` });
        const nx = trace[i + 1];
        if (!own && nx && nx.split("/")[0] === c && detailHits.has(`${c}|wire|${id}>${nx.split("/")[1]}`)) r.reasons.push({ kind: "wire", ref: `${p}>${nx}`, ...here, text: `Passes the wire ${p} → ${nx}, whose evidence code changed in this work.` });
      });
      for (const c of new Set(pathOf(st))) if (!own && strongComps.has(c)) r.reasons.push({ kind: "component", ref: c, ...here, text: `The component ${c}'s own evidence code (start-up, configuration) changed in this work.` });
    }
  }

  const testFiles = new Set(tests?.changedTests ?? []);
  const items = [];
  for (const u of model.useCases) {
    const r = info.get(u.id);
    // one reason per (kind, ref, step) is enough
    const seen = new Set(), reasons = r.reasons.filter((x) => { const k = `${x.kind}|${x.ref}|${x.step}`; if (seen.has(k)) return false; seen.add(k); return true; });
    if (!r.direct.length && !reasons.length) continue;
    const found = tests?.byUseCase?.[u.id];
    const t = !tests ? { state: "unknown", files: [], note: "The repository was not read, so tests were not looked for." }
      : found?.length ? { state: found.some((f) => testFiles.has(f.file)) ? "covered-changed" : "covered", files: found, note: found.some((f) => testFiles.has(f.file)) ? "A test that mentions this path changed in this work too." : "A test mentions this path, but it did not change in this work." }
      : { state: "none-found", files: [], note: "No test file mentions this path (a guess from path strings: tests that name it differently are missed)." };
    items.push({
      id: u.id, title: u.title, trigger: u.trigger, relation: r.direct.length ? "direct" : "indirect",
      direct: r.direct, reasons, tests: t,
      // what to re-check by hand: the steps that moved, or the steps that share the changed thing
      recheck: [...new Set([...r.direct.map((d) => d.step), ...reasons.map((x) => x.step)])].map((sid) => ({ step: sid, label: stepOf(u.id, sid)?.label ?? sid })),
    });
  }
  const rank = (i) => (i.relation === "direct" ? 0 : 2) + (i.tests.state === "none-found" ? 0 : i.tests.state === "unknown" ? 0 : 1);
  items.sort((a, b) => rank(a) - rank(b));
  const withoutTests = items.filter((i) => i.tests.state === "none-found").length;
  return {
    useCases: items,
    summary: { direct: items.filter((i) => i.relation === "direct").length, indirect: items.filter((i) => i.relation === "indirect").length, withoutTests, changedSteps: changedKeys.size, testsKnown: !!tests },
  };
}

/** `/api/orders` style path tokens in a trigger line ("GET /api/auth/start → provider → GET /api/auth/callback" has two) */
export function triggerPaths(trigger) {
  return [...new Set([...String(trigger ?? "").matchAll(/\/[A-Za-z0-9_\-./{}:]*[A-Za-z0-9_}]/g)].map((m) => m[0]))].filter((p) => p.length > 1);
}

/**
 * Test files that mention a use case's route. `files` = [{path, text}] of test files at head;
 * `changedTests` = test files the diff touched. A path counts at a boundary (`/api/orders` matches `/api/orders/1`
 * and `"/api/orders"`, not `/api/orders-archive`). Route parameters (`:id`, `{id}`) cut the literal at the parameter.
 */
export function discoverTests(model, files, changedTests = []) {
  const byUseCase = {};
  for (const u of model.useCases) {
    const paths = triggerPaths(u.trigger).map((p) => p.split(/\/[:{]/)[0]).filter((p) => p.length > 1);
    const hits = [];
    for (const f of files) {
      const n = paths.filter((p) => { let i = f.text.indexOf(p); while (i >= 0) { const nx = f.text[i + p.length]; if (!nx || !/[A-Za-z0-9_-]/.test(nx)) return true; i = f.text.indexOf(p, i + 1); } return false; });
      if (n.length) hits.push({ file: f.path, paths: n });
    }
    byUseCase[u.id] = hits;
  }
  return { byUseCase, changedTests };
}

export const isTestFile = (path) => ignoreReason(path) === "test" && !/(^|\/)fixtures\//i.test(path);

// ───────────────────────────── bundle ─────────────────────────────

export function buildReview(model, changes, { beforeModel = null, intent = null, tests = null } = {}) {
  const review = {};
  if (changes || beforeModel) review.compare = buildCompare(model, changes, beforeModel);
  if (intent) review.intent = checkIntent(model, intent, changes);
  if (changes) review.impact = buildImpact(model, changes, tests);
  return Object.keys(review).length ? review : null;
}

