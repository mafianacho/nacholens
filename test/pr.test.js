// PR comment: built from the model + changes + review, readable without the images, one numbering, no guessing.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildPrComment, codeLinker, diffAnchor, mermaidSequence, mer, PR_MARK } from "../src/pr.js";
import { buildReview } from "../src/review.js";
import { demoModel, demoAutoChanges, clone, readJson } from "./helpers.js";

const intent = () => readJson("models/demo-shop/intent.example.json");
const base = (extra = {}) => {
  const model = demoModel(), changes = demoAutoChanges();
  const review = buildReview(model, changes, { intent: intent(), tests: [] });
  return { model, changes, review, report: { head: model.source.commit, base: "1111111aaaa", modelCommit: model.source.commit, depth: "full" }, ...extra };
};
const changedUcs = () => { const c = demoAutoChanges(); return [...new Set(c.steps.map((s) => s.useCase))]; };

test("comment: marker, summary counts, one section per changed flow only, head marker", () => {
  const p = base(), t = buildPrComment(p);
  assert.ok(t.startsWith(PR_MARK));
  const n = p.changes.steps.length;
  assert.match(t, new RegExp(`\\*\\*${changedUcs().length}\\*\\* flows · \\*\\*${n}\\*\\* steps changed`));
  for (const u of p.model.useCases) {
    const heading = new RegExp(`^### Flow \\d+ · ${u.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `, "m");
    assert.equal(heading.test(t), changedUcs().includes(u.id), u.id);
  }
  assert.ok(t.includes(`<!-- nacholens:head=${p.report.head} -->`));
  assert.ok(t.length < 65536);
});

test("one numbering: the step number in the list, the sequence diagram and the re-test list is the player's", () => {
  const p = base(), t = buildPrComment(p);
  const L = p.model.useCases.find((u) => u.id === "list-orders"), i = L.steps.findIndex((s) => s.id === "shipping");
  const no = "①②③④⑤⑥⑦⑧⑨⑩"[i];
  assert.ok(t.includes(`- ${no} **${L.steps[i].label}** 🟢 new`), "step list");
  assert.ok(t.includes(`${no} ${mer(L.steps[i].label)}`), "sequence diagram");
  assert.match(t, new RegExp(`changed steps: [^\\n]*${no} ${L.steps[i].label}`), "re-test list");
});

test("changed steps carry what happens, route, payload, code; unchanged steps are one line; the old text is never invented", () => {
  const p = base(), t = buildPrComment(p);
  const L = p.model.useCases.find((u) => u.id === "list-orders");
  const sh = L.steps.find((s) => s.id === "shipping");
  assert.ok(t.includes(`What happens: ${sh.narration.replace(/"/g, '"')}`.slice(0, 40)));
  assert.ok(t.includes("Sends: `" + sh.request + "`"));
  const modified = p.changes.steps.find((s) => s.change === "modified");
  assert.ok(modified);
  assert.ok(t.includes("the model has no earlier version, so the old wording is not shown"));
  const same = L.steps.find((s) => !p.changes.steps.some((c) => c.useCase === "list-orders" && c.step === s.id));
  assert.match(t, new RegExp(`^- [①-⑳] ${same.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
});

test("intent, re-test checklist (with the honest 'no test found' note) and files outside the flows", () => {
  const p = base(), t = buildPrComment(p);
  const s = p.review.intent.summary;
  assert.ok(t.includes(`met ${s.met} · not met ${s.unmet} · unknown ${s.unknown}`));
  assert.equal((t.match(/^- (✅|❌|❓) /gm) ?? []).length, s.total);
  assert.equal((t.match(/^- \[ \] \*\*/gm) ?? []).length, p.review.impact.useCases.length);
  assert.ok(t.includes("it is not proof that nothing tests it"));
  for (const f of p.changes.unmapped) assert.ok(t.includes("`" + f.file + "`"), f.file);
});

test("links: PR diff anchors when the model was read at head, blob permalinks otherwise, plain text without a repo URL", () => {
  const e = { file: "src/a b.js", lines: [3, 9] };
  const anchor = "diff-" + createHash("sha256").update("src/a b.js").digest("hex");
  assert.equal(diffAnchor("src/a b.js"), anchor);
  assert.equal(codeLinker({ repoUrl: "https://github.com/o/r/", pr: 7, head: "abcdef123", modelCommit: "abcdef1" })(e), `[\`src/a b.js:3-9\`](https://github.com/o/r/pull/7/files#${anchor}R3-R9)`);
  assert.equal(codeLinker({ repoUrl: "https://github.com/o/r", pr: 7, head: "abcdef1", modelCommit: "9999999" })(e), "[`src/a b.js:3-9`](https://github.com/o/r/blob/9999999/src/a%20b.js#L3-L9)");
  assert.equal(codeLinker({})({ file: "x.js", lines: [4, 4] }), "`x.js:4`");
});

test("pictures: only with a media URL; light + dark become one <picture>; the diagram stays as text", () => {
  const media = { files: [
    { kind: "map", theme: "light", file: "map.png", width: 728 }, { kind: "map", theme: "dark", file: "map.dark.png", width: 728 },
    { kind: "flow", theme: "light", useCase: "list-orders", file: "list-orders.gif", width: 728 },
  ] };
  const without = buildPrComment(base({ media }));
  assert.ok(!without.includes("<img"), "no URL, no pictures");
  assert.ok(without.includes("```mermaid\nflowchart LR"));
  const t = buildPrComment(base({ media, opt: { mediaUrl: "https://example.com/m/" } }));
  assert.ok(t.includes('<picture>\n<source media="(prefers-color-scheme: dark)" srcset="https://example.com/m/map.dark.png">\n<img src="https://example.com/m/map.png"'));
  assert.ok(t.includes('<img src="https://example.com/m/list-orders.gif"'));
  assert.ok(t.includes("<summary>Diagram (text)</summary>"), "the text diagram folds under the picture");
  assert.equal((t.match(/```mermaid\nsequenceDiagram/g) ?? []).length, changedUcs().length);
});

test("player link: a Claude artifact is named as such", () => {
  assert.ok(buildPrComment(base({ opt: { playerUrl: "https://claude.ai/public/artifacts/abc" } })).includes("[▶ Open the interactive player (Claude artifact)](https://claude.ai/public/artifacts/abc)"));
  assert.ok(buildPrComment(base({ opt: { playerUrl: "https://example.com/p.html", lang: "ko" } })).includes("[▶ 인터랙티브 플레이어 열기](https://example.com/p.html)"));
});

test("model text cannot inject HTML or break a mermaid statement", () => {
  const p = base();
  const L = p.model.useCases.find((u) => u.id === "list-orders");
  const sh = L.steps.find((s) => s.id === "shipping");
  sh.label = "<script>alert(1)</script> a|b; c: #x `y`";
  const t = buildPrComment(p);
  assert.ok(!t.includes("<script>"));
  const seq = mermaidSequence(p.model, L, (u, s) => (s === "shipping" ? "added" : null));
  const line = seq.split("\n").find((l) => l.includes("alert"));
  assert.ok(line && !/[;<>]/.test(line.split(": ").slice(1).join(": ").replace(/#\d+;|#lt;|#gt;|#quot;/g, "")), line);
});

test("nothing changed: says so, no flow sections", () => {
  const p = base({ changes: { ...clone(demoAutoChanges()), steps: [], components: [], unmapped: [], ignored: [] } });
  p.review = null;
  const t = buildPrComment(p);
  assert.ok(t.includes("No step of the model is touched by this change."));
  assert.ok(!/^### Flow /m.test(t));
});

test("size: many changed flows stay under GitHub's comment limit", () => {
  const p = base();
  const L = p.model.useCases.find((u) => u.id === "list-orders");
  for (let k = 0; k < 120; k++) { const u = clone(L); u.id = `uc${k}`; u.title = `Flow ${k} ` + "x".repeat(60); p.model.useCases.push(u); for (const s of u.steps) p.changes.steps.push({ useCase: u.id, step: s.id, change: "modified", note: "n" }); }
  const t = buildPrComment(p);
  assert.ok(t.length < 65536, String(t.length));
  assert.match(t, /only listed by name/);
});
