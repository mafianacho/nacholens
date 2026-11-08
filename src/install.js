// `nacholens install`: put the skill and a self-contained copy of the CLI where an agent will find it.
//   --claude [--into <project>] [--global]   <project>/.claude/skills/nacholens  (or ~/.claude/skills/nacholens)
//   --agents [--into <project>]              <project>/.nacholens + a managed block in <project>/AGENTS.md
//   --to <skills dir>                        <dir>/nacholens  (any agent that reads SKILL.md folders)
// The installed folder holds SKILL.md and cli/ (src, demo, demo model). Nothing is downloaded; no dependencies.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const BEGIN = "<!-- nacholens:begin -->", END = "<!-- nacholens:end -->";

function skillSource() {
  for (const p of [join(ROOT, "skills", "nacholens", "SKILL.md"), join(ROOT, "..", "SKILL.md")]) if (existsSync(p)) return p;
  throw new Error("SKILL.md 를 찾을 수 없습니다 (nacholens 저장소 또는 설치된 사본에서 실행하세요)");
}

export function version() {
  try { return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version; } catch { /* vendored copy has its own */ }
  try { return readFileSync(join(ROOT, "VERSION"), "utf8").trim(); } catch { return "unknown"; }
}

function writeSkillDir(dir) {
  mkdirSync(join(dir, "cli", "models", "demo-shop"), { recursive: true });
  cpSync(skillSource(), join(dir, "SKILL.md"));
  cpSync(join(ROOT, "src"), join(dir, "cli", "src"), { recursive: true });
  cpSync(join(ROOT, "demo"), join(dir, "cli", "demo"), { recursive: true });
  cpSync(join(ROOT, "models", "demo-shop", "model.json"), join(dir, "cli", "models", "demo-shop", "model.json"));
  for (const f of ["LICENSE", "NOTICE"]) if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(dir, "cli", f));
  writeFileSync(join(dir, "cli", "package.json"), JSON.stringify({ name: "nacholens-vendored", private: true, type: "module", version: version() }, null, 2) + "\n");
  writeFileSync(join(dir, "cli", "VERSION"), version() + "\n");
}

function agentsBlock() {
  return [
    BEGIN,
    "## nacholens (architecture flow viewer)",
    "",
    "When asked to show what changed in this repo's backend/infra without reading code, or to draw how a service works,",
    "read `.nacholens/SKILL.md` and follow it. CLI: `node .nacholens/cli/src/cli.js` (Node 24+, no install).",
    END,
    "",
  ].join("\n");
}

function upsertAgentsMd(file) {
  const block = agentsBlock();
  if (!existsSync(file)) { writeFileSync(file, block); return "created"; }
  const text = readFileSync(file, "utf8");
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  if (a >= 0 && b > a) { writeFileSync(file, text.slice(0, a) + block.trimEnd() + text.slice(b + END.length)); return "updated"; }
  writeFileSync(file, text.replace(/\s*$/, "\n\n") + block);
  return "appended";
}

/** Returns { code: 0 | 2, dir } — 2 when the target exists and --force was not given. */
export function install(opt, env, log) {
  const picks = ["claude", "agents", "to"].filter((k) => opt[k] !== undefined);
  if (picks.length === 0) throw new Error("설치 대상이 필요합니다: --claude | --agents | --to <스킬 폴더>");
  if (picks.length > 1) throw new Error("설치 대상은 하나만 고르세요: --claude | --agents | --to");

  const project = () => {
    const p = resolve(opt.into ?? process.cwd());
    if (!existsSync(p) || !statSync(p).isDirectory()) throw new Error(`--into 는 존재하는 디렉터리여야 합니다: ${p}`);
    return p;
  };

  let dir, after = null;
  if (opt.claude !== undefined) {
    dir = opt.global ? join(env.HOME ?? homedir(), ".claude", "skills", "nacholens") : join(project(), ".claude", "skills", "nacholens");
  } else if (opt.agents !== undefined) {
    dir = join(project(), ".nacholens");
    after = () => `AGENTS.md ${upsertAgentsMd(join(dirname(dir), "AGENTS.md"))}`;
  } else {
    const base = resolve(opt.to);
    mkdirSync(base, { recursive: true });
    dir = join(base, "nacholens");
  }

  if (existsSync(dir) && !opt.force) {
    log(`이미 있습니다: ${dir} (덮어쓰려면 --force)`);
    return { code: 2, dir };
  }
  rmSync(dir, { recursive: true, force: true });
  writeSkillDir(dir);
  log(`설치: ${dir}`);
  log(`  스킬: ${join(dir, "SKILL.md")}`);
  log(`  CLI : node ${join(dir, "cli", "src", "cli.js")} help`);
  if (after) log(`  ${after()}`);
  log("확인: 위 CLI 로 `demo` 를 실행해 보세요 (대상 저장소 없이 번들된 데모 앱으로 전체 흐름을 만듭니다).");
  return { code: 0, dir };
}
