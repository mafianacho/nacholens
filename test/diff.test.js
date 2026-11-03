import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { parseDiff, makeMapper, generateOverlay, overlayFromRepo, ignoreReason, unmappedCategory } from "../src/diff.js";
import { openRepo, checkRef } from "../src/gitio.js";
import { validateModel, validateChanges } from "../src/model.js";
import { makeTemplate } from "../src/template.js";
import { scanRepo } from "../src/scan.js";
import { makeDemoRepo } from "../src/demo.js";
import { run, EXIT } from "../src/cli.js";
import { demoModel, readJson, root, tiny, clone } from "./helpers.js";

// ---------- helpers: a real throwaway git repo ----------
const sh = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
function newRepo() {
  const dir = mkdtempSync(join(tmpdir(), "sv-repo-"));
  sh(dir, "init", "-q", "-b", "main");
  return dir;
}
function put(dir, file, text) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
}
function commit(dir, msg) {
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", msg);
  return sh(dir, "rev-parse", "HEAD");
}
const lines = (n, f = (i) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";
const ev = (file, a, b) => [{ file, lines: [a, b] }];
const ev2 = (file, r) => [{ file, lines: r }];

/** model whose evidence lives in src/api.js and src/db.js */
function modelFor(commit, over = {}) {
  const m = tiny();
  m.source.commit = commit;
  m.components[0].evidence = ev("src/web.js", 1, 3);
  m.components[1].evidence = ev("src/gw.js", 1, 3);
  m.components[2].evidence = ev("src/api.js", 1, 2);
  m.components[3].evidence = ev("src/db.js", 1, 2);
  m.links.forEach((l) => (l.evidence = ev("src/gw.js", 1, 3)));
  const [s1, s2, s3, s4] = m.useCases[0].steps;
  s1.evidence = ev2("src/api.js", over.s1 ?? [6, 7]);
  s2.evidence = ev("src/db.js", 3, 6);
  s3.evidence = ev("src/api.js", 9, 10);
  s4.evidence = ev("src/gw.js", 1, 3);
  return m;
}

test("parseDiff: statuses, hunks, and a removed line starting with '-- ' is not a file header", () => {
  const text = [
    "diff --git a/a.sql b/a.sql",
    "index 1..2 100644",
    "--- a/a.sql",
    "+++ b/a.sql",
    "@@ -3,2 +3,2 @@",
    "--- a/old", // a removed line whose content is "-- a/old" (looks like a file header)
    "-second removed",
    "+++ b/evil.js", // an added line whose content is "++ b/evil.js"
    "+replacement",
    "diff --git a/new.js b/new.js",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new.js",
    "@@ -0,0 +1,3 @@",
    "+a", "+b", "+c",
    "diff --git a/gone.js b/gone.js",
    "deleted file mode 100644",
    "--- a/gone.js",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-x", "-y",
    "diff --git a/img.bin b/img.bin",
    "Binary files a/img.bin and b/img.bin differ",
    "",
  ].join("\n");
  const f = parseDiff(text);
  assert.deepEqual(f.map((x) => [x.path, x.status, x.hunks.length]), [["a.sql", "M", 1], ["new.js", "A", 1], ["gone.js", "D", 1], ["img.bin", "M", 0]]);
  assert.equal(f[3].binary, true);
  assert.deepEqual(f[0].hunks[0], { oldStart: 3, oldCount: 2, newStart: 3, newCount: 2 });
  assert.deepEqual(f[1].hunks[0], { oldStart: 0, oldCount: 0, newStart: 1, newCount: 3 });
});

test("makeMapper: shifts lines across insertions/deletions, maps inside replaced hunks to the new region", () => {
  const map = makeMapper([
    { oldStart: 2, oldCount: 0, newStart: 3, newCount: 5 }, // 5 lines inserted after old line 2
    { oldStart: 10, oldCount: 2, newStart: 15, newCount: 1 }, // old 10-11 replaced by new 15
    { oldStart: 20, oldCount: 3, newStart: 23, newCount: 0 }, // old 20-22 deleted
  ]);
  assert.deepEqual(map([1, 2]), [1, 2]);
  assert.deepEqual(map([3, 3]), [8, 8]);
  assert.deepEqual(map([5, 9]), [10, 14]);
  assert.deepEqual(map([10, 11]), [15, 15]);
  assert.deepEqual(map([12, 12]), [16, 16]);
  assert.deepEqual(map([21, 21]), [23, 24]);
  assert.deepEqual(map([25, 25]), [25 + 5 - 1 - 3, 25 + 5 - 1 - 3]);
});

test("ignoreReason: tests, docs, lockfiles are named; source is not ignored", () => {
  assert.equal(ignoreReason("apps/server/tests/x.ts"), "test");
  assert.equal(ignoreReason("src/a.test.tsx"), "test");
  assert.equal(ignoreReason("README.md"), "docs");
  assert.equal(ignoreReason("package-lock.json"), "lockfile");
  assert.equal(ignoreReason("src/api.js"), null);
  assert.equal(ignoreReason(".github/workflows/ci.yml"), null);
});

test("end to end on a real git repo: changed/added steps, endpoint components, unmapped and ignored files", () => {
  const dir = newRepo();
  put(dir, "src/api.js", lines(12));
  put(dir, "src/db.js", lines(4));
  put(dir, "src/gw.js", lines(3));
  put(dir, "src/web.js", lines(3));
  put(dir, "src/other.js", lines(5));
  put(dir, "docs/notes.md", "n\n");
  const base = commit(dir, "base");
  put(dir, "src/api.js", lines(12, (i) => (i === 6 ? "line 6 CHANGED" : `line ${i}`))); // inside s1 evidence 6-7
  put(dir, "src/db.js", lines(4) + lines(3, (i) => `new ${i}`)); // appends lines 5-7 (s2 evidence 3-6 is only partly new)
  put(dir, "src/other.js", lines(5, (i) => `x${i}`)); // no evidence anywhere
  put(dir, "docs/notes.md", "changed\n");
  const head = commit(dir, "feat: change api and db");
  const model = modelFor(head);
  assert.deepEqual(validateModel(model), []);
  const { overlay, warnings } = overlayFromRepo(openRepo(dir), model, base, head);
  assert.deepEqual(warnings, []);
  assert.deepEqual(validateChanges(overlay, model), []);
  assert.deepEqual(overlay.steps.map((s) => `${s.step}:${s.change}`), ["s1:modified", "s2:modified"]);
  // s1 is api->... endpoints web/api (client,service) ; s2 is api->db: db is a datastore and is never marked from a step
  assert.deepEqual(overlay.components.map((c) => c.id), ["web", "api"]);
  assert.deepEqual(overlay.unmapped.map((u) => u.file), ["src/other.js"]);
  assert.match(overlay.unmapped[0].hint, /add the path to the model/);
  assert.deepEqual(overlay.ignored, [{ file: "docs/notes.md", reason: "docs" }]);
  assert.equal(overlay.title, "feat: change api and db");
  assert.equal(overlay.generated.lineTranslation, false);
  assert.ok(overlay.ref.includes(base.slice(0, 7)) && overlay.ref.includes(head.slice(0, 7)));
});

test("kinds: 'added' only when every evidence range is wholly new code; deleted file -> 'removed'", () => {
  const dir = newRepo();
  put(dir, "src/api.js", lines(5));
  put(dir, "src/gone.js", lines(4));
  const base = commit(dir, "base");
  put(dir, "src/api.js", lines(5) + lines(6, (i) => `fresh ${i}`)); // lines 6-11 are brand new
  rmSync(join(dir, "src/gone.js"));
  const head = commit(dir, "grow api, drop gone");
  const m = tiny();
  m.source.commit = head;
  m.components.forEach((c) => (c.evidence = ev("src/api.js", 1, 2)));
  m.links.forEach((l) => (l.evidence = ev("src/api.js", 1, 2)));
  const [s1, s2, s3, s4] = m.useCases[0].steps;
  s1.evidence = ev("src/api.js", 6, 9); // wholly inside the new block
  s2.evidence = [...ev("src/api.js", 6, 9), ...ev("src/api.js", 1, 2)]; // mixes new and untouched code
  s3.evidence = ev("src/api.js", 1, 2); // untouched
  s4.evidence = ev("src/api.js", 1, 2);
  const o = overlayFromRepo(openRepo(dir), m, base, head).overlay;
  const kinds = Object.fromEntries(o.steps.map((s) => [s.step, s.change]));
  assert.deepEqual(kinds, { s1: "added", s2: "modified" });
  // deleted file: model pinned to base, where the file still exists
  const m2 = tiny();
  m2.source.commit = base;
  m2.components.forEach((c) => (c.evidence = ev("src/api.js", 1, 2)));
  m2.links.forEach((l) => (l.evidence = ev("src/api.js", 1, 2)));
  m2.useCases[0].steps.forEach((s) => (s.evidence = ev("src/api.js", 1, 2)));
  m2.useCases[0].steps[1].evidence = ev("src/gone.js", 1, 4);
  const o2 = overlayFromRepo(openRepo(dir), m2, base, head).overlay;
  assert.equal(o2.steps.find((s) => s.step === "s2").change, "removed");
  assert.equal(o2.generated.lineTranslation, true);
});

test("line translation: model pinned to a LATER commit still matches a change made earlier", () => {
  const dir = newRepo();
  put(dir, "src/api.js", lines(12));
  const base = commit(dir, "base");
  put(dir, "src/api.js", lines(12, (i) => (i === 6 ? "line 6 CHANGED" : `line ${i}`)));
  const head = commit(dir, "change line 6");
  put(dir, "src/api.js", lines(5, (i) => `header ${i}`) + lines(12, (i) => (i === 6 ? "line 6 CHANGED" : `line ${i}`)));
  const later = commit(dir, "insert 5 header lines (shifts everything by 5)");
  const m = modelFor(later);
  m.useCases[0].steps[0].evidence = ev("src/api.js", 11, 12); // old 6-7, now 11-12
  m.components.forEach((c) => (c.evidence = ev("src/api.js", 1, 2)));
  m.links.forEach((l) => (l.evidence = ev("src/api.js", 1, 2)));
  m.useCases[0].steps.slice(1).forEach((s) => (s.evidence = ev("src/api.js", 1, 2)));
  const o = overlayFromRepo(openRepo(dir), m, base, head).overlay;
  assert.equal(o.generated.lineTranslation, true);
  assert.deepEqual(o.steps.map((s) => s.step), ["s1"]);
  assert.deepEqual(o.unmapped, []);
  // control: the same evidence at the wrong (untranslated) numbers would have missed it
  const stale = clone(m);
  stale.useCases[0].steps[0].evidence = ev("src/api.js", 6, 7);
  stale.source.commit = head;
  const o2 = overlayFromRepo(openRepo(dir), stale, base, head).overlay;
  assert.deepEqual(o2.steps.map((s) => s.step), ["s1"], "when model==head no translation is needed");
});

test("overlay is deterministic and an empty diff yields an empty, valid overlay", () => {
  const dir = newRepo();
  put(dir, "src/api.js", lines(12));
  const a = commit(dir, "a");
  put(dir, "src/api.js", lines(12) + "x\n");
  const b = commit(dir, "b");
  const m = modelFor(b);
  const repo = openRepo(dir);
  const one = overlayFromRepo(repo, m, a, b).overlay;
  assert.deepEqual(one, overlayFromRepo(repo, m, a, b).overlay);
  const none = overlayFromRepo(repo, m, b, b).overlay;
  assert.deepEqual([none.components, none.steps, none.unmapped, none.ignored], [[], [], [], []]);
  assert.deepEqual(validateChanges(none, m), []);
});

test("refs are validated: option-looking values and ranges are refused", () => {
  for (const bad of ["--output=/tmp/x", "-p", "a..b", "a b", "", "x;y"]) assert.throws(() => checkRef(bad), /올바르지/, bad);
  for (const ok of ["HEAD", "HEAD~1", "origin/main", "4985b2a^", "v1.2.3", "feat/x-y"]) assert.equal(checkRef(ok), ok);
  const dir = newRepo();
  put(dir, "a", "1\n");
  commit(dir, "a");
  assert.throws(() => openRepo(dir).resolve("nope"), /찾을 수 없습니다/);
  assert.throws(() => openRepo(join(dir, "missing")), /없습니다/);
});

test("template: every unfilled value is reported with its JSON path; nothing else is wrong", () => {
  const t = makeTemplate({ slug: null, commit: "abc1234", name: "My Shop" });
  assert.equal(t.product.id, "my-shop");
  const errors = validateModel(t);
  assert.ok(errors.length >= 20);
  assert.ok(errors.every((e) => e.includes("채워 주세요")), JSON.stringify(errors.filter((e) => !e.includes("채워 주세요"))));
  assert.ok(errors.some((e) => e.startsWith("model.components[0].evidence[0].file:")));
  assert.ok(errors.some((e) => e.startsWith("model.useCases[0].steps[1].narration:")));
  // replacing every TODO makes it valid
  const fixed = JSON.parse(JSON.stringify(t).replace(/"TODO[^"]*"/g, '"filled"'));
  fixed.product.id = "my-shop";
  fixed.source.repo = "o/r";
  fixed.useCases[0].trigger = "GET /x";
  assert.deepEqual(validateModel(fixed), []);
});

test("scan: finds routes, config files, outbound hosts and data access as leads", () => {
  const dir = newRepo();
  put(dir, "wrangler.jsonc", "{}\n");
  put(dir, "src/app.ts", [
    "const app = new Hono();",
    'app.get("/api/items", async (c) => {',
    '  const r = await c.env.DB.prepare("SELECT * FROM items").all();',
    '  await fetch("https://api.stripe.com/v1/charges");',
    "});",
  ].join("\n") + "\n");
  put(dir, "tests/app.test.ts", 'app.get("/hidden-in-tests", () => {})\n');
  commit(dir, "x");
  const r = scanRepo(dir);
  assert.ok(r.configs.some((c) => c.file === "wrangler.jsonc"));
  assert.ok(r.routes.some((x) => x.file === "src/app.ts" && x.line === 2));
  assert.ok(!r.routes.some((x) => x.file.startsWith("tests/")));
  assert.ok(r.outbound.some((x) => x.host === "api.stripe.com"));
  assert.ok(r.data.some((x) => x.file === "src/app.ts" && x.line === 3));
});

// ---------- CLI ----------
const cap = () => { const l = []; return { l, log: (s) => l.push(s), text: () => l.join("\n") }; };
const mkOut = () => mkdtempSync(join(tmpdir(), "sv-out-"));

test("CLI build --repo on a repo with no model: template created, exit 1, checklist printed, repo untouched", () => {
  const dir = newRepo();
  put(dir, "src/app.js", "x\n");
  commit(dir, "init");
  const out = mkOut();
  const c = cap();
  const rc = run(["build", "--repo", dir, "--out", out], {}, c.log);
  assert.equal(rc, EXIT.MODEL);
  assert.ok(existsSync(join(dir, ".nacholens/model.json")), "template written at the conventional path");
  assert.match(c.text(), /빈 템플릿/);
  assert.match(c.text(), /채워야 할 곳이 \d+개/);
  assert.match(c.text(), /components\[0\]\.evidence\[0\]\.file/);
  assert.deepEqual(readdirSync(out), [], "no output is produced from an unfilled template");
  // second run: same guidance, still exit 1, template not overwritten
  const before = readFileSync(join(dir, ".nacholens/model.json"), "utf8");
  assert.equal(run(["build", "--repo", dir, "--out", out], {}, () => {}), EXIT.MODEL);
  assert.equal(readFileSync(join(dir, ".nacholens/model.json"), "utf8"), before);
  // validate says where to write too
  const v = cap();
  assert.equal(run(["validate", "--repo", dir], {}, v.log), EXIT.MODEL);
  assert.match(v.text(), /TODO|채워/);
});

test("CLI build --repo --base: outputs, report.json, exit codes (0, 1 on stale evidence, 3 with --strict), repo untouched", () => {
  const dir = newRepo();
  put(dir, "src/api.js", lines(12));
  put(dir, "src/db.js", lines(6));
  put(dir, "src/gw.js", lines(3));
  put(dir, "src/web.js", lines(3));
  put(dir, "src/extra.js", lines(3));
  const base = commit(dir, "base");
  put(dir, "src/api.js", lines(12, (i) => (i === 6 ? "CHANGED" : `line ${i}`)));
  put(dir, "src/extra.js", lines(3, (i) => `new ${i}`));
  const head = commit(dir, "change");
  const modelDir = mkdtempSync(join(tmpdir(), "sv-model-"));
  const modelFile = join(modelDir, "model.json");
  writeFileSync(modelFile, JSON.stringify(modelFor(head)));
  const out = mkOut(), c = cap();
  assert.equal(run(["build", "--repo", dir, "--model", modelFile, "--base", base, "--head", head, "--out", out], {}, c.log), EXIT.OK);
  assert.deepEqual(readdirSync(out).sort(), ["changes.json", "report.json", "review.json", "tiny.html"]);
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  assert.equal(report.ok, true);
  assert.deepEqual(report.changedSteps, ["uc/s1"]);
  assert.deepEqual(report.unmapped.map((u) => u.file), ["src/extra.js"]);
  assert.match(c.text(), /모델에 없는 변경\s+src\/extra\.js/);
  assert.equal(sh(dir, "status", "--porcelain"), "", "the analysed repo is never written to");
  const html = readFileSync(join(out, "tiny.html"), "utf8");
  assert.match(html, /"unmapped":\[\{"file":"src\/extra\.js"/);
  // agent routing + strict
  const out2 = mkOut();
  assert.equal(run(["build", "--repo", dir, "--model", modelFile, "--base", base, "--head", head, "--out", out2, "--agent", "claude", "--strict"], {}, () => {}), EXIT.STRICT);
  assert.ok(readdirSync(out2).includes("tiny.artifact.html"));
  // evidence that no longer matches the pinned commit -> exit 1, nothing written
  const bad = modelFor(head);
  bad.components[0].evidence = [{ file: "src/web.js", lines: [1, 3], contains: "text that is not there" }];
  writeFileSync(modelFile, JSON.stringify(bad));
  const out3 = mkOut(), d = cap();
  assert.equal(run(["build", "--repo", dir, "--model", modelFile, "--base", base, "--out", out3], {}, d.log), EXIT.MODEL);
  assert.match(d.text(), /없음/);
  assert.deepEqual(readdirSync(out3), []);
  // bad ref -> thrown (cli main maps to exit 2)
  writeFileSync(modelFile, JSON.stringify(modelFor(head)));
  assert.throws(() => run(["build", "--repo", dir, "--model", modelFile, "--base", "does-not-exist", "--out", mkOut()], {}, () => {}), /찾을 수 없습니다/);
});

test("CLI diff and verify --repo (no checkout needed)", () => {
  const dir = newRepo();
  put(dir, "src/api.js", lines(12));
  put(dir, "src/db.js", lines(6));
  put(dir, "src/gw.js", lines(3));
  put(dir, "src/web.js", lines(3));
  const base = commit(dir, "base");
  put(dir, "src/db.js", lines(6, (i) => `d${i}`));
  const head = commit(dir, "db");
  const modelFile = join(mkdtempSync(join(tmpdir(), "sv-model-")), "m.json");
  writeFileSync(modelFile, JSON.stringify(modelFor(head)));
  const c = cap();
  assert.equal(run(["verify", "--repo", dir, "--model", modelFile], {}, c.log), EXIT.OK);
  assert.match(c.text(), /근거 \d+건 모두 소스와 일치/);
  const f = join(mkOut(), "changes.json");
  assert.equal(run(["diff", "--repo", dir, "--model", modelFile, "--base", base, "--out", f], {}, () => {}), EXIT.OK);
  const o = JSON.parse(readFileSync(f, "utf8"));
  assert.deepEqual(o.steps.map((s) => s.step), ["s2"]);
});

test("demo repo (v1 -> v2): auto overlay equals the committed auto file and agrees with the hand-written example", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "sv-demo-")), "repo");
  const { base, head } = makeDemoRepo(dir);
  const { overlay } = overlayFromRepo(openRepo(dir), demoModel(), base, head);
  assert.deepEqual(overlay, readJson("models/demo-shop/changes.auto.json"), "regenerate: node src/cli.js demo, or see docs");
  const manual = readJson("models/demo-shop/changes.example.json");
  assert.deepEqual(overlay.components.map((c) => `${c.id}:${c.change}`).sort(), manual.components.map((c) => `${c.id}:${c.change}`).sort());
  assert.deepEqual(overlay.steps.map((x) => `${x.useCase}/${x.step}:${x.change}`).sort(), manual.steps.map((x) => `${x.useCase}/${x.step}:${x.change}`).sort());
  // the warning the demo exists to show: one code file no step cites, one stylesheet set aside, README ignored
  assert.deepEqual(overlay.unmapped.map((u) => [u.file, u.category]), [["public/format.js", "code"], ["public/styles.css", "style"]]);
  assert.deepEqual(overlay.ignored.map((i) => i.file), ["README.md"]);
});

test("committed changes.auto.json is a valid overlay for the committed model", () => {
  assert.deepEqual(validateChanges(readJson("models/demo-shop/changes.auto.json"), demoModel()), []);
});

test("unmapped files carry a category: stylesheets are 'style', everything else 'code'; --strict ignores style-only", () => {
  const dir = newRepo();
  put(dir, "src/api.js", lines(12));
  put(dir, "src/db.js", lines(6));
  put(dir, "src/gw.js", lines(3));
  put(dir, "src/web.js", lines(3));
  put(dir, "web/app.css", "a{}\n");
  put(dir, "src/extra.js", lines(3));
  const base = commit(dir, "base");
  put(dir, "web/app.css", "a{color:red}\n");
  const head1 = commit(dir, "css only");
  const modelFile = join(mkdtempSync(join(tmpdir(), "sv-model-")), "m.json");
  writeFileSync(modelFile, JSON.stringify(modelFor(head1)));
  const o1 = overlayFromRepo(openRepo(dir), JSON.parse(readFileSync(modelFile, "utf8")), base, head1).overlay;
  assert.deepEqual(o1.unmapped.map((u) => [u.file, u.category]), [["web/app.css", "style"]]);
  assert.deepEqual(validateChanges(o1, modelFor(head1)), []);
  // style-only unmapped must not trip --strict; a code file must
  assert.equal(run(["diff", "--repo", dir, "--model", modelFile, "--base", base, "--head", head1, "--out", join(mkOut(), "c.json"), "--strict"], {}, () => {}), EXIT.OK);
  put(dir, "src/extra.js", lines(3, (i) => `n${i}`));
  const head2 = commit(dir, "code too");
  writeFileSync(modelFile, JSON.stringify(modelFor(head2)));
  const l = cap();
  assert.equal(run(["diff", "--repo", dir, "--model", modelFile, "--base", base, "--head", head2, "--out", join(mkOut(), "c.json"), "--strict"], {}, l.log), EXIT.STRICT);
  assert.match(l.text(), /코드 1/);
  assert.match(l.text(), /스타일·설정 1/);
});

test("dependency manifests, CI workflows and more lock files: lock files are ignored, manifests/CI are soft 'config' (found by running the skill on a FastAPI dependency bump)", () => {
  for (const f of ["uv.lock", "Pipfile.lock", "pdm.lock", "composer.lock", "bun.lockb", "flake.lock", "deno.lock"]) assert.ok(ignoreReason(f), f);
  for (const f of ["pyproject.toml", "backend/pyproject.toml", "requirements.txt", "requirements-dev.txt", "go.mod", "Cargo.toml", "package.json", ".github/workflows/ci.yml", ".github/dependabot.yml", ".pre-commit-config.yaml", ".gitlab-ci.yml"]) {
    assert.equal(ignoreReason(f), null, `${f} is not silently ignored`);
    assert.equal(unmappedCategory(f), "config", f);
  }
  for (const f of ["src/app.py", "docker-compose.yml", "Dockerfile", "nginx.conf", "wrangler.toml", "web/app.css"]) assert.notEqual(unmappedCategory(f), "config", f);
  assert.equal(unmappedCategory("web/app.css"), "style");
  assert.deepEqual(validateChanges({ title: "t", summary: "s", ref: "r", components: [], steps: [], unmapped: [{ file: "pyproject.toml", status: "modified", lines: "1", hint: "h", category: "config" }] }, modelFor("x")), []);
});
