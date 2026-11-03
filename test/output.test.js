import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPage, safeJson, formatForAgent, artifactManifest } from "../src/page.js";
import { verifyEvidence } from "../src/verify.js";
import { run } from "../src/cli.js";
import { demoModel, demoChanges, demoAutoChanges, tiny, clone, root } from "./helpers.js";
import { makeDemoRepo } from "../src/demo.js";
import { validateModel } from "../src/model.js";
import { buildReview } from "../src/review.js";

const tmp = () => mkdtempSync(join(tmpdir(), "nacholens-"));

test("safeJson cannot close the script element or open an HTML comment", () => {
  const out = safeJson({ x: "</script><!--<img src=x onerror=alert(1)>&" });
  assert.ok(!out.includes("</script"));
  assert.ok(!out.includes("<!--"));
  assert.ok(!out.includes("<"));
  assert.equal(JSON.parse(out).x, "</script><!--<img src=x onerror=alert(1)>&");
});

test("hostile model text round-trips as data and never becomes markup", () => {
  const m = tiny();
  m.product.name = "</title><script>alert(1)</script>";
  m.components[0].detail = "$& $1 {{JS}} </script>";
  const html = buildPage(m);
  assert.equal((html.match(/<script/g) ?? []).length, 5, "only the five template scripts exist");
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(html.includes("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; · Nacholens"));
  const embedded = /<script type="application\/json" id="sv-model">([^]*?)<\/script>/.exec(html)[1];
  assert.equal(JSON.parse(embedded).components[0].detail, "$& $1 {{JS}} </script>");
});

test("the player renders model text with textContent only (no HTML sinks)", () => {
  for (const file of ["src/player/player.js", "src/player/review.js"]) {
    const js = readFileSync(join(root, file), "utf8");
    for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"])
      assert.ok(!js.includes(sink), `${file}: forbidden sink ${sink}`);
  }
});

for (const target of ["html", "artifact"]) {
  test(`${target} output is a single offline file (no CDN, no network, no external assets)`, () => {
    const html = buildPage(demoModel(), demoChanges(), { target });
    // embedded model/changes JSON is data (it quotes source code such as fetch(...)); the check is about page code
    const code = html.replace(/<script type="application\/json"[^>]*>[^]*?<\/script>/g, "");
    for (const re of [/<link\b/i, /<script[^>]+\bsrc=/i, /<img\b/i, /<iframe\b/i, /@import/i, /\burl\((?!data:)/i, /\bfetch\(/, /XMLHttpRequest/, /\bimport\(/, /WebSocket/, /sendBeacon/])
      assert.ok(!re.test(code), `found ${re}`);
    // the only attribute-position URL is the footer's link to the maker (a link, never a fetched asset)
    const attrUrls = [...html.matchAll(/(?:src|href|action|xmlns)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(attrUrls, ["https://mafianacho.com"]);
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes(`data-target="${target}"`));
    assert.ok(Buffer.byteLength(html) < 400 * 1024, "stays a small single file");
    // the only url() values are the embedded fonts
    assert.deepEqual([...code.matchAll(/\burl\(([a-z0-9/+;:-]{0,40})/gi)].map((m) => m[1].split(";")[0]), Array(7).fill("data:font/woff2"));
  });
}

test("both targets are built from the same model data", () => {
  const a = buildPage(demoModel(), demoChanges(), { target: "html" });
  const b = buildPage(demoModel(), demoChanges(), { target: "artifact" });
  const data = (h) => /id="sv-model">([^]*?)<\/script>/.exec(h)[1];
  assert.equal(data(a), data(b));
  assert.notEqual(a, b);
  assert.equal(a.replace(/data-target="html"/, "").replace(/content="html"/, ""), b.replace(/data-target="artifact"/, "").replace(/content="artifact"/, ""));
});

test("buildPage refuses an invalid model instead of rendering guesses", () => {
  const m = tiny();
  m.useCases[0].steps[0].evidence = [];
  assert.throws(() => buildPage(m), /model validation failed/);
  assert.throws(() => buildPage(tiny(), null, { lang: "xx" }), /lang/);
  assert.throws(() => buildPage(tiny(), null, { target: "pdf" }), /target/);
});

test("agent routing: Claude -> artifact, everything else -> html", () => {
  assert.equal(formatForAgent("claude"), "artifact");
  assert.equal(formatForAgent("Claude-Code"), "artifact");
  assert.equal(formatForAgent("claude-sonnet-5-5"), "artifact");
  for (const a of ["codex", "gemini", "opencode", "hermes", "", undefined, null]) assert.equal(formatForAgent(a), "html");
  const man = artifactManifest(demoModel(), "x.artifact.html");
  assert.equal(man.type, "text/html");
  assert.equal(man.identifier, "nacholens-demo-shop");
});

test("CLI build: --agent / env choose the format; both writes all files", () => {
  const model = join(root, "models/demo-shop/model.json");
  const changes = join(root, "models/demo-shop/changes.example.json");
  const quiet = () => {};
  let out = tmp();
  assert.equal(run(["build", model, "--changes", changes, "--out", out, "--agent", "claude"], {}, quiet), 0);
  assert.deepEqual(readdirSync(out).sort(), ["demo-shop.artifact.html", "demo-shop.artifact.json"]);
  out = tmp();
  assert.equal(run(["build", model, "--out", out, "--agent", "codex"], {}, quiet), 0);
  assert.deepEqual(readdirSync(out), ["demo-shop.html"]);
  out = tmp();
  assert.equal(run(["build", model, "--out", out], { NACHOLENS_AGENT: "claude" }, quiet), 0);
  assert.ok(existsSync(join(out, "demo-shop.artifact.html")));
  out = tmp();
  assert.equal(run(["build", model, "--out", out], {}, quiet), 0);
  assert.deepEqual(readdirSync(out), ["demo-shop.html"]);
  out = tmp();
  run(["build", model, "--out", out, "--format", "both"], {}, quiet);
  assert.equal(readdirSync(out).length, 3);
  assert.throws(() => run(["build", model, "--format", "pdf"], {}, quiet), /--format/);
});

test("CLI validate: exit 0 for a good model, 1 with messages for a bad one", () => {
  const dir = tmp();
  const bad = tiny();
  bad.useCases[0].steps[0].from = "ghost";
  const f = join(dir, "bad.json");
  writeFileSync(f, JSON.stringify(bad));
  const lines = [];
  assert.equal(run(["validate", f], {}, (l) => lines.push(l)), 1);
  assert.ok(lines.join("\n").includes("ghost") || lines.join("\n").includes("선언된 컴포넌트"));
  assert.equal(run(["validate", join(root, "models/demo-shop/model.json")], {}, () => {}), 0);
});

test("committed examples/ are exactly what the generator produces today", () => {
  const model = demoModel(), changes = demoAutoChanges();
  const review = buildReview(model, changes, { intent: JSON.parse(readFileSync(join(root, "models/demo-shop/intent.example.json"), "utf8")) });
  assert.equal(readFileSync(join(root, "examples/demo-shop.html"), "utf8"), buildPage(model, changes, { target: "html", review }), "run: npm run build:examples");
  assert.equal(readFileSync(join(root, "examples/demo-shop.artifact.html"), "utf8"), buildPage(model, changes, { target: "artifact", review }), "run: npm run build:examples");
});

test("verifyEvidence: passes on matching source, fails on every kind of drift", () => {
  const dir = tmp();
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.js"), ["one", "two needle", "three", ""].join("\n"));
  const m = tiny();
  const ev = (file, lines, contains) => [{ file, lines, ...(contains ? { contains } : {}) }];
  const withEvidence = (e) => {
    const x = clone(m);
    x.components[0].evidence = e;
    return x;
  };
  const strip = (x) => { // keep only the first component's evidence under test
    x.components.slice(1).forEach((c) => (c.evidence = ev("src/a.js", [1, 1])));
    x.links.forEach((l) => (l.evidence = ev("src/a.js", [1, 1])));
    x.useCases[0].steps.forEach((s) => (s.evidence = ev("src/a.js", [1, 1])));
    return x;
  };
  const run1 = (e) => verifyEvidence(strip(withEvidence(e)), dir);
  assert.deepEqual(run1(ev("src/a.js", [2, 2], "needle")).failures, []);
  assert.match(run1(ev("src/missing.js", [1, 1])).failures[0], /파일 없음/);
  assert.match(run1(ev("src/a.js", [1, 99])).failures[0], /범위 초과/);
  assert.match(run1(ev("src/a.js", [1, 1], "needle")).failures[0], /없음/);
  assert.match(run1(ev("../outside.js", [1, 1])).failures[0], /소스 밖|파일 없음/);
});

test("the bundled demo model verifies against the demo repository that `nacholens demo` builds (no setup needed)", () => {
  const dir = join(tmp(), "repo");
  const { head } = makeDemoRepo(dir);
  assert.equal(head, demoModel().source.commit, "model.source.commit names the deterministic demo commit");
  const lines = [];
  assert.equal(run(["verify", "--repo", dir, "--model", join(root, "models/demo-shop/model.json")], {}, (l) => lines.push(l)), 0, lines.join("\n"));
  assert.match(lines.join("\n"), /근거 163건/);
});

test("SKILL.md: valid frontmatter; every CLI flag and command it mentions really exists", () => {
  const skill = readFileSync(join(root, "skills/nacholens/SKILL.md"), "utf8");
  const fm = /^---\nname: (\S+)\ndescription: (.+)\n(?:version: .+\n)?---\n/.exec(skill);
  assert.ok(fm, "frontmatter with name + description");
  assert.equal(fm[1], "nacholens");
  assert.match(fm[2], /^Use when /);
  const help = [];
  run(["help"], {}, (l) => help.push(l));
  const usage = help.join("\n");
  const flags = new Set(skill.match(/--[a-z]+/g));
  for (const f of flags) assert.ok(usage.includes(f), `SKILL.md mentions ${f} but the CLI usage does not`);
  const cmds = new Set([...skill.matchAll(/\bSV (init|scan|validate|verify|diff|build)\b/g)].map((m) => m[1]));
  assert.deepEqual([...cmds].sort(), ["build", "init", "scan", "validate", "verify"]);
  for (const c of cmds) assert.ok(usage.includes(`nacholens ${c}`), c);
  // exit-code table in SKILL.md and the guide matches the CLI constants
  const readme = readFileSync(join(root, "docs/guide.md"), "utf8");
  for (const doc of [skill, readme]) for (const code of ["| 0 |", "| 1 |", "| 2 |", "| 3 |"]) assert.ok(doc.includes(code), code);
});

test("player style is one design system: colours only as :root tokens, no coloured side bars, SVG icons instead of glyphs", () => {
  const css = readFileSync(join(root, "src/player/player.css"), "utf8");
  const rcss = readFileSync(join(root, "src/player/review.css"), "utf8");
  const tpl = readFileSync(join(root, "src/player/template.html"), "utf8");
  const js = readFileSync(join(root, "src/player/player.js"), "utf8") + readFileSync(join(root, "src/player/review.js"), "utf8");
  // token blocks: every `:root { … }` (the light tokens and the dark ones inside the prefers-color-scheme query)
  const rules = (css.replace(/:root\s*\{[^}]*\}/g, "") + rcss).replace(/\/\*[^]*?\*\//g, "");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(rules), "every colour is defined once, as a token in :root");
  assert.ok(!/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/.test(js + tpl), "no colour literals in the scripts or the template");
  for (const m of (css + rcss).matchAll(/border-left\s*:\s*([^;}]+)/gi))
    assert.ok(["0", "1px solid var(--border)"].includes(m[1].trim()), `border-left only as a neutral 1px divider (coloured side bars are not used): ${m[1]}`);
  assert.ok(!/[▶◀⏸⟲↻⚠✓✗]/u.test(tpl + js), "no glyph decorations in buttons or labels");
});

// The Nacho Combo design system (mafianacho/nachocombo Sources/NachoCombo/Brand.swift): light and dark values.
const NACHO = {
  paper: ["#FFFFFF", "#15100B"], paper2: ["#FFF7E1", "#211810"], line: ["#EBDDBF", "#3A2C1F"], ink: ["#24180D", "#F8EFDF"],
  ink2: ["#66553F", "#C7B59C"], nacho: ["#FFC43D", "#FFC43D"], "nacho-deep": ["#E48A0C", "#F5A53A"], "nacho-ink": ["#9A5A00", "#F5A53A"],
  "on-nacho": ["#2A1A0B", "#2A1A0B"], guac: ["#377F33", "#7FCB72"], salsa: ["#BE3B24", "#F38069"], board: ["#1E1610", "#1E1610"],
  board2: ["#2B2017", "#2B2017"], "board-line": ["#45352A", "#45352A"], "board-ink": ["#FFF1D2", "#FFF1D2"], "board-mute": ["#BFA889", "#BFA889"],
  "board-pick": ["#3A2A14", "#3A2A14"], "board-salsa": ["#F38069", "#F38069"], "board-guac": ["#7FCB72", "#7FCB72"], "status-off": ["#8E8E93", "#8E8E93"],
};
function tokenValues(block) { const o = {}; for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) o[m[1]] = m[2].trim().toUpperCase(); return o; }

test("player palette is the Nacho Combo design system in light and dark; player roles only reference it", () => {
  const css = readFileSync(join(root, "src/player/player.css"), "utf8").replace(/\/\*[^]*?\*\//g, "");
  const light = tokenValues(/:root\s*\{[^}]*\}/.exec(css)[0]);
  const dm = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*(:root\s*\{[^}]*\})/.exec(css);
  assert.ok(dm, "dark values come from a prefers-color-scheme query");
  const dark = { ...light, ...tokenValues(dm[1]) };
  for (const [k, [l, d]] of Object.entries(NACHO)) {
    assert.equal(light[k], l, `light --${k}`);
    assert.equal(dark[k], d, `dark --${k}`);
  }
  assert.match(css, /color-scheme:\s*light dark/);
  // the role tokens (second :root) hold no literals: every one of them is a var() or color-mix() of the palette
  const roles = [...css.matchAll(/:root\s*\{[^}]*\}/g)].map((m) => m[0]).find((b) => b.includes("--bg:"));
  assert.ok(roles && !/#[0-9a-fA-F]{3,8}\b/.test(roles), "role tokens reference the palette only");
});

test("nacho yellow is a fill only, and the page has no shadows and no pill shapes", () => {
  const all = (readFileSync(join(root, "src/player/player.css"), "utf8") + readFileSync(join(root, "src/player/review.css"), "utf8")).replace(/\/\*[^]*?\*\//g, "");
  assert.ok(!/(^|[;{\s])color\s*:\s*var\(--(accent|nacho)\)/.test(all), "nacho is never a text colour");
  for (const m of all.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) assert.ok(["var(--focus)", "none"].includes(m[1].trim()), `box-shadow only as the focus ring: ${m[1]}`);
  for (const m of all.matchAll(/([^{}]+)\{[^}]*border-radius\s*:\s*var\(--r-full\)/g)) assert.match(m[1].trim(), /^\.switch \.track/, `round ends only on the switch track: ${m[1].trim()}`);
  assert.ok(!/--(lift|float)\s*:/.test(all), "no elevation tokens");
});

test("node names are set at 14px or more (SVG units are screen px at 1:1) and captions at 11px or more", () => {
  const css = readFileSync(join(root, "src/player/player.css"), "utf8");
  const js = readFileSync(join(root, "src/player/player.js"), "utf8");
  const size = (sel) => Number(new RegExp(sel.replace(/[.]/g, "\\.") + "\\s*\\{[^}]*font-size:\\s*([\\d.]+)px").exec(css)[1]);
  for (const sel of [".nd .nm", ".it .t1", ".it.stub .t1"]) assert.ok(size(sel) >= 14, `${sel} >= 14px`);
  for (const sel of [".nd .kd", ".it .t2", ".tagtx"]) assert.ok(size(sel) >= 11, `${sel} >= 11px`);
  // the layout estimates text width with the same size it renders, or names overflow their box
  assert.match(js, /wrap2\(first\(c\.label\), p\.w - \(open \? 72 : 56\), 14\)/);
  assert.match(js, /wrap2\(r\.label, p\.w - 22, 14\)/);
});

test("fonts are embedded: seven WOFF2 subsets under their OFL names, with the licence files next to them", () => {
  const html = buildPage(demoModel(), demoChanges());
  const faces = [...html.matchAll(/@font-face\s*\{[^}]*font-family:\s*"([^"]+)";[^}]*font-weight:\s*(\d+)/g)].map((m) => m[1] + " " + m[2]);
  assert.deepEqual(faces, ["Nacho Sans 400", "Nacho Sans 500", "Nacho Sans 600", "Nacho Sans 700", "Nacho Mono 500", "Nacho Mono 600", "Anton 400"]);
  assert.match(html, /SIL Open Font License 1\.1/);
  assert.match(html, /Reserved Font Name \\?"Plex\\?"/, "the page says why the Plex subsets are renamed");
  // a subset is a Modified Version: the Reserved Font Name "Plex" is never used as a family name
  const css = readFileSync(join(root, "src/player/player.css"), "utf8");
  for (const m of (css + html).matchAll(/font-family\s*:\s*([^;}]+)/g)) assert.doesNotMatch(m[1], /plex/i, m[1]);
  assert.match(css, /--font:\s*"Nacho Sans"/); assert.match(css, /--mono:\s*"Nacho Mono"/); assert.match(css, /--sign:\s*Anton/);
  const dir = join(root, "src/player/fonts");
  for (const f of ["OFL-IBMPlex.txt", "OFL-Anton.txt", "FONTLOG.md"]) assert.ok(readFileSync(join(dir, f), "utf8").length > 200, f);
  for (const f of ["nacho-sans-400", "nacho-sans-500", "nacho-sans-600", "nacho-sans-700", "nacho-mono-500", "nacho-mono-600", "anton-400"])
    assert.equal(readFileSync(join(dir, f + ".woff2")).subarray(0, 4).toString("latin1"), "wOF2", f);
});

test("headings stay in the text face without wide tracking (Hangul set in mono or tracked reads as loose letters)", () => {
  const all = (readFileSync(join(root, "src/player/player.css"), "utf8") + readFileSync(join(root, "src/player/review.css"), "utf8")).replace(/\/\*[^]*?\*\//g, "");
  for (const sel of [".eyebrow", ".isec h2", ".gh", ".subhead", ".dtab .role", ".colh"]) {
    const rule = new RegExp("(^|[}\\s])" + sel.replace(/[.]/g, "\\.") + "\\s*\\{([^}]*)\\}").exec(all);
    assert.ok(rule, sel);
    assert.doesNotMatch(rule[2], /font-family\s*:\s*var\(--mono\)/, `${sel} not mono`);
    assert.doesNotMatch(rule[2], /letter-spacing\s*:\s*[.0-9]*[1-9]/, `${sel} no tracking`);
  }
});

test("data and operation tags are boxes, not pills, and are sized from the rendered text", () => {
  const js = readFileSync(join(root, "src/player/player.js"), "utf8");
  assert.match(js, /"xchip"[^]{0,200}height: 20, rx: 4 \}/, "data tag radius 4");
  assert.match(js, /g\.opb\.appendChild\(s\("rect", \{ y: [^}]*height: 18, rx: 4 \}/, "operation tag radius 4");
  assert.equal((js.match(/fitPad\(rc, tx,/g) ?? []).length, 3, "data, operation and change tags use the measured width");
  assert.doesNotMatch(js, /height: 20, rx: 10|height: 18, rx: 9/);
});

test("the page ends with a 'Made by Mafianacho Inc.' footer: its own grid row (no page scroll), 11px or more", () => {
  const html = buildPage(demoModel(), demoChanges());
  const foot = /<footer class="foot" id="sv-foot">([^]*?)<\/footer>/.exec(html);
  assert.ok(foot, "footer present");
  assert.match(foot[1], /<a href="https:\/\/mafianacho\.com" target="_blank" rel="noopener noreferrer">Made by Mafianacho Inc\.<\/a>/);
  assert.ok(html.indexOf("</footer>") < html.indexOf('<script type="application/json"'), "footer is the last part of the page body");
  const css = readFileSync(join(root, "src/player/player.css"), "utf8");
  assert.match(css, /\.app\s*\{[^}]*height:\s*100vh;[^}]*grid-template-rows:\s*var\(--topbar-h\) minmax\(0, 1fr\) var\(--foot-h\)/);
  assert.ok(Number(/\.foot\s*\{[^}]*font-size:\s*([\d.]+)px/.exec(css)[1]) >= 11);
});

test("the tool is called nacholens everywhere; the old name appears nowhere", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "@mafianacho/nacholens");
  assert.deepEqual(Object.keys(pkg.bin), ["nacholens"]);
  const old = new RegExp("super" + "vision", "i"); // spelled in two parts so this file does not match itself
  const hits = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isDirectory()) { if (![".git", "node_modules"].includes(e.name)) walk(f); continue; }
    if (/\.(woff2|png|ttf)$/.test(e.name)) continue;
    if (old.test(e.name)) hits.push(f);
    const txt = readFileSync(f, "utf8");
    if (old.test(txt)) hits.push(f);
  } };
  for (const d of ["src", "skills", "docs", "test", "models", "examples", "demo", ".github"]) walk(join(root, d));
  for (const f of ["package.json", "README.md", "README.ja.md", "README.de.md", "README.fr.md", "README.zh.md", "README.ko.md", "CONTRIBUTING.md", "SECURITY.md", "NOTICE"]) {
    if (old.test(readFileSync(join(root, f), "utf8"))) hits.push(f);
  }
  assert.deepEqual(hits, []);
});

test("every README is the same short page: language links, one copy-paste block for an agent with a request line, example requests", () => {
  const langs = ["", ".ja", ".de", ".fr", ".zh", ".ko"];
  const install = 'npx -y @mafianacho/nacholens@latest install --to "$HOME/.nacholens-skill" --force';
  for (const l of langs) {
    const md = readFileSync(join(root, `README${l}.md`), "utf8");
    for (const o of langs) assert.ok(o === l ? true : md.includes(`](README${o}.md)`), `README${l}.md links README${o}.md`);
    const blocks = [...md.matchAll(/```text\n([^]*?)```/g)].map((m) => m[1]);
    assert.equal(blocks.length, 1, `README${l}.md has one copy block`);
    assert.ok(blocks[0].includes(install), `README${l}.md block installs the playbook`);
    assert.ok(blocks[0].includes('"$HOME/.nacholens-skill/nacholens/SKILL.md"'), "block points at SKILL.md");
    assert.match(blocks[0], /<[^>\n]+>/, "block has a request placeholder");
    assert.ok((md.match(/^- `[^`]+`$/gm) ?? []).length >= 2, `README${l}.md lists example requests`);
    assert.ok(md.length < 4000, `README${l}.md stays short`);
    for (const m of md.matchAll(/\]\(((?!https?:)[^)#]+)\)/g)) assert.ok(existsSync(join(root, m[1])), `README${l}.md link ${m[1]}`);
  }
});

test("verify warns (exit 0) about evidence without `contains`, because line drift on such items cannot be detected", () => {
  const dir = join(tmp(), "repo");
  const { head } = makeDemoRepo(dir);
  const m = clone(demoModel());
  m.components[0].evidence = [{ file: "public/app.js", lines: [1, 3] }];
  const f = join(tmp(), "m.json");
  writeFileSync(f, JSON.stringify(m));
  const lines = [];
  assert.equal(run(["verify", "--repo", dir, "--model", f], {}, (l) => lines.push(l)), 0, lines.join("\n"));
  assert.match(lines.join("\n"), /contains 가 없는 근거 1건/);
  const clean = [];
  run(["verify", "--repo", dir, "--model", join(root, "models/demo-shop/model.json")], {}, (l) => clean.push(l));
  assert.doesNotMatch(clean.join("\n"), /contains 가 없는/);
  assert.ok(head);
});

test("change tags are fully opaque (a node-wide fill-opacity must not wash them out) and model text has no raw markdown", () => {
  const css = readFileSync(join(root, "src/player/player.css"), "utf8");
  assert.match(css, /\.tagbg\s*\{[^}]*fill-opacity:\s*1\b/, "the change tag background is opaque");
  const m = demoModel();
  const visible = [m.product.name, m.product.description, m.source.repo];
  m.components.forEach((c) => visible.push(c.label, c.detail));
  m.links.forEach((l) => visible.push(l.label));
  m.useCases.forEach((u) => { visible.push(u.title, u.summary, u.trigger); u.steps.forEach((st) => visible.push(st.label, st.narration, st.request ?? "", st.response ?? "")); });
  for (const t of visible) assert.ok(!t.includes("`"), `markdown in visible text: ${t}`);
  for (const f of ["models/demo-shop/changes.auto.json", "models/demo-shop/changes.example.json"]) assert.ok(!readFileSync(join(root, f), "utf8").includes("`"), f);
});

test("SKILL.md's minimal example model is valid against the schema (docs cannot drift from the validator)", () => {
  const md = readFileSync(join(root, "skills/nacholens/SKILL.md"), "utf8");
  const block = /### 3\.0[\s\S]*?```json\n([\s\S]*?)\n```/.exec(md);
  assert.ok(block, "example block present");
  const model = JSON.parse(block[1]);
  assert.deepEqual(validateModel(model), []);
  assert.deepEqual(model.useCases[0].steps.map((s) => s.kind), ["request", "internal", "call", "response"]);
});
