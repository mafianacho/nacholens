// The tool is Node only: users and contributors need no Python, and the published package has no dependencies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { root } from "./helpers.js";

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("no Python file is tracked and no script runs python", () => {
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  assert.deepEqual(files.filter((f) => /\.(py|pyw|ipynb)$/.test(f)), []);
  for (const [name, cmd] of Object.entries(pkg.scripts)) assert.doesNotMatch(cmd, /python|pip\b/i, `npm script ${name}`);
});

test("the published package has no dependencies and does not ship the dev-only font tool", () => {
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) assert.equal(pkg[key], undefined, key);
  assert.ok(!pkg.files.some((f) => f.startsWith("scripts")), "scripts/ must not be in files");
});

test("the dev-only tools (fonts, README GIF) are Node scripts with their own pinned dev dependencies", () => {
  const tool = JSON.parse(readFileSync(join(root, "scripts/tools/package.json"), "utf8"));
  assert.equal(tool.private, true);
  assert.deepEqual(Object.keys(tool.devDependencies).sort(), ["gifenc", "pngjs", "subset-font"]);
  for (const [name, version] of Object.entries(tool.devDependencies)) assert.match(version, /^\d+\.\d+\.\d+$/, `${name} pinned exactly`);
  assert.match(readFileSync(join(root, "scripts/build-fonts.mjs"), "utf8"), /^#!\/usr\/bin\/env node/);
  assert.match(readFileSync(join(root, "docs/motion/encode.mjs"), "utf8"), /^#!\/usr\/bin\/env node/);
});
