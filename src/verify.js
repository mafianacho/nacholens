// Evidence verification: every cited file:lines must exist in a checkout of the source repo,
// and (when `contains` is given) the cited line range must really contain that text.
// This is what keeps the model from drifting into guesses.
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export function collectEvidence(model) {
  const out = [];
  model.components.forEach((c) =>
    c.evidence.forEach((e) => out.push({ where: `component ${c.id}`, e, owner: { type: "component", id: c.id } })),
  );
  model.links.forEach((l) =>
    l.evidence.forEach((e) => out.push({ where: `link ${l.a}-${l.b}`, e, owner: { type: "link", a: l.a, b: l.b } })),
  );
  // optional drill-down detail: parts, wires, tables, endpoints belong to their component (owner "detail")
  model.components.forEach((c) => {
    const d = (kind, id, list, label) => (list ?? []).forEach((e) => out.push({ where: `component ${c.id} ${label}`, e, owner: { type: "detail", comp: c.id, kind, id } }));
    (c.parts ?? []).forEach((p) => d("part", p.id, p.evidence, `part ${p.id}`));
    (c.wires ?? []).forEach((w) => d("wire", `${w.from}>${w.to}`, w.evidence, `wire ${w.from}>${w.to}`));
    (c.tables ?? []).forEach((t) => d("table", t.name, t.evidence, `table ${t.name}`));
    (c.endpoints ?? []).forEach((ep) => d("endpoint", ep.id, ep.evidence, `endpoint ${ep.id}`));
  });
  model.useCases.forEach((u) =>
    u.steps.forEach((s) => {
      s.evidence.forEach((e) => out.push({ where: `${u.id}/${s.id}`, e, owner: { type: "step", uc: u.id, step: s.id } }));
      // table access cited on a step is part of that step (a change to the query changes the step)
      (s.data ?? []).forEach((d) => (d.evidence ?? []).forEach((e) => out.push({ where: `${u.id}/${s.id} data ${d.store}.${d.table}`, e, owner: { type: "step", uc: u.id, step: s.id } })));
      // the data shapes and transforms cited on a step belong to that step too
      (s.payload ?? []).forEach((x, k) => (x.evidence ?? []).forEach((e) => out.push({ where: `${u.id}/${s.id} payload ${k + 1}`, e, owner: { type: "step", uc: u.id, step: s.id } })));
      (s.transforms ?? []).forEach((x) => (x.evidence ?? []).forEach((e) => out.push({ where: `${u.id}/${s.id} transform at ${x.at}`, e, owner: { type: "step", uc: u.id, step: s.id } })));
    }),
  );
  return out;
}

/** Same checks as verifyEvidence, but file content comes from readFile(path) -> string|null
 *  (e.g. `git show <commit>:<path>`), so no checkout is needed. */
export function verifyEvidenceWith(model, readFile) {
  const failures = [];
  const cache = new Map();
  let checked = 0;
  for (const { where, e } of collectEvidence(model)) {
    checked++;
    if (!cache.has(e.file)) {
      const text = readFile(e.file);
      cache.set(e.file, text === null ? null : text.split("\n"));
    }
    const lines = cache.get(e.file);
    if (lines === null) { failures.push(`${where}: 파일 없음 ${e.file}`); continue; }
    const [a, b] = e.lines;
    // a trailing newline yields one empty last element that is not a real line
    const total = lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    if (b > total) { failures.push(`${where}: ${e.file}:${a}-${b} 범위 초과 (총 ${total}줄)`); continue; }
    if (e.contains !== undefined && !lines.slice(a - 1, b).join("\n").includes(e.contains))
      failures.push(`${where}: ${e.file}:${a}-${b} 에 "${e.contains}" 없음`);
  }
  return { checked, failures };
}

export function verifyEvidence(model, sourceDir) {
  const root = resolve(sourceDir);
  const failures = [];
  const cache = new Map();
  let checked = 0;
  for (const { where, e } of collectEvidence(model)) {
    checked++;
    const full = resolve(join(root, e.file));
    if (full !== root && !full.startsWith(root + sep)) {
      failures.push(`${where}: ${e.file} 경로가 소스 밖입니다`);
      continue;
    }
    if (!existsSync(full) || !statSync(full).isFile()) {
      failures.push(`${where}: 파일 없음 ${e.file}`);
      continue;
    }
    if (!cache.has(full)) cache.set(full, readFileSync(full, "utf8").split("\n"));
    const lines = cache.get(full);
    const [a, b] = e.lines;
    if (b > lines.length) {
      failures.push(`${where}: ${e.file}:${a}-${b} 범위 초과 (총 ${lines.length}줄)`);
      continue;
    }
    if (e.contains !== undefined) {
      const slice = lines.slice(a - 1, b).join("\n");
      if (!slice.includes(e.contains))
        failures.push(`${where}: ${e.file}:${a}-${b} 에 "${e.contains}" 없음`);
    }
  }
  return { checked, failures };
}
