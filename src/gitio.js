// Thin, read-only git access. Only fixed argv arrays reach git (no shell), refs are validated,
// and nothing here ever writes to the target repository.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const REF = /^[A-Za-z0-9][A-Za-z0-9._\/~^@{}:+-]*$/;

export function checkRef(ref, name = "ref") {
  if (typeof ref !== "string" || !REF.test(ref) || ref.includes(".."))
    throw new Error(`${name} 값이 올바르지 않습니다: ${JSON.stringify(ref)} (브랜치·태그·SHA 하나만 지정하세요. 범위(a..b)는 --base/--head 로 나눠 주세요)`);
  return ref;
}

function git(repo, args) {
  try {
    return execFileSync("git", ["-c", "core.quotePath=false", "-C", repo, ...args], {
      encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const msg = String(e.stderr || e.message).trim().split("\n")[0];
    const err = new Error(`git ${args[0]} 실패: ${msg}`);
    err.git = true;
    throw err;
  }
}

export function openRepo(path) {
  if (!path || !existsSync(path)) throw new Error(`저장소 경로가 없습니다: ${path}`);
  try { git(path, ["rev-parse", "--git-dir"]); }
  catch { throw new Error(`git 저장소가 아닙니다: ${path}`); }
  const cache = new Map();
  return {
    path,
    resolve(ref) {
      checkRef(ref);
      try { return git(path, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim(); }
      catch { throw new Error(`저장소에서 '${ref}' 를 찾을 수 없습니다 (git fetch 가 필요할 수 있습니다)`); }
    },
    tryResolve(ref) { try { return this.resolve(ref); } catch { return null; } },
    /** file content at a commit, or null when it does not exist there */
    show(sha, file) {
      const key = sha + ":" + file;
      if (!cache.has(key)) {
        let v = null;
        try { v = git(path, ["show", `${sha}:${file}`]); } catch { v = null; }
        cache.set(key, v);
      }
      return cache.get(key);
    },
    /** every tracked file path at a commit */
    files(sha) { return git(path, ["ls-tree", "-r", "--name-only", sha]).split("\n").filter(Boolean); },
    diff(base, head) {
      return git(path, ["diff", "--no-renames", "--no-ext-diff", "--no-color", "--unified=0", base, head, "--"]);
    },
    subjects(base, head) {
      const out = git(path, ["log", "--no-merges", "--format=%s", `${base}..${head}`]).trim();
      return out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
    },
    remoteSlug() {
      try {
        const u = git(path, ["remote", "get-url", "origin"]).trim();
        const m = /[:\/]([^\/:]+\/[^\/]+?)(?:\.git)?$/.exec(u);
        return m ? m[1] : null;
      } catch { return null; }
    },
  };
}
