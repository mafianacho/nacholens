// Collection depth (diff | brief | full): the optional model field, the rules, `scan --depth diff`, the CLI wiring,
// the demo-shop examples and what ships in the package. Rules only ever WARN: nothing here may change an exit code
// of a model that is otherwise valid.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, EXIT } from "../src/cli.js";
import { validateModel } from "../src/model.js";
import { resolveDepth, normalizeDepth, depthName, checkDepth, sizeOf, scanDiff, DEPTHS } from "../src/depth.js";
import { openRepo } from "../src/gitio.js";
import { overlayFromRepo } from "../src/diff.js";
import { makeDemoRepo } from "../src/demo.js";
import { deriveBrief, deriveDiff, deriveFull, FILES } from "../scripts/derive-depth-models.js";
import { demoModel, demoAutoChanges, readJson, tiny, clone, root } from "./helpers.js";

const tmp = () => mkdtempSync(join(tmpdir(), "nacholens-depth-"));
const cap = () => { const lines = []; return { log: (l) => lines.push(l), text: () => lines.join("\n") }; };
const model = (depth) => readJson(`models/demo-shop/${FILES[depth]}`);
let demo = null;
const demoRepo = () => demo ??= makeDemoRepo(join(tmp(), "repo"));

/* ───────── the model field ───────── */
test("depth is an optional model field: diff|brief|full are valid, anything else is a validation error, absence changes nothing", () => {
  assert.deepEqual(DEPTHS, ["diff", "brief", "full"]);
  assert.deepEqual(validateModel(tiny()), []);
  for (const d of DEPTHS) assert.deepEqual(validateModel({ ...tiny(), depth: d }), [], d);
  for (const bad of ["deep", "FULL", "", null, 3, ["full"]]) {
    const errs = validateModel({ ...tiny(), depth: bad });
    assert.equal(errs.length, 1, JSON.stringify(bad));
    assert.match(errs[0], /^depth: diff\|brief\|full/);
  }
});

test("resolveDepth: the flag and the model's own depth must agree; a bad flag is a usage error", () => {
  assert.deepEqual(resolveDepth(tiny(), undefined), { depth: null, declared: null, error: null });
  assert.equal(resolveDepth(tiny(), "brief").depth, "brief");
  assert.equal(resolveDepth({ ...tiny(), depth: "full" }, undefined).depth, "full");
  assert.equal(resolveDepth({ ...tiny(), depth: "full" }, "full").error, null);
  assert.match(resolveDepth({ ...tiny(), depth: "full" }, "brief").error, /"full".*--depth brief/);
  assert.throws(() => resolveDepth(tiny(), "huge"), /--depth 은 1\|2\|3 \(= 1 변경만 · 2 한눈에 · 3 자세히\) 또는 diff\|brief\|full/);
});

/* ───────── the rules ───────── */
test("a model with no depth is never checked", () => {
  assert.deepEqual(checkDepth(demoModel(), null), { warnings: [], notes: [] });
});

test("brief: drill-down anywhere is a warning (components and steps), the brief demo model is clean", () => {
  assert.deepEqual(checkDepth(model("brief"), "brief"), { warnings: [], notes: [] });
  const w = checkDepth(demoModel(), "brief").warnings.join("\n");
  for (const k of ["parts", "wires", "tables", "endpoints", "trace", "data", "payload", "transforms"]) assert.match(w, new RegExp(`${k} 가 있습니다`), k);
  assert.match(w, /api/); assert.match(w, /db/); assert.match(w, /sign-in\/start/);
});

test("full: a full-depth demo model is clean; a flow-only model is told exactly what is missing", () => {
  assert.deepEqual(checkDepth(model("full"), "full"), { warnings: [], notes: [] });
  const w = checkDepth(model("brief"), "full").warnings.join("\n");
  assert.match(w, /datastore db 에 tables 가 없습니다/);
  assert.match(w, /service api 에 parts 가 없습니다/);
  assert.match(w, /external idp, shipping, analytics 에 endpoints 가 없습니다/);
  assert.match(w, /datastore 를 부르는 단계 8개에 data 가 없습니다/);
  assert.match(w, /payload 가 하나도 없습니다/);
  // the smallest model: a datastore without tables and a service without parts
  const t = checkDepth(tiny(), "full").warnings.join("\n");
  assert.match(t, /datastore db/); assert.match(t, /service api/);
});

test("full: parts without wires, and steps through parts without a trace, are reported", () => {
  const m = clone(model("full"));
  delete m.components.find((c) => c.id === "api").wires;
  assert.match(checkDepth(m, "full").warnings.join("\n"), /api 에 parts 는 있으나 wires 가 없습니다/);
  const m2 = clone(model("full"));
  delete m2.useCases[0].steps[0].trace;
  assert.match(checkDepth(m2, "full").warnings.join("\n"), /trace 가 없습니다 \(sign-in\/start\)/);
});

test("diff: the diff demo model is clean against the real change; the full model holds 23 steps the change does not touch", () => {
  const changes = demoAutoChanges();
  assert.deepEqual(checkDepth(model("diff"), "diff", { changes }), { warnings: [], notes: [] });
  const w = checkDepth(demoModel(), "diff", { changes }).warnings;
  assert.equal(w.length, 1);
  assert.match(w[0], /이번 변경에 닿지 않는 단계가 23개 있습니다/);
});

test("diff: structure alone finds components, links, tables and parts that no step passes; without a change scope a note says only the structure was checked", () => {
  const m = clone(model("diff")), full = demoModel();
  m.components.push(clone(full.components.find((c) => c.id === "idp")));           // no step passes it
  m.links.push(clone(full.links.find((l) => [l.a, l.b].includes("idp"))));         // a link to idp, which no step reaches
  m.components.find((c) => c.id === "db").tables.push(clone(full.components.find((c) => c.id === "db").tables.find((t) => !model("diff").components.find((c) => c.id === "db").tables.some((x) => x.name === t.name))));
  m.components.find((c) => c.id === "api").parts.push(clone(full.components.find((c) => c.id === "api").parts[0]));
  const r = checkDepth(m, "diff");
  const w = r.warnings.join("\n");
  assert.match(w, /어떤 단계도 지나지 않는 컴포넌트가 있습니다 \(idp\)/);
  assert.match(w, /어떤 단계도 건너지 않는 연결이 있습니다/);
  assert.match(w, /읽거나 쓰지 않는 table 이 있습니다/);
  assert.match(w, /trace 에도 없는 part 가 있습니다/);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /--repo --base 또는 --changes/);
  assert.deepEqual(checkDepth(model("diff"), "diff"), { warnings: [], notes: r.notes });
});

test("diff: a changed step the model does not hold is reported too", () => {
  const changes = clone(demoAutoChanges());
  changes.steps.push({ useCase: "sign-in", step: "start", change: "modified", note: "n" });
  assert.match(checkDepth(model("diff"), "diff", { changes }).warnings.join("\n"), /변경이 닿는 단계가 모델에 없습니다 \(sign-in\/start\)/);
});

/* ───────── the demo-shop examples ───────── */
test("the three demo-shop models are exactly what the derivation produces from model.json + changes.auto.json", () => {
  const full = readJson("models/demo-shop/model.json"), changes = demoAutoChanges();
  assert.equal(full.depth, "full");
  assert.deepEqual(deriveFull(full), full, "run: npm run build:depth-models");
  assert.deepEqual(deriveBrief(full), model("brief"), "run: npm run build:depth-models");
  assert.deepEqual(deriveDiff(full, changes), model("diff"), "run: npm run build:depth-models");
  assert.deepEqual(Object.keys(model("diff")).slice(0, 2), ["schemaVersion", "depth"]);
  for (const d of DEPTHS) assert.deepEqual(validateModel(model(d)), [], d);
});

test("demo-shop sizes per depth (the numbers guide.md and guide.ko.md quote)", () => {
  const z = Object.fromEntries(DEPTHS.map((d) => [d, sizeOf(model(d))]));
  assert.deepEqual([z.full.components, z.brief.components, z.diff.components], [7, 7, 5]);
  assert.deepEqual([z.full.steps, z.brief.steps, z.diff.steps], [27, 27, 4]);
  assert.deepEqual([z.brief.parts, z.brief.tables, z.brief.endpoints], [0, 0, 0]);
  assert.ok(z.full.parts > z.diff.parts && z.diff.parts > 0 && z.diff.tables === 1);
  for (const f of ["docs/guide.md", "docs/guide.ko.md"]) {
    const t = readFileSync(join(root, f), "utf8");
    assert.ok(t.includes("7 / 7 / 5") && t.includes("27 / 27 / 4"), f);
  }
});

test("every demo-shop depth model verifies against the demo repository; the diff model holds exactly the steps the real change touches", () => {
  const { dir, base, head } = demoRepo();
  const repo = openRepo(dir);
  for (const d of DEPTHS) {
    const c = cap();
    assert.equal(run(["verify", join(root, "models/demo-shop", FILES[d]), "--repo", dir, "--base", base], {}, c.log), EXIT.OK, c.text());
    assert.match(c.text(), /모두 소스와 일치/);
    assert.ok(!c.text().includes("⚠ "), `${d}: no depth warning\n${c.text()}`);
  }
  const { overlay } = overlayFromRepo(repo, model("diff"), base, head);
  assert.deepEqual(overlay.steps.map((s) => `${s.useCase}/${s.step}`).sort(), model("diff").useCases.flatMap((u) => u.steps.map((s) => `${u.id}/${s.id}`)).sort());
});

/* ───────── the CLI ───────── */
test("validate: no depth anywhere prints exactly what it printed before (no depth line, exit 0)", () => {
  const c = cap();
  const f = join(tmp(), "m.json");
  writeFileSync(f, JSON.stringify(tiny()));
  assert.equal(run(["validate", f], {}, c.log), EXIT.OK);
  assert.equal(c.text(), "✓ 유효: 컴포넌트 4, 연결 3, 유즈케이스 1, 단계 4");
});

test("validate / verify warn about the declared depth and still exit 0; build shows it in report.json", () => {
  const dir = join(tmp(), "repo");
  mkdirSync(dir, { recursive: true });
  const m = { ...clone(model("full")), depth: "brief" }; // declares brief but carries full detail
  const f = join(tmp(), "m.json");
  writeFileSync(f, JSON.stringify(m));
  const c = cap();
  assert.equal(run(["validate", f], {}, c.log), EXIT.OK);
  assert.match(c.text(), /깊이 2 · 한눈에 \(brief\) · 컴포넌트 7/);
  assert.match(c.text(), /⚠ brief 수준인데 컴포넌트 1개에 parts 가 있습니다/);
  // the same through verify (demo repo) and build
  const { dir: repoDir, base } = demoRepo();
  const v = cap();
  assert.equal(run(["verify", f, "--repo", repoDir], {}, v.log), EXIT.OK);
  assert.match(v.text(), /⚠ brief 수준인데/);
  const out = join(tmp(), "out");
  const b = cap();
  assert.equal(run(["build", "--repo", repoDir, "--model", f, "--base", base, "--out", out], {}, b.log), EXIT.OK, b.text());
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  assert.equal(report.depth, "brief");
  assert.ok(report.depthWarnings.length >= 5);
  assert.ok(existsSync(join(out, "demo-shop.html")));
});

test("--depth on a model without the field applies the rules and says it came from the flag; build embeds the checked depth in the page", () => {
  const c = cap();
  const f = join(tmp(), "m.json");
  writeFileSync(f, JSON.stringify(tiny()));
  assert.equal(run(["validate", f, "--depth", "full"], {}, c.log), EXIT.OK);
  assert.match(c.text(), /깊이 3 · 자세히 \(full\) \(--depth 로 지정, 모델에 depth 선언 없음\)/);
  assert.match(c.text(), /⚠ full 수준인데 datastore db/);
  const out = join(tmp(), "out");
  assert.equal(run(["build", f, "--depth", "brief", "--out", out, "--format", "both"], {}, () => {}), EXIT.OK);
  for (const name of ["tiny.html", "tiny.artifact.html"]) {
    const html = readFileSync(join(out, name), "utf8");
    assert.equal(JSON.parse(/id="sv-model">([^]*?)<\/script>/.exec(html)[1].replace(/\\u003c/g, "<")).depth, "brief", name);
  }
});

test("a --depth that contradicts the model's own depth exits 1; an unknown value is a usage error", () => {
  const f = join(tmp(), "m.json");
  writeFileSync(f, JSON.stringify(model("brief")));
  const c = cap();
  assert.equal(run(["validate", f, "--depth", "full"], {}, c.log), EXIT.MODEL);
  assert.match(c.text(), /✗ 모델은 depth "brief" 로 선언되어 있는데 --depth full/);
  const v = cap();
  assert.equal(run(["verify", f, "--repo", demoRepo().dir, "--depth", "diff"], {}, v.log), EXIT.MODEL);
  assert.match(v.text(), /✗ 모델은 depth "brief" 로 선언되어 있는데 --depth diff/);
});

test("--depth diff needs a change scope; with --repo --base it is checked against the change, with --changes against the overlay", () => {
  const f = join(tmp(), "m.json");
  writeFileSync(f, JSON.stringify(model("full")));
  const df = join(tmp(), "d.json");
  writeFileSync(df, JSON.stringify(model("diff")));
  assert.throws(() => run(["build", df, "--depth", "diff", "--out", tmp()], {}, () => {}), /--depth diff 는 변경 범위가 필요합니다/);
  const { dir, base } = demoRepo();
  const c = cap();
  assert.equal(run(["validate", f, "--repo", dir, "--base", base, "--depth", "diff"], {}, () => {}), EXIT.MODEL, "full declares itself: flag contradicts");
  const nf = join(tmp(), "n.json");
  writeFileSync(nf, JSON.stringify({ ...clone(model("full")), depth: undefined }));
  assert.equal(run(["validate", nf, "--repo", dir, "--base", base, "--depth", "diff"], {}, c.log), EXIT.OK);
  assert.match(c.text(), /깊이 1 · 변경만 \(diff\) \(--depth 로 지정/);
  assert.match(c.text(), /⚠ diff 수준인데 이번 변경에 닿지 않는 단계가 23개 있습니다/);
  const ch = join(tmp(), "c.json");
  // the overlay of the diff model itself (the one in models/ was made for the full model and names details the diff model dropped)
  writeFileSync(ch, JSON.stringify(overlayFromRepo(openRepo(dir), model("diff"), base, "HEAD").overlay));
  const c2 = cap();
  assert.equal(run(["validate", join(root, "models/demo-shop/model.diff.json"), "--changes", ch], {}, c2.log), EXIT.OK);
  assert.ok(!c2.text().includes("⚠ ") && !c2.text().includes("구조만 검사"), c2.text());
});

test("a bad depth value in the model stops validate with exit 1", () => {
  const f = join(tmp(), "m.json");
  writeFileSync(f, JSON.stringify({ ...tiny(), depth: "deep" }));
  const c = cap();
  assert.equal(run(["validate", f], {}, c.log), EXIT.MODEL);
  assert.match(c.text(), /depth: diff\|brief\|full/);
});

test("demo builds with a full-depth model and no depth warning; the page and report carry the depth", () => {
  const out = join(tmp(), "demo");
  const c = cap();
  assert.equal(run(["demo", "--out", out], {}, c.log), EXIT.OK, c.text());
  assert.match(c.text(), /깊이 3 · 자세히 \(full\)/);
  assert.ok(!c.text().includes("⚠ full") && !c.text().includes("⚠ diff") && !c.text().includes("⚠ brief"), c.text());
  assert.match(readFileSync(join(out, "demo-shop.html"), "utf8"), /"depth":"full"/);
  assert.equal(run(["demo", "--out", join(tmp(), "d2"), "--depth", "full"], {}, () => {}), EXIT.OK);
  assert.equal(run(["demo", "--out", join(tmp(), "d3"), "--depth", "brief"], {}, () => {}), EXIT.MODEL, "the bundled model declares full");
});

/* ───────── scan --depth ───────── */
test("scan --depth diff lists the changed files, their lines and the leads inside them; tests/docs/styles are set apart", () => {
  const { dir, base, head } = demoRepo();
  const r = scanDiff(openRepo(dir), base, "HEAD");
  assert.equal(r.base, base); assert.equal(r.head, head); assert.equal(r.depth, "diff");
  assert.deepEqual(r.files.map((f) => [f.file, f.status, f.category]), [["api.js", "modified", "code"], ["public/app.js", "modified", "code"], ["public/format.js", "modified", "code"], ["public/styles.css", "modified", "style"]]);
  assert.deepEqual(r.ignored, [{ file: "README.md", reason: "docs" }]);
  assert.equal(r.files[0].lines, "11-19, 64-65, 73");
  assert.equal(r.stats.changed, 5);
  // the fetch to the shipping tracker is on a changed line; the unchanged routes of api.js are not leads
  assert.deepEqual(r.leads.clients.map((x) => `${x.file}:${x.line}`), ["api.js:15"]);
  assert.deepEqual(r.leads.routes, []);
  // every lead sits inside a changed range
  for (const l of Object.values(r.leads).flat()) {
    const f = r.files.find((x) => x.file === l.file);
    assert.ok(f.lines.split(", ").some((rg) => { const [a, b = a] = rg.split("-").map(Number); return a <= l.line && l.line <= b; }), `${l.file}:${l.line}`);
  }
});

test("scan --depth diff: a whole new file contributes all its leads, a deleted file only its name; --head limits the range", () => {
  const dir = join(tmp(), "r");
  mkdirSync(dir);
  const g = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: dir, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  writeFileSync(join(dir, "old.js"), 'app.get("/old", h);\n');
  writeFileSync(join(dir, "keep.js"), 'app.get("/a", h);\napp.get("/b", h);\napp.get("/c", h);\n');
  g("add", "-A"); g("commit", "-q", "-m", "one");
  const one = g("rev-parse", "HEAD");
  g("rm", "-q", "old.js");
  writeFileSync(join(dir, "new.js"), 'app.post("/new", h);\napp.get("/new2", h);\n');
  writeFileSync(join(dir, "keep.js"), 'app.get("/a", h);\napp.get("/b2", h);\napp.get("/c", h);\n');
  g("add", "-A"); g("commit", "-q", "-m", "two");
  const r = scanDiff(openRepo(dir), one, "HEAD");
  assert.deepEqual(r.files.map((f) => `${f.file}:${f.status}`).sort(), ["keep.js:modified", "new.js:added", "old.js:deleted"]);
  assert.deepEqual(r.leads.routes.map((x) => `${x.file}:${x.line} ${x.method} ${x.path}`).sort(), ["keep.js:2 GET /b2", "new.js:1 POST /new", "new.js:2 GET /new2"]);
  assert.equal(r.files.find((f) => f.file === "old.js").lines, "whole file");
  assert.equal(scanDiff(openRepo(dir), one, one).files.length, 0);
});

test("scan CLI: --depth diff prints the candidate list or JSON and needs --base; brief/full guide the scan; a bad value is a usage error", () => {
  const { dir, base } = demoRepo();
  const c = cap();
  assert.equal(run(["scan", "--repo", dir, "--depth", "diff", "--base", base], {}, c.log), EXIT.OK);
  assert.match(c.text(), /^# nacholens scan --depth diff — 모델링 후보 030bf9c\.\.e9f3087/);
  assert.match(c.text(), /api\.js {2}\[modified\] {2}줄 11-19, 64-65, 73 \(3 hunks\)/);
  assert.match(c.text(), /api\.js:15 /);
  assert.match(c.text(), /README\.md {2}\[docs\]/);
  const j = cap();
  run(["scan", "--repo", dir, "--depth", "diff", "--base", base, "--json"], {}, j.log);
  assert.equal(JSON.parse(j.text()).stats.candidates, 4);
  assert.throws(() => run(["scan", "--repo", dir, "--depth", "diff"], {}, () => {}), /--base 가 필요/);
  assert.throws(() => run(["scan", "--repo", dir, "--depth", "tiny"], {}, () => {}), /--depth 은 1\|2\|3/);
  const b = cap();
  run(["scan", "--repo", dir, "--depth", "brief", "--json"], {}, b.log);
  assert.equal(JSON.parse(b.text()).depth, "brief");
  const t = cap();
  run(["scan", "--repo", dir, "--depth", "full"], {}, t.log);
  assert.match(t.text(), /^full 수준:/);
  const plain = cap();
  run(["scan", "--repo", dir], {}, plain.log);
  assert.ok(plain.text().startsWith("# nacholens scan"), "no --depth: the scan output is unchanged");
});

test("scan brief shows fewer leads per section than full, --limit still wins", () => {
  const dir = join(tmp(), "r");
  mkdirSync(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  writeFileSync(join(dir, "routes.js"), Array.from({ length: 50 }, (_, i) => `app.get("/r${i}", h);`).join("\n") + "\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  const n = (args) => { const c = cap(); run(["scan", "--repo", dir, "--json", ...args], {}, c.log); return JSON.parse(c.text()).routes.length; };
  assert.equal(n(["--depth", "brief"]), 25);
  assert.equal(n(["--depth", "full"]), 50);
  assert.equal(n([]), 50);
  assert.equal(n(["--depth", "brief", "--limit", "40"]), 40);
});

/* ───────── version, docs and the package ───────── */
test("0.3.2 everywhere it must be: package.json, CHANGELOG, CLI --version, the installed copy, the issue template", () => {
  const pkg = readJson("package.json");
  assert.equal(pkg.version, "0.3.2");
  assert.match(readFileSync(join(root, "CHANGELOG.md"), "utf8"), /^# Changelog\n\n## 0\.3\.2\n/);
  const c = cap();
  assert.equal(run(["--version"], {}, c.log), EXIT.OK);
  assert.equal(c.text(), "0.3.2");
  assert.equal(run(["version"], {}, () => {}), EXIT.OK);
  assert.match(readFileSync(join(root, ".github/ISSUE_TEMPLATE/bug_report.yml"), "utf8"), /placeholder: "0\.3\.2, /);
  // `install` vendors the version and a playbook that explains the depths
  const proj = tmp();
  assert.equal(run(["install", "--agents", "--into", proj], {}, () => {}), EXIT.OK);
  assert.equal(readFileSync(join(proj, ".nacholens/cli/VERSION"), "utf8").trim(), "0.3.2");
  assert.equal(JSON.parse(readFileSync(join(proj, ".nacholens/cli/package.json"), "utf8")).version, "0.3.2");
  const installedCli = join(proj, ".nacholens/cli/src/cli.js");
  assert.equal(execFileSync(process.execPath, [installedCli, "--version"], { encoding: "utf8" }).trim(), "0.3.2");
  const skill = readFileSync(join(proj, ".nacholens/SKILL.md"), "utf8");
  assert.match(skill, /nacholens ≥ 0\.3\.2/);
  assert.match(skill, /Pick the depth first/);
  // the installed CLI knows --depth: it validates a bundled demo model with a flag
  const out = execFileSync(process.execPath, [installedCli, "validate", join(proj, ".nacholens/cli/models/demo-shop/model.json"), "--depth", "full"], { encoding: "utf8" });
  assert.match(out, /깊이 3 · 자세히 \(full\)/);
});

test("SKILL.md explains the choice (default included), the content of each depth, size guides and a procedure per depth", () => {
  const s = readFileSync(join(root, "skills/nacholens/SKILL.md"), "utf8");
  assert.match(s, /^version: 1\.4\.0$/m);
  assert.match(s, /## 0\.1 Pick the depth first/);
  assert.match(s, /Say it to the user as depth 1 \/ 2 \/ 3, never as the technical name/);
  for (const d of DEPTHS) {
    assert.match(s, new RegExp(`\\| \`${d}\` \\|`), `${d} row in the table`);
    assert.match(s, new RegExp(`\\*\\*${d}\\*\\* — `), `${d} procedure`);
  }
  assert.match(s, /Size guide/);
  assert.match(s, /\*\*Still unclear: do not stop to ask\.\*\*/);
  assert.match(s, /Use `diff` when there is a ref range to compare, otherwise `brief`/);
  assert.match(s, /scan --repo R --depth diff --base B/);
  assert.match(s, /`depth`, `depthWarnings`/);
});

test("every README copy block gets one depth line (all three levels named); the guides compare the levels and show commands", () => {
  for (const l of ["", ".ja", ".de", ".fr", ".zh", ".ko"]) {
    const md = readFileSync(join(root, `README${l}.md`), "utf8");
    const block = /```text\n([^]*?)```/.exec(md)[1];
    const depthLines = block.split("\n").filter((x) => /(^|\D)1\D.*\D2\D.*\D3(\D|$)/.test(x) && !/diff|brief|full/.test(x));
    assert.equal(depthLines.length, 1, `README${l}.md: one depth line in the block`);
    assert.ok(block.indexOf(depthLines[0]) > block.indexOf("<"), `README${l}.md: after the request line`);
    assert.ok(md.length < 4000, `README${l}.md stays short`);
  }
  for (const f of ["docs/guide.md", "docs/guide.ko.md"]) {
    const t = readFileSync(join(root, f), "utf8");
    assert.match(t, /\(`diff`\) \| \*\*2 · (Overview|한눈에)\*\* \(`brief`\) \| \*\*3 · (Detailed|자세히)\*\* \(`full`\) \|/, f);
    for (const cmd of ["scan --repo ~/work/my-api --depth diff --base main", "--depth brief", "--depth full"]) assert.ok(t.includes(cmd), `${f}: ${cmd}`);
  }
  assert.match(readFileSync(join(root, "docs/model-schema.md"), "utf8"), /## Optional `depth` \(collection depth\)/);
});

test("npm pack ships everything depth needs (sources, models, changelog, skill, guides) and no tests or scripts", () => {
  const out = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" }));
  const files = new Set(out[0].files.map((f) => f.path));
  for (const f of ["src/depth.js", "src/scan.js", "src/cli.js", "src/install.js", "CHANGELOG.md", "skills/nacholens/SKILL.md", "models/demo-shop/model.json", "models/demo-shop/model.brief.json", "models/demo-shop/model.diff.json", "docs/guide.md", "docs/guide.ko.md", "docs/model-schema.md", "package.json"])
    assert.ok(files.has(f), `package is missing ${f}`);
  assert.ok([...files].every((f) => !f.startsWith("test/")), "no tests in the package");
  assert.equal(out[0].version, "0.3.2");
  // every relative import of a shipped source file is shipped too
  for (const f of files) {
    if (!/^src\/[^/]+\.js$/.test(f)) continue;
    for (const m of readFileSync(join(root, f), "utf8").matchAll(/from "\.\/([^"]+\.js)"/g)) assert.ok(files.has(`src/${m[1]}`), `${f} imports ${m[1]}`);
  }
});

/* ───────── depth 1 / 2 / 3 ───────── */
test("depth 1|2|3 are the same as diff|brief|full: normalised everywhere, names and numbers mix, anything else is a usage error", () => {
  assert.deepEqual(["1", "2", "3", 1, " 2 ", "DIFF", "Brief", "full"].map(normalizeDepth), ["diff", "brief", "full", "diff", "brief", "diff", "brief", "full"]);
  assert.equal(normalizeDepth(undefined), undefined);
  for (const bad of ["0", "4", "deep", "", "1,2"]) assert.throws(() => normalizeDepth(bad), /--depth 은 1\|2\|3/, bad);
  assert.equal(depthName("brief"), "깊이 2 · 한눈에 (brief)");
  assert.equal(resolveDepth({ ...tiny(), depth: "brief" }, "2").error, null, "2 agrees with a model that declares brief");
  assert.match(resolveDepth({ ...tiny(), depth: "brief" }, "3").error, /"brief".*--depth full/, "3 contradicts it");
});

test("CLI: --depth 2 behaves exactly like --depth brief; the stored depth in report.json is the name; help names the numbers", () => {
  const f = join(tmp(), "m.json");
  writeFileSync(f, JSON.stringify(tiny()));
  const a = cap(), b = cap();
  assert.equal(run(["validate", f, "--depth", "2"], {}, a.log), EXIT.OK);
  assert.equal(run(["validate", f, "--depth", "brief"], {}, b.log), EXIT.OK);
  assert.equal(a.text(), b.text());
  assert.match(a.text(), /깊이 2 · 한눈에 \(brief\)/);
  const { dir, base } = demoRepo();
  const out = join(tmp(), "out");
  assert.equal(run(["build", "--repo", dir, "--model", join(root, "models/demo-shop/model.brief.json"), "--base", base, "--out", out, "--depth", "2"], {}, () => {}), EXIT.OK);
  assert.equal(JSON.parse(readFileSync(join(out, "report.json"), "utf8")).depth, "brief");
  const m = cap();
  assert.equal(run(["validate", join(root, "models/demo-shop/model.brief.json"), "--depth", "3"], {}, m.log), EXIT.MODEL);
  assert.match(m.text(), /--depth full/);
  const s = cap();
  run(["scan", "--repo", dir, "--depth", "1", "--base", base, "--json"], {}, s.log);
  assert.equal(JSON.parse(s.text()).depth, "diff");
  const g = cap();
  run(["scan", "--repo", dir, "--depth", "3"], {}, g.log);
  assert.match(g.text(), /^full 수준:/);
  assert.throws(() => run(["validate", f, "--depth", "4"], {}, () => {}), /--depth 은 1\|2\|3/);
  const u = cap();
  run(["help"], {}, u.log);
  assert.match(u.text(), /--depth 1\|2\|3 {2}또는 {2}diff\|brief\|full/);
  assert.match(u.text(), /1 변경만 \(diff\).*얕다는 뜻이 아니라/);
});

test("Node baseline: CI runs 20, 22 and 24 with a pinned setup-node, publish uses 24, engines stays >=20, the docs say 20+ and checked on 24", () => {
  const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /node: \["20", "22", "24"\]/);
  assert.match(ci, /actions\/setup-node@[0-9a-f]{40} # v/, "setup-node stays pinned to a commit");
  const publish = readFileSync(join(root, ".github/workflows/publish.yml"), "utf8");
  assert.match(publish, /node-version: "24"/);
  assert.match(publish, /actions\/setup-node@[0-9a-f]{40} # v/);
  assert.equal(readJson("package.json").engines.node, ">=20");
  for (const f of ["README.md", "README.ko.md", "README.ja.md", "README.de.md", "README.fr.md", "README.zh.md", "docs/guide.md", "docs/guide.ko.md", "skills/nacholens/SKILL.md", "CONTRIBUTING.md"])
    assert.match(readFileSync(join(root, f), "utf8"), /Node(\.js)?[ ≥>=]*20.{0,40}24|Node 24.{0,40}20|20.{0,30}Node 24|Node\.js 20.{0,40}Node 24/s, `${f} names the baseline 20 and the checked 24`);
  assert.match(readFileSync(join(root, "CHANGELOG.md"), "utf8"), /Node 20, 22 and 24/);
});
