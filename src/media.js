// Hosting the pictures of `snap` on an orphan branch of the same repository, and tidying them up afterwards.
//
//   media upload  pr-<n>/<head7>/ on `nacholens-media`  ->  https://github.com/<o>/<r>/raw/<media commit>/pr-<n>/<head7>
//   media prune   removes the directories of closed/merged PRs in a NEW commit (dry run unless --apply)
//
// Rules that keep it safe:
//  - All git work happens in a throw-away clone under the temp folder. The checkout the user is in (working tree,
//    index, refs, config) is only read for its remote URL and ssh command, never written.
//  - Pushes are plain, never forced: a lost race is retried on top of the new tip, and history only grows.
//  - Every path piece (PR number, head, picture names) is checked against a short allow-list before any git call;
//    git always gets argv arrays, never a shell.
//  - The branch must look like a picture branch (only `pr-<n>` folders at the top) or nothing is touched.
//  - "May not write" (fork PR, read-only token) is recognised and reported as DeniedError so a workflow can skip.
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DENIED_RE, DeniedError, deniedMessage, exec, fail, firstLine } from "./proc.js";
import { hostArgs, repoOf } from "./pr-comment.js";

export const MEDIA_BRANCH = "nacholens-media";
const PR_RE = /^[1-9][0-9]{0,8}$/;
const HEAD_RE = /^[0-9a-f]{7,40}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}(?:\.[A-Za-z0-9_-]{1,40})?\.(?:png|gif)$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,100}$/;
const TOP_OK = /^(?:pr-[0-9]+|README\.md|\.gitattributes|\.nojekyll)$/;
const REMOTE_OK = /^(?:https?:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[^\s]+|ssh:\/\/[^\s]+|git@[A-Za-z0-9.-]+:[^\s]+|file:\/\/\/[^\s]+|\/[^\s]+)$/;
const RETRY_RE = /non-fast-forward|fetch first|incorrect old value|cannot lock ref|reference already exists|failed to update ref/i;
const MAX_FILES = 60, MAX_BYTES = 25 * 1024 * 1024, ATTEMPTS = 4;

export const mediaPath = (pr, head) => `pr-${pr}/${head.slice(0, 7)}`;

function checkPr(v) {
  if (v === undefined || !PR_RE.test(String(v))) throw new Error("--pr 은 1 이상의 PR 번호여야 합니다");
  return Number(v);
}
function checkHead(v, flag = "--head") {
  if (typeof v !== "string" || !HEAD_RE.test(v)) throw new Error(`${flag} 는 소문자 16진수 커밋 SHA(7~40자)여야 합니다: ${JSON.stringify(v)}`);
  return v;
}
function checkBranch(v) {
  if (typeof v !== "string" || !BRANCH_RE.test(v) || v.includes("..") || v.includes("//") || v.endsWith("/") || v.endsWith(".lock")) throw new Error(`--branch 이름이 올바르지 않습니다: ${JSON.stringify(v)}`);
  return v;
}
const readJson = (p, what) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { throw new Error(`${what} 을 읽을 수 없습니다 (${p}): ${e.message}`); } };

/** The pictures `snap` wrote, checked: names from the allow-list, plain files only (no links), bounded size. */
export function collectMedia(mediaDir) {
  const mf = join(mediaDir, "manifest.json");
  if (!existsSync(mf)) throw new Error(`${mediaDir} 에 manifest.json 이 없습니다: 먼저 nacholens snap 으로 그림을 만드세요`);
  const manifest = readJson(mf, "manifest.json");
  const list = Array.isArray(manifest.files) ? manifest.files : [];
  if (!list.length) throw new Error(`${mf} 에 올릴 그림이 없습니다`);
  if (list.length > MAX_FILES) throw new Error(`그림이 너무 많습니다 (${list.length}개, 최대 ${MAX_FILES}개)`);
  const seen = new Set(), files = [];
  let bytes = 0;
  for (const f of list) {
    const name = f?.file;
    if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error(`그림 파일 이름이 올바르지 않습니다: ${JSON.stringify(name)} (영문·숫자·._- 와 .png/.gif 만)`);
    if (seen.has(name)) throw new Error(`그림 파일 이름이 겹칩니다: ${name}`);
    seen.add(name);
    const abs = join(mediaDir, name);
    let st;
    try { st = lstatSync(abs); } catch { throw new Error(`그림 파일이 없습니다: ${name}`); }
    if (!st.isFile()) throw new Error(`그림 파일이 일반 파일이 아닙니다 (링크 등): ${name}`);
    bytes += st.size;
    if (bytes > MAX_BYTES) throw new Error(`그림이 너무 큽니다 (최대 ${MAX_BYTES / 1024 / 1024} MB)`);
    files.push({ name, abs, bytes: st.size });
  }
  return { manifest, files };
}

/* ───────── where to push ───────── */

function target(opt, env) {
  const repo = resolve(opt.repo ?? ".");
  const g = (args) => exec("git", ["-C", repo, ...args], { env });
  let url = opt.remote;
  if (url === undefined || /^[A-Za-z0-9._-]+$/.test(url)) {
    const name = url ?? "origin", r = g(["remote", "get-url", "--", name]);
    if (r.code !== 0) throw new Error(`원격 '${name}' 의 주소를 읽을 수 없습니다 (${repo}): ${firstLine(r.stderr)} — --repo <체크아웃> 또는 --remote <주소> 를 지정하세요`);
    url = r.stdout.trim();
  }
  if (!REMOTE_OK.test(url)) throw new Error(`원격 주소 형식을 지원하지 않습니다: ${JSON.stringify(url)} (https://, ssh://, git@host:, 절대 경로만)`);
  const ssh = g(["config", "--get", "core.sshCommand"]);
  return { url, cloneUrl: url.startsWith("/") ? `file://${url}` : url, ssh: ssh.code === 0 ? ssh.stdout.trim() : "" };
}

/** The https address people open, from --repo-url or the remote's own address. */
export function publicRepoUrl(opt, remoteUrl) {
  if (opt["repo-url"]) { repoOf(opt["repo-url"]); return String(opt["repo-url"]).replace(/\/+$/, "").replace(/\.git$/, ""); }
  let m = /^https:\/\/([A-Za-z0-9.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remoteUrl)
    ?? /^git@([A-Za-z0-9.-]+):([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remoteUrl)
    ?? /^ssh:\/\/git@([A-Za-z0-9.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remoteUrl);
  if (!m) throw new Error("원격 주소에서 저장소 URL 을 알아낼 수 없습니다: --repo-url https://github.com/<owner>/<repo> 를 지정하세요");
  return `https://${m[1]}/${m[2]}/${m[3]}`;
}

/** A throw-away clone of the picture branch (or an empty orphan one), plus push with retry. */
class Work {
  constructor(t, branch, env) {
    this.t = t; this.branch = branch; this.env = env;
    this.tmp = mkdtempSync(join(tmpdir(), "nl-media-")); this.dir = join(this.tmp, "w");
    this.cfg = [
      "-c", "core.quotePath=false", "-c", "user.name=nacholens", "-c", "user.email=nacholens@users.noreply.github.com", "-c", "commit.gpgsign=false",
      ...(t.ssh ? ["-c", `core.sshCommand=${t.ssh}`] : []),
      ...(t.cloneUrl.startsWith("https://") ? ["-c", "credential.helper=!gh auth git-credential"] : []),
    ];
  }
  git(args, cwd = this.dir) { return exec("git", [...this.cfg, ...args], { cwd, env: this.env }); }
  must(what, args, cwd) { const r = this.git(args, cwd); if (r.code !== 0) throw fail(what, r); return r; }
  /** @returns {boolean} whether the branch already exists on the remote */
  open() {
    const ls = this.git(["ls-remote", "--heads", "--", this.t.cloneUrl, `refs/heads/${this.branch}`], this.tmp);
    if (ls.code !== 0) throw fail("원격 저장소 읽기", ls);
    this.exists = ls.stdout.trim().length > 0;
    if (this.exists) this.must("그림 브랜치 받기", ["clone", "--quiet", "--depth", "1", "--single-branch", "--no-tags", "--branch", this.branch, "--", this.t.cloneUrl, this.dir], this.tmp);
    else {
      mkdirSync(this.dir);
      this.must("임시 저장소 만들기", ["init", "-q", "-b", this.branch]);
      this.must("임시 저장소 설정", ["remote", "add", "origin", this.t.cloneUrl]);
    }
    this.checkShape();
    return this.exists;
  }
  checkShape() {
    if (!this.exists) return;
    const top = this.must("그림 브랜치 읽기", ["ls-tree", "--name-only", "HEAD"]).stdout.split("\n").filter(Boolean);
    const bad = top.find((n) => !TOP_OK.test(n));
    if (bad) throw new Error(`'${this.branch}' 는 그림 브랜치가 아닙니다: 최상위에 '${bad}' 가 있습니다. 코드가 든 브랜치는 건드리지 않습니다 (--branch 를 확인하세요)`);
  }
  head() { return this.must("커밋 읽기", ["rev-parse", "HEAD"]).stdout.trim(); }
  /** commit what `change()` staged; push without force; on a lost race rebuild on the new tip. */
  commitAndPush(change, message) {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      change();
      const dirty = this.must("상태 읽기", ["status", "--porcelain"]).stdout.trim();
      if (!dirty) return { committed: false, commit: this.exists ? this.head() : null, attempts: attempt };
      this.must("스테이징", ["add", "-A"]);
      this.must("커밋", ["commit", "-q", "-m", message]);
      const push = this.git(["push", "-q", "origin", `HEAD:refs/heads/${this.branch}`]);
      if (push.code === 0) return { committed: true, commit: this.head(), attempts: attempt };
      const text = push.stderr + "\n" + push.stdout;
      if (DENIED_RE.test(text)) throw new DeniedError(deniedMessage(firstLine(push.stderr) || firstLine(push.stdout)));
      if (!RETRY_RE.test(text) || attempt === ATTEMPTS) throw fail("그림 브랜치 push", push);
      // somebody else pushed first: start again from their tip (our commit is dropped, never force-pushed)
      this.must("새 tip 받기", ["fetch", "-q", "--depth", "1", "origin", `refs/heads/${this.branch}`]);
      this.must("새 tip 으로 이동", ["reset", "-q", "--hard", "FETCH_HEAD"]);
      this.exists = true;
      this.checkShape();
    }
    throw new Error("그림 브랜치 push 실패");
  }
  close() { rmSync(this.tmp, { recursive: true, force: true }); }
}

/* ───────── upload ───────── */

/**
 * @param {object} o
 * @param {string} o.from        `build --out` folder (its media/ holds the pictures; report.json names the head)
 * @param {object} o.opt         parsed CLI options (pr, head, repo, remote, repo-url, branch, media)
 */
export function uploadMedia({ from, opt, env = process.env, log = () => {} }) {
  const pr = checkPr(opt.pr);
  const branch = checkBranch(opt.branch ?? MEDIA_BRANCH);
  const dir = resolve(from ?? "."), mediaDir = resolve(opt.media ?? join(dir, "media"));
  let head = opt.head;
  if (head === undefined) {
    const rp = join(dir, "report.json");
    head = (existsSync(rp) ? readJson(rp, "report.json").head : null) ?? (existsSync(join(mediaDir, "manifest.json")) ? readJson(join(mediaDir, "manifest.json"), "manifest.json").head : null);
    if (!head) throw new Error("커밋을 알 수 없습니다: --head <SHA> 를 지정하세요 (build 의 report.json 이나 snap 의 manifest.json 에 head 가 있어야 합니다)");
  }
  checkHead(head, opt.head !== undefined ? "--head" : "build 의 head");
  const { files } = collectMedia(mediaDir);
  const t = target(opt, env), repoUrl = publicRepoUrl(opt, t.url);
  const rel = mediaPath(pr, head);

  const w = new Work(t, branch, env);
  try {
    w.open();
    const r = w.commitAndPush(() => {
      rmSync(join(w.dir, rel), { recursive: true, force: true });
      mkdirSync(join(w.dir, rel), { recursive: true });
      for (const f of files) copyFileSync(f.abs, join(w.dir, rel, f.name));
    }, `nacholens pictures for #${pr} at ${head.slice(0, 7)}`);
    const commit = r.commit ?? w.head();
    const url = `${repoUrl}/raw/${commit}/${rel}`;
    writeFileSync(join(mediaDir, "media-url.json"), JSON.stringify({ schemaVersion: 1, url, commit, path: rel, pr, head, branch }, null, 2) + "\n");
    log(`미디어 업로드: ${files.length}개 → ${branch}/${rel} (${r.committed ? "새 커밋" : "변경 없음, 새 커밋 없음"} ${commit.slice(0, 7)}${r.attempts > 1 ? `, 동시 push 로 ${r.attempts}번째 시도` : ""})`);
    log(`미디어 URL: ${url}`);
    return { url, commit, path: rel, committed: r.committed, files: files.length };
  } finally { w.close(); }
}

/* ───────── prune ───────── */

const sizeOf = (p) => { let n = 0; for (const e of readdirSync(p, { withFileTypes: true })) n += e.isDirectory() ? sizeOf(join(p, e.name)) : statSync(join(p, e.name)).size; return n; };
const kb = (n) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);

/**
 * Lists (and with apply, removes) the pictures of PRs that are closed or merged. A PR that `gh` does not list
 * is kept: nothing is deleted that is not proven closed. Old media commits keep the files, so links in old comments still work.
 */
export function pruneMedia({ opt, env = process.env, log = () => {} }) {
  const branch = checkBranch(opt.branch ?? MEDIA_BRANCH);
  const t = target(opt, env), repoUrl = publicRepoUrl(opt, t.url), { host, slug } = repoOf(repoUrl);
  const w = new Work(t, branch, env);
  try {
    if (!w.open()) { log(`그림 브랜치가 아직 없습니다 (${branch}): 지울 것이 없습니다`); return { removed: [], commit: null }; }
    const dirs = readdirSync(w.dir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^pr-[0-9]+$/.test(e.name)).map((e) => e.name).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
    if (!dirs.length) { log("지울 것이 없습니다 (pr-<n> 폴더가 없습니다)"); return { removed: [], commit: w.head() }; }

    const ghRepo = `${host === "github.com" ? "" : host + "/"}${slug}`;
    const list = exec("gh", ["pr", "list", "-R", ghRepo, "--state", "all", "--json", "number,state,headRefOid", "--limit", "1000"], { env });
    if (list.code !== 0) throw fail("PR 목록 읽기(gh pr list)", list);
    let prs; try { prs = JSON.parse(list.stdout || "[]"); } catch { throw new Error("gh pr list 응답이 올바른 JSON 이 아닙니다"); }
    const byNum = new Map(prs.map((p) => [Number(p.number), p]));
    if (prs.length >= 1000) log("⚠ PR 이 1000개 이상이라 목록이 잘렸을 수 있습니다. 목록에 없는 PR 의 그림은 지우지 않습니다.");

    const doomed = [], closedNums = [], olderNums = [];
    for (const d of dirs) {
      const n = Number(d.slice(3)), info = byNum.get(n);
      const heads = readdirSync(join(w.dir, d), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      if (!info) { log(`남김: ${d} (PR 목록에 없음 — 닫혔는지 확인할 수 없어 지우지 않습니다)`); continue; }
      const state = String(info.state).toUpperCase();
      if (state === "CLOSED" || state === "MERGED") {
        doomed.push({ rel: d, why: state, bytes: sizeOf(join(w.dir, d)), files: heads.length }); closedNums.push(n);
      } else if (opt.superseded && HEAD_RE.test(String(info.headRefOid ?? "")) && heads.includes(String(info.headRefOid).slice(0, 7))) {
        const cur = String(info.headRefOid).slice(0, 7);
        const old = heads.filter((h) => h !== cur && /^[0-9a-f]{7}$/.test(h));
        for (const h of old) doomed.push({ rel: `${d}/${h}`, why: `${state}, 오래된 head`, bytes: sizeOf(join(w.dir, d, h)), files: 1 });
        if (old.length) olderNums.push(n);
        log(`남김: ${d}/${cur} (${state}, 현재 head)`);
      } else log(`남김: ${d} (${state})`);
    }
    if (!doomed.length) { log("지울 것이 없습니다"); return { removed: [], commit: w.head() }; }
    for (const x of doomed) log(`삭제 예정: ${x.rel} (${x.why}) ${kb(x.bytes)}`);
    if (!opt.apply) { log(`${doomed.length}곳을 지우려면 같은 명령에 --apply 를 붙이세요 (새 커밋으로 지우며, 이전 커밋에는 그대로 남습니다)`); return { removed: [], planned: doomed.map((x) => x.rel), commit: w.head() }; }

    const msg = [`nacholens: remove pictures of closed PRs (${closedNums.map((n) => "#" + n).join(", ") || "none"})`, olderNums.length ? `and older heads of open PRs (${olderNums.map((n) => "#" + n).join(", ")})` : ""].filter(Boolean).join("; ");
    const r = w.commitAndPush(() => {
      const present = doomed.map((x) => x.rel).filter((p) => existsSync(join(w.dir, p)));
      if (present.length) w.must("삭제", ["rm", "-r", "-q", "--ignore-unmatch", "--", ...present]);
    }, msg);
    log(`삭제 커밋: ${(r.commit ?? "").slice(0, 7)} (${doomed.length}곳, 이전 커밋은 그대로 남아 오래된 코멘트의 그림 링크는 계속 열립니다)`);
    return { removed: doomed.map((x) => x.rel), commit: r.commit };
  } finally { w.close(); }
}

export { DeniedError };
