// Plugin manifests for the Claude Code and Codex marketplaces must stay in step with package.json and the skill.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root } from "./helpers.js";

const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const pkg = json("package.json");

test("Claude plugin manifest and marketplace name the same plugin and use the package version", () => {
  const plugin = json(".claude-plugin/plugin.json");
  const market = json(".claude-plugin/marketplace.json");
  assert.equal(plugin.name, "nacholens");
  assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.license, pkg.license);
  assert.equal(market.name, "nacholens");
  assert.equal(market.plugins.length, 1);
  const entry = market.plugins[0];
  assert.equal(entry.name, plugin.name, "entry name must equal the manifest name or installs fail");
  assert.equal(entry.version, pkg.version);
  assert.equal(entry.source, "./");
});

test("Codex plugin manifest and repo marketplace name the same plugin and use the package version", () => {
  const plugin = json(".codex-plugin/plugin.json");
  const market = json(".agents/plugins/marketplace.json");
  assert.equal(plugin.name, "nacholens");
  assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.license, pkg.license);
  assert.equal(plugin.skills, "./skills/");
  assert.equal(market.name, "nacholens");
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, plugin.name);
  assert.deepEqual(market.plugins[0].source, { source: "local", path: "./" });
});

test("the plugins reuse the one playbook in skills/nacholens and the package does not ship the plugin folders", () => {
  assert.ok(existsSync(join(root, "skills/nacholens/SKILL.md")));
  for (const f of pkg.files) assert.ok(!/^\.(claude-plugin|codex-plugin|agents)/.test(f), `${f}: plugin folders are for git installs only`);
});
