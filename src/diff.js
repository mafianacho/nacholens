// Change-overlay extraction: git diff (base..head) x model evidence (file:lines) -> changes.json.
//
// Rules (documented in README):
//  * A step is CHANGED when any of its evidence ranges overlaps a changed line range.
//  * A component is CHANGED when its own evidence overlaps, or when it is an endpoint of a changed
//    step/link and its code lives in the repo (kind client|gateway|service). External systems and
//    datastores are never marked just because a step talks to them.
//  * Change kind: "added" when every evidence range of the item is wholly new code, "removed" when
//    every evidence file was deleted, otherwise "modified".
//  * Changed files that touch no step evidence are reported as `unmapped` (never dropped silently).
//    Tests, docs and lockfiles are listed under `ignored` with the reason.
//  * Model lines refer to model.source.commit. When head differs, head-side line numbers are
//    translated to that commit with a second diff (head -> model commit).
import { collectEvidence } from "./verify.js";

/** Parse `git diff --unified=0` output. Content lines are skipped by hunk counters, so a removed
 *  line that itself starts with "-- " can never be mistaken for a file header. */
export function parseDiff(text) {
  const files = [];
  let cur = null, remOld = 0, remNew = 0;
  for (const line of text.split("\n")) {
    if (cur && (remOld > 0 || remNew > 0) && /^[-+\\]/.test(line)) {
      if (line[0] === "-") remOld--; else if (line[0] === "+") remNew--;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      cur = { path: null, oldPath: null, status: "M", binary: false, hunks: [] };
      files.push(cur);
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (m) cur.path = m[2];
      remOld = remNew = 0;
    } else if (!cur) continue;
    else if (line.startsWith("new file mode")) cur.status = "A";
    else if (line.startsWith("deleted file mode")) cur.status = "D";
    else if (line.startsWith("--- ")) { const p = line.slice(4); if (p.startsWith("a/")) cur.oldPath = p.slice(2); }
    else if (line.startsWith("+++ ")) { const p = line.slice(4); if (p.startsWith("b/")) cur.path = p.slice(2); }
    else if (line.startsWith("Binary files")) cur.binary = true;
    else if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const h = {
        oldStart: +m[1], oldCount: m[2] === undefined ? 1 : +m[2],
        newStart: +m[3], newCount: m[4] === undefined ? 1 : +m[4],
      };
      cur.hunks.push(h);
      remOld = h.oldCount; remNew = h.newCount;
    }
  }
  for (const f of files) if (!f.path) f.path = f.oldPath;
  return files.filter((f) => f.path);
}

const overlap = (a, b) => a[0] <= b[1] && b[0] <= a[1];

/** Returns mapRange(range) translating head-side lines to the model commit's lines. */
export function makeMapper(hunks) {
  const hs = [...hunks].sort((a, b) => a.oldStart - b.oldStart);
  const shiftBefore = (l) => {
    let s = 0;
    for (const h of hs) {
      const lastOld = h.oldCount === 0 ? h.oldStart : h.oldStart + h.oldCount - 1;
      const before = h.oldCount === 0 ? h.oldStart < l : lastOld < l;
      if (before) s += h.newCount - h.oldCount;
    }
    return s;
  };
  const mapLine = (l) => {
    for (const h of hs)
      if (h.oldCount > 0 && l >= h.oldStart && l <= h.oldStart + h.oldCount - 1)
        return h.newCount > 0 ? [h.newStart, h.newStart + h.newCount - 1] : [Math.max(1, h.newStart), h.newStart + 1];
    const v = l + shiftBefore(l);
    return [v, v];
  };
  return (r) => [mapLine(r[0])[0], mapLine(r[1])[1]];
}

/** Notes written into changes.json (English; the player shows them as data). review.js matches COMPONENT_NOTE. */
export const COMPONENT_NOTE = "Component evidence code changed";
const EV_NOTE = { added: "Evidence code added", removed: "Evidence code removed", modified: "Evidence code changed" };

export const IGNORE_RULES = [
  [/(^|\/)(tests?|__tests__|spec|e2e|fixtures)\//i, "test"],
  [/\.(test|spec)\.[cm]?[jt]sx?$/i, "test"],
  [/(^|\/)requirements[^/]*\.txt$/i, null], // a dependency manifest, not prose (kept: reported as config)
  [/\.(md|mdx|txt|rst)$/i, "docs"],
  [/(^|\/)docs?\//i, "docs"],
  [/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock|uv\.lock|Pipfile\.lock|pdm\.lock|composer\.lock|bun\.lockb?|flake\.lock|deno\.lock)$/, "lockfile"],
  [/\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf)$/i, "asset"],
];
export function ignoreReason(path) {
  for (const [re, why] of IGNORE_RULES) if (re.test(path)) return why; // first match wins; a null reason means "keep"
  return null;
}

/** Dependency manifests and CI/tooling files: what the code is built from, not a request path. */
const CONFIG_RE = /(^|\/)(pyproject\.toml|requirements[^/]*\.txt|Pipfile|go\.mod|Cargo\.toml|package\.json|\.pre-commit-config\.ya?ml|\.gitlab-ci\.ya?ml)$|(^|\/)\.github\/(workflows|dependabot)/i;
/**
 * Stylesheets and dependency/CI files rarely change a request flow: reported, but kept apart from code
 * in the warning and ignored by --strict ("style" and "config" are the soft categories).
 */
export const unmappedCategory = (path) => (/\.(css|scss|sass|less|styl)$/i.test(path) ? "style" : CONFIG_RE.test(path) ? "config" : "code");
export const isSoftCategory = (c) => c === "style" || c === "config";

const rangeText = (rs) => rs.map((r) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`)).join(", ");
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

function mergeRanges(rs) {
  const out = [];
  for (const r of [...rs].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]);
  }
  return out;
}
const inside = (merged, r) => merged.some((m) => m[0] <= r[0] && r[1] <= m[1]);

export function generateOverlay({ model, diffText, toModelDiffText = null, meta = {} }) {
  const files = parseDiff(diffText);
  const toModel = new Map(toModelDiffText ? parseDiff(toModelDiffText).map((f) => [f.path, f]) : []);
  const evidence = collectEvidence(model);
  const ownerKey = (o) => (o.type === "step" ? `step:${o.uc}/${o.step}` : o.type === "link" ? `link:${o.a}|${o.b}` : o.type === "detail" ? `detail:${o.comp}|${o.kind}|${o.id}` : `component:${o.id}`);

  // per owner: total evidence count + per-evidence state
  const owners = new Map();
  for (const ev of evidence) {
    const k = ownerKey(ev.owner);
    if (!owners.has(k)) owners.set(k, { owner: ev.owner, total: 0, hit: 0, added: 0, removed: 0, files: new Map() });
    owners.get(k).total++;
  }

  const ignored = [], unmapped = [];
  for (const f of files) {
    const why = ignoreReason(f.path);
    if (why) { ignored.push({ file: f.path, reason: why }); continue; }
    const whole = f.status === "A" || f.status === "D" || f.binary;
    let ranges = [], addRanges = [];
    if (!whole) {
      const tf = toModel.get(f.path);
      const map = tf && tf.status === "M" ? makeMapper(tf.hunks) : (r) => r;
      for (const h of f.hunks) {
        const r = h.newCount > 0 ? [h.newStart, h.newStart + h.newCount - 1] : [Math.max(1, h.newStart), h.newStart + 1];
        const m = map(r);
        ranges.push(m);
        if (h.oldCount === 0 && h.newCount > 0) addRanges.push(m);
      }
    }
    const merged = mergeRanges(addRanges);
    let stepHit = false, anyHint = new Set();
    for (const ev of evidence) {
      if (ev.e.file !== f.path) continue;
      const hit = whole || ranges.some((r) => overlap(r, ev.e.lines));
      if (!hit) continue;
      const o = owners.get(ownerKey(ev.owner));
      o.hit++;
      if (f.status === "D") o.removed++;
      else if (f.status === "A" || inside(merged, ev.e.lines)) o.added++;
      o.files.set(f.path, [...(o.files.get(f.path) ?? []), ev.e.lines]);
      if (ev.owner.type === "step") stepHit = true; else anyHint.add(ev.owner.type === "link" ? `link ${ev.owner.a}–${ev.owner.b}` : ev.owner.type === "detail" ? `${ev.owner.comp} detail (${ev.owner.kind} ${ev.owner.id})` : `component ${ev.owner.id}`);
    }
    if (!stepHit)
      unmapped.push({
        file: f.path,
        category: unmappedCategory(f.path),
        status: f.status === "A" ? "added" : f.status === "D" ? "deleted" : "modified",
        lines: whole ? "whole file" : clip(rangeText(mergeRanges(f.hunks.map((h) => (h.newCount > 0 ? [h.newStart, h.newStart + h.newCount - 1] : [Math.max(1, h.newStart), h.newStart + 1])))) + ` (${f.hunks.length} ${f.hunks.length === 1 ? "hunk" : "hunks"})`, 280),
        hint: anyHint.size ? `Overlaps the evidence of ${[...anyHint].join(", ")}, but no step` : "Not in the evidence of any use-case step: add the path to the model, or confirm the change is unrelated",
      });
  }

  const kindOf = (o) => (o.removed === o.total ? "removed" : o.added === o.total ? "added" : "modified");
  const evText = (o) => [...o.files].map(([f, rs]) => `${f}:${rangeText(mergeRanges(rs))}`).join(", ");

  // steps
  const steps = [], stepSet = new Set();
  const compById = new Map(model.components.map((c) => [c.id, c]));
  const compChange = new Map();
  const markComp = (id, change, note, strong) => {
    const c = compById.get(id);
    if (!c) return;
    const prev = compChange.get(id);
    if (prev && (prev.strong || !strong)) return;
    compChange.set(id, { change, note, strong });
  };
  for (const u of model.useCases)
    for (const s of u.steps) {
      const o = owners.get(`step:${u.id}/${s.id}`);
      if (!o || o.hit === 0) continue;
      const change = kindOf(o);
      steps.push({ useCase: u.id, step: s.id, change, note: clip(`${EV_NOTE[change]}: ${evText(o)}`, 300) });
      stepSet.add(`${u.id}/${s.id}`);
      for (const id of new Set([s.from, s.to]))
        if (["client", "gateway", "service"].includes(compById.get(id)?.kind))
          markComp(id, "modified", clip(`End of a changed step: ${u.id}/${s.id}`, 300), false);
    }
  for (const l of model.links) {
    const o = owners.get(`link:${l.a}|${l.b}`);
    if (o && o.hit)
      for (const id of [l.a, l.b])
        if (["client", "gateway", "service"].includes(compById.get(id)?.kind))
          markComp(id, "modified", clip(`Evidence code of the link '${l.label}' changed: ${evText(o)}`, 300), false);
  }
  for (const c of model.components) {
    const o = owners.get(`component:${c.id}`);
    if (o && o.hit) markComp(c.id, kindOf(o), clip(`${COMPONENT_NOTE}: ${evText(o)}`, 300), true);
  }
  const components = model.components.filter((c) => compChange.has(c.id)).map((c) => ({ id: c.id, change: compChange.get(c.id).change, note: compChange.get(c.id).note }));
  // drill-down items whose own evidence changed (shown inside the detail view; they do not badge the component)
  const details = [];
  for (const [k, o] of owners) {
    if (!k.startsWith("detail:") || !o.hit) continue;
    const change = kindOf(o);
    details.push({ component: o.owner.comp, kind: o.owner.kind, id: o.owner.id, change, note: clip(`${EV_NOTE[change]}: ${evText(o)}`, 300) });
  }

  const short = (s) => (s ? String(s).slice(0, 7) : "?");
  const subjects = (meta.subjects ?? []).map((s) => s.split("\n")[0]);
  const title = subjects.length === 1 ? subjects[0] : subjects.length > 1 ? `${subjects.length} commits: ${subjects[0]} and more` : `Changes ${short(meta.base)}..${short(meta.head)}`;
  const names = components.map((c) => c.id).join(", ") || "none";
  const summary = `Generated from git diff: ${steps.length} changed steps, ${components.length} changed components (${names}), ${unmapped.length} changed files outside the model, ${ignored.length} ignored files.`;
  return {
    title: clip(title, 120),
    summary: clip(summary, 600),
    ref: clip(`${model.source.repo} ${short(meta.base)}..${short(meta.head)}`, 200),
    components,
    steps,
    ...(details.length ? { details } : {}),
    unmapped,
    ignored,
    generated: {
      by: "nacholens diff",
      base: meta.base ?? null,
      head: meta.head ?? null,
      modelCommit: model.source.commit,
      lineTranslation: !!toModelDiffText,
    },
  };
}

/** git-backed wrapper. `repo` comes from openRepo(). */
export function overlayFromRepo(repo, model, baseRef, headRef) {
  const base = repo.resolve(baseRef), head = repo.resolve(headRef);
  const modelSha = repo.tryResolve(model.source.commit);
  const warnings = [];
  let toModelDiffText = null;
  if (!modelSha) warnings.push(`Model commit ${model.source.commit} is not in the repository, so line numbers were compared without translation (they may be off).`);
  else if (modelSha !== head) toModelDiffText = repo.diff(head, modelSha);
  const overlay = generateOverlay({
    model,
    diffText: repo.diff(base, head),
    toModelDiffText,
    meta: { base, head, subjects: repo.subjects(base, head) },
  });
  return { overlay, warnings };
}
