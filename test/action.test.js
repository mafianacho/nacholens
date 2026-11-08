// The example GitHub Action (docs/action/nacholens-pr.yml): least privilege, pinned actions, no injection, fork PRs skipped,
// and every nacholens call in it is a real command with real flags. There is no YAML parser (zero dependencies), so the file
// is read line by line; its shape is part of what is pinned here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.js";
import { root } from "./helpers.js";

const FILE = "docs/action/nacholens-pr.yml";
const yml = readFileSync(join(root, FILE), "utf8");
const lines = yml.split("\n");
const code = yml.replace(/(^|\s)#.*$/gm, ""); // the file without its comments

/** { name: { start, end, text } } for the jobs under `jobs:` (two-space indent) */
function jobs() {
  const at = lines.findIndex((l) => l === "jobs:");
  const heads = [];
  for (let i = at + 1; i < lines.length; i++) if (/^  [a-z][a-z0-9-]*:\s*$/.test(lines[i])) heads.push([lines[i].trim().slice(0, -1), i]);
  const out = {};
  heads.forEach(([name, start], k) => { const end = k + 1 < heads.length ? heads[k + 1][1] : lines.length; out[name] = { start, end, text: lines.slice(start, end).join("\n") }; });
  return out;
}
const permsOf = (job) => { const m = /^    permissions:\n((?:      [^\n]+\n?)+)/m.exec(job.text + "\n"); return m ? Object.fromEntries(m[1].trim().split("\n").map((l) => l.replace(/\s+#.*$/, "").trim().split(/:\s*/))) : null; };

test("three jobs, each with its own explicit permissions; only host-pictures can write contents, only comment can write pull requests", () => {
  const j = jobs();
  assert.deepEqual(Object.keys(j), ["build", "host-pictures", "comment"]);
  assert.match(yml, /^permissions: \{\}$/m, "the workflow default is no permission at all");
  assert.deepEqual(permsOf(j.build), { contents: "read" });
  assert.deepEqual(permsOf(j["host-pictures"]), { contents: "write" });
  assert.deepEqual(permsOf(j.comment), { contents: "read", "pull-requests": "write" });
  assert.equal((code.match(/contents: write/g) ?? []).length, 1);
  assert.equal((code.match(/pull-requests: write/g) ?? []).length, 1);
  assert.ok(!/(?:^|\s)(?:actions|issues|packages|id-token|checks|statuses|deployments): write/m.test(code));
  assert.ok(!j["host-pictures"].text.includes("actions/checkout"), "the job that can push never checks out the pull request's code");
  assert.ok(!j.comment.text.includes("actions/checkout"), "nor does the job that posts");
});

test("every action is pinned to a commit with its release in a comment; checkouts keep no credentials", () => {
  const uses = lines.filter((l) => /^\s*- uses:|^\s+uses:/.test(l));
  assert.ok(uses.length >= 8);
  for (const l of uses) assert.match(l, /uses: [A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40} # v\d+(?:\.\d+)*$/, l);
  const co = lines.flatMap((l, i) => (l.includes("actions/checkout") ? [i] : []));
  assert.ok(co.length >= 1);
  for (const i of co) assert.match(lines.slice(i, i + 5).join("\n"), /persist-credentials: false/);
  // the pins that CI already uses are reused, not new ones
  const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  for (const a of ["actions/checkout", "actions/setup-node"]) assert.equal(new RegExp(`${a}@([0-9a-f]{40})`).exec(yml)[1], new RegExp(`${a}@([0-9a-f]{40})`).exec(ci)[1], a);
});

test("only pull_request (never pull_request_target); fork pull requests are skipped by every job; one run per PR", () => {
  assert.match(yml, /^on:\n  pull_request:\n    types: \[opened, synchronize, reopened\]$/m);
  assert.ok(!/pull_request_target|workflow_run/.test(yml.replace(/#.*$/gm, "")));
  const guard = "github.event.pull_request.head.repo.full_name == github.repository";
  for (const [name, job] of Object.entries(jobs())) assert.ok(new RegExp(`^    if: .*${guard.replace(/[.]/g, "\\.")}`, "m").test(job.text), `${name} skips fork PRs`);
  assert.match(yml, /concurrency:\n  group: nacholens-pr-\$\{\{ github\.event\.pull_request\.number \}\}\n  cancel-in-progress: true/);
  assert.match(jobs()["host-pictures"].text, /if: vars\.NACHOLENS_PICTURES == 'true'/, "pictures are opt-in");
  assert.match(yml, /--skip-on-denied/g, "a refused write is a skip, not a failure");
});

test("no ${{ }} inside a run: script (values reach the shell through env: only)", () => {
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)run:\s*(\|?)(.*)$/.exec(lines[i]);
    if (!m) continue;
    const block = m[2] ? [] : [m[3]];
    if (m[2]) for (let k = i + 1; k < lines.length && (lines[k].trim() === "" || lines[k].startsWith(m[1] + "  ")); k++) block.push(lines[k]);
    for (const l of block) assert.ok(!l.includes("${{"), `run script interpolates an expression: ${l.trim()}`);
  }
});

test("the order is checkout -> node 24 -> build -> snap -> media upload -> pr --comment, and every nacholens call uses commands and flags the CLI really has", () => {
  const at = (re) => { const i = yml.search(re); assert.ok(i >= 0, String(re)); return i; };
  const order = [/actions\/checkout@/, /node-version: "24"/, /nacholens build /, /nacholens snap /, /nacholens media upload /, /nacholens pr /];
  const idx = order.map(at);
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
  assert.match(yml, /nacholens pr [^\n]*--comment/);
  const help = []; run(["help"], {}, (l) => help.push(l));
  const usage = help.join("\n");
  const calls = [...yml.matchAll(/^\s*(?:run: )?(nacholens (?:build|snap|media upload|pr) [^\n]*)$/gm)].map((m) => m[1]);
  assert.equal(calls.length, 4);
  for (const c of calls) for (const f of c.match(/--[a-z-]+/g)) assert.ok(usage.includes(f), `${f} in: ${c}`);
  assert.match(yml, /NACHOLENS_PKG: "@mafianacho\/nacholens@\d+\.\d+\.\d+"/);
});

test("the example is shipped and linked from the PR guide and the README", () => {
  assert.ok(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).files.includes(FILE));
  assert.ok(readFileSync(join(root, "docs/pr.md"), "utf8").includes(FILE));
  assert.ok(readFileSync(join(root, "README.md"), "utf8").includes("docs/action/nacholens-pr.yml"));
});
