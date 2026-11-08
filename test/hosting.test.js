// Picture hosting (`media upload` / `media prune`), the sticky PR comment (`pr --comment`) and `snap --optional`.
// Everything runs against a local bare repository standing in for GitHub and a fake `gh` first on PATH:
// no network, no account, no real PR is touched.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, EXIT } from "../src/cli.js";
import { upsertComment, parseJsonStream } from "../src/pr-comment.js";
import { makeDemoRepo } from "../src/demo.js";
import { PR_MARK } from "../src/pr.js";
import { root } from "./helpers.js";

const IDENT = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: { ...process.env, ...IDENT }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tmp = () => mkdtempSync(join(tmpdir(), "nl-host-"));
const cap = () => { const lines = []; return { log: (m) => lines.push(String(m)), text: () => lines.join("\n") }; };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"); // enough bytes to be a distinct file
const REPO_URL = "https://github.com/acme/shop";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

const GH_STUB = (node) => `#!${node}
// fake gh: records every call, answers from FAKE_GH_STATE, can refuse writes like a read-only token
const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(a) + "\\n");
const st = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"));
const save = () => fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(st));
const flag = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
const path = a.find((x) => x.startsWith("repos/"));
const fail = (m) => { process.stderr.write(m + "\\n"); process.exit(1); };
if (a[0] === "pr" && a[1] === "list") { process.stdout.write(JSON.stringify(st.prs || [])); process.exit(0); }
if (a[0] !== "api" || !path) fail("fake gh: unexpected " + a.join(" "));
const method = flag("-X") || "GET";
if (method !== "GET" && st.deny) fail("gh: Resource not accessible by integration (HTTP 403)");
let m;
if (method === "GET" && (m = /^repos\\/[^/]+\\/[^/]+\\/issues\\/(\\d+)\\/comments$/.exec(path))) {
  const list = (st.comments || {})[m[1]] || [];
  for (let i = 0; i < Math.max(list.length, 1); i += 2) process.stdout.write(JSON.stringify(list.slice(i, i + 2)));   // paginated: [..][..]
  process.exit(0);
}
const body = () => { const v = flag("-F") || ""; if (!v.startsWith("body=@")) fail("fake gh: body must be @file"); return fs.readFileSync(v.slice(6), "utf8"); };
if (method === "PATCH" && (m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/comments\\/(\\d+)$/.exec(path))) {
  for (const list of Object.values(st.comments || {})) for (const c of list) if (String(c.id) === m[2]) c.body = body();
  save(); process.stdout.write(JSON.stringify({ id: Number(m[2]), html_url: "https://github.com/" + m[1] + "/pull/1#issuecomment-" + m[2] })); process.exit(0);
}
if (method === "POST" && (m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)\\/comments$/.exec(path))) {
  st.comments = st.comments || {}; const list = (st.comments[m[2]] = st.comments[m[2]] || []);
  const id = 1000 + list.length + 1; list.push({ id, body: body() }); save();
  process.stdout.write(JSON.stringify({ id, html_url: "https://github.com/" + m[1] + "/pull/" + m[2] + "#issuecomment-" + id })); process.exit(0);
}
fail("fake gh: unhandled " + a.join(" "));
`;

function rig() {
  const dir = tmp();
  const origin = join(dir, "origin.git");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  const work = join(dir, "work");
  git(dir, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-B", "main");
  writeFileSync(join(work, "app.js"), "console.log(1)\n");
  git(work, "add", "-A"); git(work, "commit", "-qm", "c1"); git(work, "push", "-q", "origin", "main");
  const bin = join(dir, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "gh"), GH_STUB(process.execPath)); chmodSync(join(bin, "gh"), 0o755);
  const stateFile = join(dir, "gh-state.json"), logFile = join(dir, "gh.log");
  writeFileSync(stateFile, "{}"); writeFileSync(logFile, "");
  const r = {
    dir, origin, work,
    env: { PATH: `${bin}:${process.env.PATH}`, FAKE_GH_STATE: stateFile, FAKE_GH_LOG: logFile, ...IDENT },
    state: (patch) => { if (patch) writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(readFileSync(stateFile, "utf8")), ...patch })); return JSON.parse(readFileSync(stateFile, "utf8")); },
    calls: () => readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    /** a `build --out` style folder with a media/ folder (manifest + two pictures) */
    media(name = "out", bytes = PNG, head = HEAD) {
      const out = join(dir, name), m = join(out, "media"); mkdirSync(m, { recursive: true });
      writeFileSync(join(m, "map.png"), bytes); writeFileSync(join(m, "list-orders.gif"), Buffer.concat([Buffer.from("GIF89a"), bytes]));
      writeFileSync(join(m, "manifest.json"), JSON.stringify({ schemaVersion: 1, page: "p.html", product: "demo-shop", head, files: [
        { kind: "map", theme: "light", useCase: "list-orders", file: "map.png", width: 800, height: 500 },
        { kind: "flow", theme: "light", useCase: "list-orders", file: "list-orders.gif", width: 800, height: 500 }] }));
      writeFileSync(join(out, "report.json"), JSON.stringify({ ok: true, head }));
      return out;
    },
    upload(out, extra = [], env = {}) {
      const c = cap();
      const code = run(["media", "upload", "--from", out, "--repo", work, "--repo-url", REPO_URL, "--pr", "7", ...extra], { ...r.env, ...env }, c.log);
      return { code, text: c.text() };
    },
    branchHead: () => git(origin, "rev-parse", "refs/heads/nacholens-media"),
    show: (commit, path) => execFileSync("git", ["-C", origin, "show", `${commit}:${path}`], { env: { ...process.env, ...IDENT } }),
    tree: (commit) => git(origin, "ls-tree", "-r", "--name-only", commit).split("\n").filter(Boolean),
    count: () => Number(git(origin, "rev-list", "--count", "refs/heads/nacholens-media")),
  };
  return r;
}
const snapshotOf = (work) => ({
  head: git(work, "rev-parse", "HEAD"), status: git(work, "status", "--porcelain"), refs: git(work, "for-each-ref"),
  config: readFileSync(join(work, ".git", "config"), "utf8"), stash: git(work, "stash", "list"),
});

/* ───────── media upload ───────── */

test("media upload: pictures land on the orphan media branch under pr-<n>/<head7>/; the URL is pinned to the media commit; the checkout is untouched", () => {
  const r = rig(), out = r.media(), before = snapshotOf(r.work);
  const { code, text } = r.upload(out);
  assert.equal(code, EXIT.OK, text);
  const commit = r.branchHead();
  assert.deepEqual(r.tree(commit).sort(), ["pr-7/0123456/list-orders.gif", "pr-7/0123456/map.png"]);
  assert.deepEqual(r.show(commit, "pr-7/0123456/map.png"), PNG);
  assert.equal(git(r.origin, "rev-parse", `${commit}^{tree}`).length, 40);
  assert.equal(git(r.origin, "rev-list", "--max-parents=0", "--count", commit), "1", "orphan: it shares no history with the code");
  const url = `${REPO_URL}/raw/${commit}/pr-7/0123456`;
  assert.ok(text.includes(url), text);
  const saved = JSON.parse(readFileSync(join(out, "media", "media-url.json"), "utf8"));
  assert.deepEqual({ url: saved.url, commit: saved.commit, head: saved.head }, { url, commit, head: HEAD });
  assert.deepEqual(snapshotOf(r.work), before, "the working tree, index, refs and config of the code checkout did not change");
  assert.equal(git(r.origin, "rev-parse", "refs/heads/main"), git(r.work, "rev-parse", "HEAD"), "the code branch is not touched");
});

test("media upload is idempotent: the same head again makes no commit and prints the same URL; other PRs and heads are kept", () => {
  const r = rig(), out = r.media();
  assert.equal(r.upload(out).code, EXIT.OK);
  const c1 = r.branchHead();
  const again = r.upload(out);
  assert.equal(again.code, EXIT.OK);
  assert.equal(r.branchHead(), c1, "no new commit");
  assert.equal(r.count(), 1);
  assert.ok(again.text.includes(`/raw/${c1}/pr-7/0123456`), again.text);
  // a new push of the same PR (new head) and another PR add directories next to the first
  const out2 = r.media("out2", Buffer.concat([PNG, Buffer.from("v2")]), "fedcba9876543210fedcba9876543210fedcba98");
  assert.equal(r.upload(out2).code, EXIT.OK);
  const c2 = r.branchHead();
  assert.equal(r.count(), 2);
  assert.deepEqual(r.tree(c2).sort(), ["pr-7/0123456/list-orders.gif", "pr-7/0123456/map.png", "pr-7/fedcba9/list-orders.gif", "pr-7/fedcba9/map.png"]);
  assert.deepEqual(r.show(c1, "pr-7/0123456/map.png"), PNG, "the old commit still has the old pictures (old comments keep working)");
  // changed pictures for the same head replace the directory in a new commit
  const out3 = r.media("out3", Buffer.concat([PNG, Buffer.from("v3")]));
  assert.equal(r.upload(out3).code, EXIT.OK);
  assert.equal(r.count(), 3);
  assert.deepEqual(r.show(r.branchHead(), "pr-7/0123456/map.png"), Buffer.concat([PNG, Buffer.from("v3")]));
});

test("media upload: --pr, --head and the picture names are checked before anything is cloned or pushed", () => {
  const r = rig(), out = r.media();
  const bad = (extra, re, o = out) => { const c = cap(); assert.throws(() => run(["media", "upload", "--from", o, "--repo", r.work, "--repo-url", REPO_URL, ...extra], r.env, c.log), re, extra.join(" ")); };
  bad(["--pr", "0"], /--pr/);
  bad(["--pr", "7/../8"], /--pr/);
  bad(["--pr", "7;id"], /--pr/);
  bad(["--pr", "7", "--head", "../../etc"], /--head/);
  bad(["--pr", "7", "--head", "abc123; rm -rf /"], /--head/);
  bad(["--pr", "7", "--head", "ABCDEF1"], /--head/);
  bad(["--pr", "7", "--head", "abc12"], /--head/);
  bad(["--pr", "7", "--branch", "--upload-pack=x"], /--branch/);
  bad([], /--pr/);
  for (const name of ["../x.png", "a/b.png", "/etc/passwd.png", "x.png/../../y.png", ".hidden.png", "a b.png", "x.svg", "x.png\n"]) {
    const o = r.media("evil");
    const mf = JSON.parse(readFileSync(join(o, "media", "manifest.json"), "utf8")); mf.files[0].file = name;
    writeFileSync(join(o, "media", "manifest.json"), JSON.stringify(mf));
    bad(["--pr", "7"], /그림 파일 이름|file name/, o);
  }
  const o2 = r.media("link"); // a symlink named like a picture must not be followed out of the folder
  writeFileSync(join(r.dir, "secret.txt"), "secret");
  symlinkSync(join(r.dir, "secret.txt"), join(o2, "media", "link.png"));
  const mf2 = JSON.parse(readFileSync(join(o2, "media", "manifest.json"), "utf8")); mf2.files[0].file = "link.png"; writeFileSync(join(o2, "media", "manifest.json"), JSON.stringify(mf2));
  bad(["--pr", "7"], /그림 파일/, o2);
  assert.equal(spawnSync("git", ["-C", r.origin, "rev-parse", "--verify", "-q", "refs/heads/nacholens-media"]).status, 1, "nothing was pushed");
  assert.equal(r.calls().length, 0, "gh was never called");
});

test("media upload: head defaults to report.json, then manifest.json; the path uses the first 7 characters", () => {
  const r = rig(), out = r.media("o", PNG, "abcdef0123456789abcdef0123456789abcdef01");
  assert.equal(r.upload(out).code, EXIT.OK);
  assert.ok(r.tree(r.branchHead()).every((f) => f.startsWith("pr-7/abcdef0/")));
  const o2 = r.media("o2", PNG, "1111111222222233333334444444555555566666"); // explicit --head wins
  assert.equal(r.upload(o2, ["--head", "9999999aaaaaaa"]).code, EXIT.OK);
  assert.ok(r.tree(r.branchHead()).some((f) => f.startsWith("pr-7/9999999/")));
});

test("media upload: no write permission (fork PR / read-only token) is a clear failure, or a logged skip with --skip-on-denied; other errors are never skipped", () => {
  const r = rig(), out = r.media();
  writeFileSync(join(r.origin, "hooks", "pre-receive"), "#!/bin/sh\necho 'remote: Permission to acme/shop.git denied to github-actions[bot].' >&2\nexit 1\n"); chmodSync(join(r.origin, "hooks", "pre-receive"), 0o755);
  assert.throws(() => run(["media", "upload", "--from", out, "--repo", r.work, "--repo-url", REPO_URL, "--pr", "7"], r.env, () => {}), /쓰기 권한이 없습니다.*--skip-on-denied/s);
  const c = cap();
  const code = run(["media", "upload", "--from", out, "--repo", r.work, "--repo-url", REPO_URL, "--pr", "7", "--skip-on-denied"], r.env, c.log);
  assert.equal(code, EXIT.OK);
  assert.match(c.text(), /건너뜁니다/);
  assert.ok(!existsSync(join(out, "media", "media-url.json")), "no URL is recorded for pictures that were not hosted");
  // not a permission problem: still an error, also with the flag
  const r2 = rig(), out2 = r2.media();
  assert.throws(() => run(["media", "upload", "--from", out2, "--repo", r2.work, "--repo-url", REPO_URL, "--pr", "7", "--remote", join(r2.dir, "no-such.git"), "--skip-on-denied"], r2.env, () => {}), /실패/);
});

test("media upload refuses a branch that is not a picture branch, so a wrong --branch can never rewrite code", () => {
  const r = rig(), out = r.media();
  const c = cap();
  assert.throws(() => run(["media", "upload", "--from", out, "--repo", r.work, "--repo-url", REPO_URL, "--pr", "7", "--branch", "main"], r.env, c.log), /그림 브랜치가 아닙니다/);
  assert.equal(git(r.origin, "rev-list", "--count", "main"), "1");
});

test("media upload retries when another job pushed to the media branch first (no force push)", () => {
  const r = rig(), out = r.media();
  assert.equal(r.upload(out).code, EXIT.OK);
  const tpl = join(r.dir, "tpl", "hooks"); mkdirSync(tpl, { recursive: true });
  const mark = join(r.dir, "raced");
  writeFileSync(join(tpl, "pre-push"), `#!/bin/sh
if [ ! -e "${mark}" ]; then
  : > "${mark}"
  t=$(mktemp -d)
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE sh -c "git clone -q '${r.origin}' $t/w && cd $t/w && git checkout -q nacholens-media && mkdir -p pr-99/aaaaaaa && echo x > pr-99/aaaaaaa/other.png && git add -A && git -c user.name=r -c user.email=r@example.com commit -qm racer && git push -q origin nacholens-media" >/dev/null 2>&1
fi
exit 0
`); chmodSync(join(tpl, "pre-push"), 0o755);
  const out2 = r.media("o2", Buffer.concat([PNG, Buffer.from("2")]), "2222222222222222222222222222222222222222");
  const c = cap();
  const code = run(["media", "upload", "--from", out2, "--repo", r.work, "--repo-url", REPO_URL, "--pr", "8"], { ...r.env, GIT_TEMPLATE_DIR: join(r.dir, "tpl") }, c.log);
  assert.equal(code, EXIT.OK, c.text());
  assert.ok(existsSync(mark), "the racing push really happened");
  const files = r.tree(r.branchHead());
  for (const f of ["pr-7/0123456/map.png", "pr-8/2222222/map.png", "pr-99/aaaaaaa/other.png"]) assert.ok(files.includes(f), `${f} in ${files}`);
  assert.equal(r.count(), 3, "initial + racer + ours: history only grew");
});

/* ───────── media prune ───────── */

function pruneRig() {
  const r = rig();
  for (const [pr, head] of [[3, "3333333aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], [4, "4444444aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], [5, "5555555aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], [6, "6666666aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], [6, "6666667aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], [9, "9999999aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]]) {
    assert.equal(run(["media", "upload", "--from", r.media(`o${pr}${head.slice(0, 7)}`, Buffer.concat([PNG, Buffer.from(head)]), head), "--repo", r.work, "--repo-url", REPO_URL, "--pr", String(pr)], r.env, () => {}), EXIT.OK);
  }
  r.state({ prs: [
    { number: 3, state: "MERGED", headRefOid: "3333333aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    { number: 4, state: "CLOSED", headRefOid: "4444444aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    { number: 5, state: "OPEN", headRefOid: "5555555aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    { number: 6, state: "OPEN", headRefOid: "6666667aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    // PR 9 is not in the list at all (e.g. beyond the list limit): it must be kept
  ] });
  return r;
}

test("media prune is a dry run by default: it lists the pictures of closed and merged PRs and changes nothing", () => {
  const r = pruneRig(), head = r.branchHead(), c = cap();
  const code = run(["media", "prune", "--repo", r.work, "--repo-url", REPO_URL], r.env, c.log);
  assert.equal(code, EXIT.OK, c.text());
  assert.match(c.text(), /pr-3 .*MERGED/); assert.match(c.text(), /pr-4 .*CLOSED/);
  assert.doesNotMatch(c.text(), /삭제 예정:.*pr-5/); assert.doesNotMatch(c.text(), /삭제 예정:.*pr-9/);
  assert.match(c.text(), /--apply/);
  assert.equal(r.branchHead(), head, "nothing pushed");
  const lists = r.calls().filter((a) => a[0] === "pr" && a[1] === "list");
  assert.equal(lists.length, 1); assert.ok(lists[0].includes("acme/shop") && lists[0].includes("all"), lists[0].join(" "));
});

test("media prune --apply deletes those directories in a NEW commit on top of the branch (no force, history kept, open and unknown PRs kept)", () => {
  const r = pruneRig(), before = r.branchHead(), c = cap();
  const code = run(["media", "prune", "--repo", r.work, "--repo-url", REPO_URL, "--apply"], r.env, c.log);
  assert.equal(code, EXIT.OK, c.text());
  const after = r.branchHead();
  assert.notEqual(after, before);
  assert.equal(git(r.origin, "rev-parse", `${after}^`), before, "a new commit on top: no rewrite");
  assert.equal(spawnSync("git", ["-C", r.origin, "merge-base", "--is-ancestor", before, after]).status, 0);
  const files = r.tree(after);
  assert.ok(files.every((f) => !f.startsWith("pr-3/") && !f.startsWith("pr-4/")), files.join());
  for (const keep of ["pr-5/5555555/map.png", "pr-6/6666666/map.png", "pr-6/6666667/map.png", "pr-9/9999999/map.png"]) assert.ok(files.includes(keep), keep);
  assert.ok(r.tree(before).includes("pr-3/3333333/map.png"), "old media commits still hold the pictures, so links in old comments keep working");
  assert.match(git(r.origin, "log", "-1", "--format=%s", after), /closed PRs.*#3.*#4/);
  const c2 = cap(); // idempotent
  assert.equal(run(["media", "prune", "--repo", r.work, "--repo-url", REPO_URL, "--apply"], r.env, c2.log), EXIT.OK);
  assert.equal(r.branchHead(), after);
  assert.match(c2.text(), /지울 것이 없습니다/);
});

test("media prune --superseded also drops older head directories of PRs that are still open", () => {
  const r = pruneRig();
  assert.equal(run(["media", "prune", "--repo", r.work, "--repo-url", REPO_URL, "--apply", "--superseded"], r.env, () => {}), EXIT.OK);
  const files = r.tree(r.branchHead());
  assert.ok(!files.some((f) => f.startsWith("pr-6/6666666/")), "older head of open PR 6 removed");
  assert.ok(files.includes("pr-6/6666667/map.png"), "its current head kept");
  assert.ok(files.includes("pr-5/5555555/map.png") && files.includes("pr-9/9999999/map.png"));
});

test("media prune: no media branch means nothing to do; a refused push is reported like upload does", () => {
  const r = rig(), c = cap();
  assert.equal(run(["media", "prune", "--repo", r.work, "--repo-url", REPO_URL], r.env, c.log), EXIT.OK);
  assert.match(c.text(), /그림 브랜치가 아직 없습니다/);
  const p = pruneRig();
  writeFileSync(join(p.origin, "hooks", "pre-receive"), "#!/bin/sh\necho 'remote: Permission to acme/shop.git denied to github-actions[bot].' >&2\nexit 1\n"); chmodSync(join(p.origin, "hooks", "pre-receive"), 0o755);
  assert.throws(() => run(["media", "prune", "--repo", p.work, "--repo-url", REPO_URL, "--apply"], p.env, () => {}), /쓰기 권한이 없습니다/);
  const c2 = cap();
  assert.equal(run(["media", "prune", "--repo", p.work, "--repo-url", REPO_URL, "--apply", "--skip-on-denied"], p.env, c2.log), EXIT.OK);
  assert.match(c2.text(), /건너뜁니다/);
});

test("media: unknown subcommand and missing --repo/--remote are usage errors", () => {
  assert.throws(() => run(["media"], {}, () => {}), /upload|prune/);
  assert.throws(() => run(["media", "frobnicate"], {}, () => {}), /upload|prune/);
});

/* ───────── the sticky PR comment ───────── */

const mine = (id, extra = "") => ({ id, body: `${PR_MARK}\n## old ${extra}` });

test("parseJsonStream reads the concatenated pages gh --paginate prints ([..][..]) and ignores brackets inside strings", () => {
  assert.deepEqual(parseJsonStream('[{"id":1,"body":"a]["}][{"id":2,"body":"b"}]\n[]'), [{ id: 1, body: "a][" }, { id: 2, body: "b" }]);
  assert.deepEqual(parseJsonStream(""), []);
  assert.throws(() => parseJsonStream('[{"id":1}'), /JSON/);
});

test("comment upsert: no marker comment -> POST a new one; the body is the file, byte for byte", () => {
  const r = rig(); r.state({ comments: { 12: [{ id: 1, body: "LGTM" }, { id: 2, body: "see `<!-- nacholens:pr -->` in my other PR" }] } });
  const f = join(r.dir, "pr.md"); writeFileSync(f, `${PR_MARK}\n## new ✓\n`);
  const res = upsertComment({ repoUrl: REPO_URL, pr: 12, file: f, env: r.env, log: () => {} });
  assert.equal(res.action, "created");
  const posts = r.calls().filter((a) => a.includes("POST"));
  assert.equal(posts.length, 1); assert.equal(r.calls().filter((a) => a.includes("PATCH")).length, 0);
  assert.equal(r.state().comments[12].at(-1).body, readFileSync(f, "utf8"));
  assert.equal(r.state().comments[12].length, 3, "the other comments are untouched");
  assert.match(res.url, /issuecomment-1003$/);
});

test("comment upsert: one marker comment -> PATCH that one (same id), nothing new is posted", () => {
  const r = rig(); r.state({ comments: { 12: [{ id: 1, body: "hi" }, mine(77)] } });
  const f = join(r.dir, "pr.md"); writeFileSync(f, `${PR_MARK}\n## new\n`);
  const res = upsertComment({ repoUrl: REPO_URL, pr: 12, file: f, env: r.env, log: () => {} });
  assert.deepEqual([res.action, res.id], ["updated", 77]);
  assert.equal(r.calls().filter((a) => a.includes("POST")).length, 0);
  assert.equal(r.state().comments[12].find((c) => c.id === 77).body, readFileSync(f, "utf8"));
  assert.equal(r.state().comments[12].length, 2);
  const patch = r.calls().find((a) => a.includes("PATCH")); assert.ok(patch.some((x) => x === "repos/acme/shop/issues/comments/77"), patch.join(" "));
});

test("comment upsert: two or more marker comments (also across pages) -> the first one is updated, the rest are left alone and mentioned", () => {
  const r = rig(); r.state({ comments: { 12: [{ id: 1, body: "x" }, { id: 2, body: "y" }, mine(30), { id: 4, body: "z" }, mine(50), mine(60)] } });
  const f = join(r.dir, "pr.md"); writeFileSync(f, `${PR_MARK}\n## new\n`);
  const c = cap();
  const res = upsertComment({ repoUrl: REPO_URL, pr: 12, file: f, env: r.env, log: c.log });
  assert.deepEqual([res.action, res.id, res.duplicates], ["updated", 30, [50, 60]]);
  assert.match(c.text(), /3개/);
  const cs = r.state().comments[12];
  assert.equal(cs.find((x) => x.id === 30).body, readFileSync(f, "utf8"));
  assert.match(cs.find((x) => x.id === 50).body, /old/); assert.match(cs.find((x) => x.id === 60).body, /old/);
});

test("comment upsert: a refused write says why; the file must carry the marker", () => {
  const r = rig(); r.state({ deny: true, comments: { 12: [] } });
  const f = join(r.dir, "pr.md"); writeFileSync(f, `${PR_MARK}\n## new\n`);
  assert.throws(() => upsertComment({ repoUrl: REPO_URL, pr: 12, file: f, env: r.env, log: () => {} }), (e) => e.denied === true && /쓰기 권한이 없습니다/.test(e.message));
  writeFileSync(f, "no marker here\n");
  assert.throws(() => upsertComment({ repoUrl: REPO_URL, pr: 12, file: f, env: r.env, log: () => {} }), /<!-- nacholens:pr -->/);
});

/* ───────── pr: picks up the hosted pictures, posts the comment ───────── */

function builtDemo(r) {
  const { dir, base } = makeDemoRepo(join(r.dir, "demo"));
  const out = join(r.dir, "build");
  assert.equal(run(["build", "--repo", dir, "--model", join(root, "models/demo-shop/model.json"), "--base", base, "--out", out, "--format", "html"], {}, () => {}), EXIT.OK);
  return out;
}

test("pr links the pictures that `media upload` hosted, without --media-url; an explicit --media-url wins; a stale upload (other head) is ignored", () => {
  const r = rig(), out = builtDemo(r);
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  const m = join(out, "media"); mkdirSync(m);
  writeFileSync(join(m, "map.png"), PNG); writeFileSync(join(m, "list-orders.gif"), Buffer.from("GIF89a"));
  writeFileSync(join(m, "manifest.json"), JSON.stringify({ schemaVersion: 1, head: report.head, files: [
    { kind: "map", theme: "light", useCase: "list-orders", file: "map.png", width: 800, height: 500 },
    { kind: "flow", theme: "light", useCase: "list-orders", file: "list-orders.gif", width: 800, height: 500 }] }));
  assert.equal(run(["media", "upload", "--from", out, "--repo", r.work, "--repo-url", REPO_URL, "--pr", "7"], r.env, () => {}), EXIT.OK);
  const url = JSON.parse(readFileSync(join(m, "media-url.json"), "utf8")).url;
  const c = cap();
  assert.equal(run(["pr", "--from", out, "--repo-url", REPO_URL, "--pr", "7"], {}, c.log), EXIT.OK, c.text());
  const md = readFileSync(join(out, "pr.md"), "utf8");
  assert.ok(md.includes(`<img src="${url}/map.png"`), md.slice(0, 600));
  assert.match(c.text(), /media-url\.json/);
  assert.equal(run(["pr", "--from", out, "--repo-url", REPO_URL, "--pr", "7", "--media-url", "https://example.org/pics"], {}, () => {}), EXIT.OK);
  assert.ok(readFileSync(join(out, "pr.md"), "utf8").includes('src="https://example.org/pics/map.png"'));
  // pictures hosted for another commit are not linked into a comment for this one
  const saved = JSON.parse(readFileSync(join(m, "media-url.json"), "utf8")); saved.head = "f".repeat(40); writeFileSync(join(m, "media-url.json"), JSON.stringify(saved));
  const c2 = cap();
  assert.equal(run(["pr", "--from", out, "--repo-url", REPO_URL, "--pr", "7"], {}, c2.log), EXIT.OK);
  assert.ok(!readFileSync(join(out, "pr.md"), "utf8").includes("<img"), "no pictures for the wrong commit");
  assert.match(c2.text(), /다른 커밋/);
});

test("pr --comment writes pr.md, then creates the comment; the next run updates the same one", () => {
  const r = rig(), out = builtDemo(r); r.state({ comments: { 7: [{ id: 5, body: "hello" }] } });
  const go = () => { const c = cap(); const code = run(["pr", "--from", out, "--repo-url", REPO_URL, "--pr", "7", "--comment"], r.env, c.log); return { code, text: c.text() }; };
  const a = go(); assert.equal(a.code, EXIT.OK, a.text);
  assert.equal(r.state().comments[7].length, 2);
  assert.equal(r.state().comments[7][1].body, readFileSync(join(out, "pr.md"), "utf8"));
  assert.match(a.text, /코멘트를 새로 올렸습니다.*issuecomment-1002/);
  const b = go(); assert.equal(b.code, EXIT.OK, b.text);
  assert.equal(r.state().comments[7].length, 2, "still one nacholens comment");
  assert.match(b.text, /코멘트를 갱신했습니다/);
  assert.throws(() => run(["pr", "--from", out, "--comment"], r.env, () => {}), /--comment.*--repo-url.*--pr|--pr.*--repo-url/);
});

test("pr --comment on a fork PR (read-only token): fails clearly, or skips with exit 0 and a log line under --skip-on-denied", () => {
  const r = rig(), out = builtDemo(r); r.state({ deny: true, comments: { 7: [] } });
  assert.throws(() => run(["pr", "--from", out, "--repo-url", REPO_URL, "--pr", "7", "--comment"], r.env, () => {}), /쓰기 권한이 없습니다/);
  const c = cap();
  assert.equal(run(["pr", "--from", out, "--repo-url", REPO_URL, "--pr", "7", "--comment", "--skip-on-denied"], r.env, c.log), EXIT.OK);
  assert.match(c.text(), /건너뜁니다/);
  assert.ok(existsSync(join(out, "pr.md")), "the comment text is still written for the job log or an artifact");
  assert.equal(r.state().comments[7].length, 0);
});

/* ───────── no Chrome on the runner ───────── */

test("snap --optional without a Chrome: exit 0, says so, writes no pictures; pr then makes the Mermaid-only comment", () => {
  const r = rig(), out = builtDemo(r);
  const page = join(out, "demo-shop.html");
  const noChrome = { PATH: "/nonexistent", PLAYWRIGHT_BROWSERS_PATH: join(r.dir, "none"), CHROME: "", HOME: r.dir };
  const c = cap();
  const mk = (extra) => spawnSync(process.execPath, [join(root, "src/cli.js"), "snap", "--page", page, "--out", join(out, "media"), ...extra], { env: noChrome, encoding: "utf8" });
  const plain = mk([]);
  assert.equal(plain.status, EXIT.USAGE, "without --optional a missing Chrome is an error");
  assert.match(plain.stderr, /Chrome/);
  const opt = mk(["--optional"]);
  assert.equal(opt.status, EXIT.OK, opt.stderr);
  assert.match(opt.stdout, /Chrome.*건너뜁니다/);
  assert.ok(!existsSync(join(out, "media", "manifest.json")), "no half-written media");
  assert.equal(run(["pr", "--from", out, "--repo-url", REPO_URL, "--pr", "7"], {}, c.log), EXIT.OK);
  const md = readFileSync(join(out, "pr.md"), "utf8");
  assert.ok(md.includes("```mermaid") && !md.includes("<img"), "Mermaid diagrams only");
  // in-process, with the same environment
  const lines = []; const code = run(["snap", "--page", page, "--out", join(out, "media2"), "--optional"], noChrome, (m) => lines.push(m));
  return Promise.resolve(code).then((v) => { assert.equal(v, EXIT.OK); assert.ok(lines.some((l) => /건너뜁니다/.test(l))); });
});
