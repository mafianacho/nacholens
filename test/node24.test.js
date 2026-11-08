// Node 24 is the one supported baseline: engines, CI, publish, every document, and a clear stop on an older Node.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { nodeProblem, MIN_NODE_MAJOR } from "../src/node-check.js";
import { root, readJson } from "./helpers.js";

const text = (rel) => readFileSync(join(root, rel), "utf8");

test("an older Node gets one clear message (Korean and English) instead of a missing-feature crash", () => {
  assert.equal(MIN_NODE_MAJOR, 24);
  for (const v of ["18.20.4", "20.19.0", "22.23.2", "23.11.0"]) {
    const m = nodeProblem(v);
    assert.ok(m && m.includes(`Node 24`) && m.includes(`v${v}`) && /필요합니다/.test(m) && /needs Node 24/.test(m), v);
  }
  for (const v of ["24.0.0", "24.18.1", "25.1.0", "30.0.0"]) assert.equal(nodeProblem(v), null, v);
  assert.match(text("src/cli.js"), /^#!\/usr\/bin\/env node\nimport "\.\/node-check\.js";/, "cli.js checks the version before it loads anything else");
});

test("engines is >=24; CI runs Node 24 only; every workflow's node-version is 24", () => {
  assert.equal(readJson("package.json").engines.node, ">=24");
  const ci = text(".github/workflows/ci.yml");
  assert.match(ci, /matrix:\n\s+node: \["24"\]/);
  assert.ok(!/\b(18|20|22)\b/.test(ci.replace(/#.*$/gm, "").replace(/[0-9a-f]{40}/g, "")), "no other Node version in ci.yml");
  for (const f of [".github/workflows/publish.yml", "docs/action/nacholens-pr.yml"])
    for (const m of text(f).matchAll(/node-version:\s*"?([^"\n]+)"?/g)) assert.equal(m[1].trim(), "24", `${f}: ${m[0]}`);
  assert.match(text(".github/workflows/ci.yml"), /node-version: \$\{\{ matrix\.node \}\}/);
  // the pinned setup-node is the same commit everywhere
  const pins = new Set([".github/workflows/ci.yml", ".github/workflows/publish.yml", "docs/action/nacholens-pr.yml"].flatMap((f) => [...text(f).matchAll(/actions\/setup-node@([0-9a-f]{40})/g)].map((m) => m[1])));
  assert.equal(pins.size, 1, [...pins].join());
});

const DOCS = ["README.md", "README.ja.md", "README.de.md", "README.fr.md", "README.zh.md", "README.ko.md", "CONTRIBUTING.md", "SECURITY.md", "skills/nacholens/SKILL.md", "docs/guide.md", "docs/guide.ko.md", "docs/pr.md", "docs/review.md", "docs/model-schema.md", "docs/motion/README.md", "docs/motion/render.mjs", "src/install.js", "src/cli.js", "src/snap.js"];
// "Node 20+", "Node.js ≥ 22", "Node >= 22.13", "Node.js 20 以上", "Node 20 이상" ... the demo shop's own files are a fixture (their commit ids are pinned) and are not scanned
const STALE = /Node(?:\.js)?\s*(?:≥|>=)?\s*(?:18|20|22|23)(?:\.\d+)?\+?|Node(?:\.js)?\s*(?:18|20|22)\b/;

test("no document states an older minimum Node; the READMEs and guides say 24", () => {
  for (const f of DOCS) { const m = STALE.exec(text(f)); assert.equal(m, null, `${f}: ${m?.[0]}`); }
  for (const f of ["README.md", "README.ja.md", "README.de.md", "README.fr.md", "README.zh.md", "README.ko.md", "docs/guide.md", "docs/guide.ko.md", "skills/nacholens/SKILL.md", "CONTRIBUTING.md"])
    assert.match(text(f), /Node(?:\.js)? ?(?:≥ ?)?24/, f);
  assert.match(text("src/install.js"), /Node 24\+, no install/, "the AGENTS block that `install` writes");
});

test("snap no longer carries a Node-22 WebSocket branch, and the tests no longer skip for it", () => {
  assert.ok(!/typeof WebSocket/.test(text("src/snap.js")));
  for (const f of readdirSync(join(root, "test")).filter((x) => x.endsWith(".test.js") && x !== "node24.test.js")) assert.ok(!/typeof WebSocket/.test(text(`test/${f}`)), f);
  assert.ok(!/hasSqlite/.test(text("test/demo-app.test.js")));
});
