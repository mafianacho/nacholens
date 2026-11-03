// Builds the public demo repository: two commits (v1, then v2 = "show shipping status on the order list")
// from demo/shop/v1 and demo/shop/v2. Identity and dates are fixed, so the same files always give
// the same commit ids and the bundled model can name them.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DEMO_DIR = join(here, "..", "demo");

const ENV = {
  GIT_AUTHOR_NAME: "nacholens demo", GIT_AUTHOR_EMAIL: "demo@example.com",
  GIT_COMMITTER_NAME: "nacholens demo", GIT_COMMITTER_EMAIL: "demo@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd, args, date) {
  const env = { ...process.env, ...ENV, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) };
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function replaceTree(from, to) {
  for (const name of readdirSync(to)) if (name !== ".git") rmSync(join(to, name), { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

/** Creates `dir` (must not exist or be empty) as a git repo with the two demo commits. Returns { dir, base, head }. */
export function makeDemoRepo(dir) {
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty`);
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  const commit = (version, message, date) => {
    replaceTree(join(DEMO_DIR, "shop", version), dir);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", message], date);
    return git(dir, ["rev-parse", "HEAD"]);
  };
  const base = commit("v1", "demo shop: sign-in, orders, sales report", "2026-01-01T00:00:00+00:00");
  const head = commit("v2", "show shipping status on the order list", "2026-01-02T00:00:00+00:00");
  return { dir, base, head };
}
