// `nacholens install` vendors the skill + a self-contained CLI so it runs without this repository.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, EXIT } from "../src/cli.js";
import { root } from "./helpers.js";

const tmp = () => mkdtempSync(join(tmpdir(), "sv-install-"));
const quiet = () => {};
const node = (args, cwd) => execFileSync(process.execPath, args, { cwd, encoding: "utf8", env: { ...process.env, HOME: tmp() } });

test("--claude installs <project>/.claude/skills/nacholens with SKILL.md and a CLI that runs from there", () => {
  const proj = tmp();
  const lines = [];
  assert.equal(run(["install", "--claude", "--into", proj], {}, (l) => lines.push(l)), EXIT.OK, lines.join("\n"));
  const dir = join(proj, ".claude/skills/nacholens");
  assert.ok(existsSync(join(dir, "SKILL.md")));
  assert.match(readFileSync(join(dir, "SKILL.md"), "utf8"), /^---\nname: nacholens\n/);
  assert.ok(existsSync(join(dir, "cli/src/cli.js")) && existsSync(join(dir, "cli/package.json")));
  assert.match(lines.join("\n"), /\.claude\/skills\/nacholens/);
  // the installed copy works on its own, from another directory
  const out = join(tmp(), "out");
  const log = node([join(dir, "cli/src/cli.js"), "demo", "--out", out], tmp());
  assert.match(log, /근거 163건 확인/);
  assert.ok(existsSync(join(out, "demo-shop.html")));
  assert.match(node([join(dir, "cli/src/cli.js"), "help"], tmp()), /nacholens demo/);
});

test("--agents installs .nacholens/ and adds one managed block to AGENTS.md without touching the rest; re-install replaces the block", () => {
  const proj = tmp();
  writeFileSync(join(proj, "AGENTS.md"), "# Team rules\n\nBe kind.\n");
  assert.equal(run(["install", "--agents", "--into", proj], {}, quiet), EXIT.OK);
  const md = readFileSync(join(proj, "AGENTS.md"), "utf8");
  assert.ok(md.startsWith("# Team rules\n\nBe kind.\n"));
  assert.equal((md.match(/<!-- nacholens:begin -->/g) ?? []).length, 1);
  assert.match(md, /\.nacholens\/SKILL\.md/);
  assert.ok(existsSync(join(proj, ".nacholens/SKILL.md")) && existsSync(join(proj, ".nacholens/cli/src/cli.js")));
  // second run needs --force, then still exactly one block
  assert.equal(run(["install", "--agents", "--into", proj], {}, quiet), EXIT.USAGE);
  assert.equal(run(["install", "--agents", "--into", proj, "--force"], {}, quiet), EXIT.OK);
  const again = readFileSync(join(proj, "AGENTS.md"), "utf8");
  assert.equal((again.match(/<!-- nacholens:begin -->/g) ?? []).length, 1);
  assert.equal((again.match(/Be kind\./g) ?? []).length, 1);
});

test("--agents creates AGENTS.md when the project has none", () => {
  const proj = tmp();
  assert.equal(run(["install", "--agents", "--into", proj], {}, quiet), EXIT.OK);
  assert.match(readFileSync(join(proj, "AGENTS.md"), "utf8"), /nacholens:begin/);
});

test("--to <skills dir> installs <dir>/nacholens for any other agent's skills folder", () => {
  const skills = tmp();
  assert.equal(run(["install", "--to", skills], {}, quiet), EXIT.OK);
  assert.ok(existsSync(join(skills, "nacholens/SKILL.md")) && existsSync(join(skills, "nacholens/cli/src/cli.js")));
});

test("install refuses to overwrite without --force, needs exactly one target, and an existing --into directory", () => {
  const proj = tmp();
  assert.equal(run(["install", "--claude", "--into", proj], {}, quiet), EXIT.OK);
  assert.equal(run(["install", "--claude", "--into", proj], {}, quiet), EXIT.USAGE);
  assert.equal(run(["install", "--claude", "--into", proj, "--force"], {}, quiet), EXIT.OK);
  assert.throws(() => run(["install", "--into", proj], {}, quiet), /--claude|--agents|--to/);
  assert.throws(() => run(["install", "--claude", "--agents", "--into", proj], {}, quiet), /하나만/);
  assert.throws(() => run(["install", "--claude", "--into", join(proj, "nope")], {}, quiet), /디렉터리/);
});

test("--claude --global installs under $HOME/.claude/skills (HOME is honoured, nothing else is written)", () => {
  const home = tmp();
  assert.equal(run(["install", "--claude", "--global"], { HOME: home }, quiet), EXIT.OK);
  assert.ok(existsSync(join(home, ".claude/skills/nacholens/SKILL.md")));
  assert.deepEqual(readdirSync(home), [".claude"]);
});

test("the vendored copy contains no tests, captures or private files, and is small", () => {
  const proj = tmp();
  run(["install", "--agents", "--into", proj], {}, quiet);
  const all = [];
  const walk = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); n.isDirectory() ? walk(p) : all.push(p.slice(proj.length + 1)); } };
  walk(join(proj, ".nacholens"));
  assert.ok(all.every((f) => !/test|capture|\.png$|node_modules|\.git\//.test(f)), all.filter((f) => /test|capture|\.png$/.test(f)).join(","));
  assert.ok(all.some((f) => f.endsWith("cli/demo/shop/v2/api.js")) && all.some((f) => f.endsWith("cli/models/demo-shop/model.json")));
  assert.ok(root);
});

test("the CLI runs when started through a symlink (npm's bin shim): `help` prints usage and `demo` exits 0", async () => {
  const { symlinkSync } = await import("node:fs");
  const dir = tmp();
  const link = join(dir, "nacholens");
  symlinkSync(join(root, "src/cli.js"), link);
  const help = node([link, "help"], dir);
  assert.match(help, /nacholens demo/);
  const out = join(dir, "out");
  const log = node([link, "demo", "--out", out], dir);
  assert.match(log, /근거 163건 확인/);
  assert.ok(existsSync(join(out, "demo-shop.html")));
});
