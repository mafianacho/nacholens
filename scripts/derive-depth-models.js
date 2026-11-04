// Derives the three depth examples of the demo shop from its one full model:
//   models/demo-shop/model.json        depth "full"   (hand-written source of truth, declares its depth)
//   models/demo-shop/model.brief.json  depth "brief"  (same composition, all drill-down removed)
//   models/demo-shop/model.diff.json   depth "diff"   (only what changes.auto.json touches)
// Run `npm run build:depth-models` after changing model.json or changes.auto.json. A test fails when the
// committed files differ from what these functions produce.
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const clone = (v) => JSON.parse(JSON.stringify(v));
/** `depth` sits right after `schemaVersion` so the file reads top-down: version, depth, product ... */
const withDepth = (model, depth) => { const { schemaVersion, depth: _old, ...rest } = model; return { schemaVersion, depth, ...rest }; };

export function deriveFull(model) { return withDepth(clone(model), "full"); }

export function deriveBrief(model) {
  const m = clone(model);
  for (const c of m.components) for (const k of ["parts", "wires", "tables", "endpoints"]) delete c[k];
  for (const u of m.useCases) for (const s of u.steps) for (const k of ["trace", "data", "endpoints", "payload", "transforms"]) delete s[k];
  return withDepth(m, "brief");
}

export function deriveDiff(model, changes) {
  const m = clone(model);
  const hit = new Set(changes.steps.map((s) => `${s.useCase}/${s.step}`));
  m.useCases = m.useCases
    .map((u) => ({ ...u, steps: u.steps.filter((s) => hit.has(`${u.id}/${s.id}`)) }))
    .filter((u) => u.steps.length);
  const steps = m.useCases.flatMap((u) => u.steps);
  const comps = new Set(), hops = new Set(), parts = new Set(), tables = new Set(), endpoints = new Set();
  const key = (a, b) => [a, b].sort().join("|");
  for (const s of steps) {
    const path = [s.from, ...(s.via ?? []), s.to];
    path.forEach((id) => comps.add(id));
    for (let i = 0; i + 1 < path.length; i++) hops.add(key(path[i], path[i + 1]));
    (s.trace ?? []).forEach((r) => parts.add(r));
    (s.data ?? []).forEach((d) => tables.add(`${d.store}/${d.table}`));
    (s.endpoints ?? []).forEach((r) => endpoints.add(r));
  }
  m.components = m.components.filter((c) => comps.has(c.id));
  m.links = m.links.filter((l) => hops.has(key(l.a, l.b)));
  for (const c of m.components) {
    if (c.parts) {
      c.parts = c.parts.filter((p) => parts.has(`${c.id}/${p.id}`));
      for (const p of c.parts) if (p.connects && !comps.has(p.connects)) delete p.connects;
      const ids = new Set(c.parts.map((p) => p.id));
      if (c.wires) c.wires = c.wires.filter((w) => ids.has(w.from) && ids.has(w.to));
    }
    if (c.tables) c.tables = c.tables.filter((t) => tables.has(`${c.id}/${t.name}`));
    if (c.endpoints) c.endpoints = c.endpoints.filter((e) => endpoints.has(`${c.id}/${e.id}`));
    for (const k of ["parts", "wires", "tables", "endpoints"]) if (c[k] && !c[k].length) delete c[k];
  }
  return withDepth(m, "diff");
}

export const FILES = { full: "model.json", brief: "model.brief.json", diff: "model.diff.json" };
const text = (v) => JSON.stringify(v, null, 2) + "\n";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "models", "demo-shop");

export function derive() {
  const model = JSON.parse(readFileSync(join(dir, FILES.full), "utf8"));
  const changes = JSON.parse(readFileSync(join(dir, "changes.auto.json"), "utf8"));
  return { full: deriveFull(model), brief: deriveBrief(model), diff: deriveDiff(model, changes) };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  for (const [depth, model] of Object.entries(derive())) { writeFileSync(join(dir, FILES[depth]), text(model)); console.log(`models/demo-shop/${FILES[depth]}  (${depth})`); }
}
