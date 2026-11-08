// One sticky nacholens comment per pull request, through `gh api` (explicit owner/repo, so no checkout is needed):
//   no comment starting with the marker -> POST a new one
//   one or more                         -> PATCH the first (oldest) one; the others are left alone and named
// Only a comment that STARTS with the marker counts, so a comment that merely quotes it is never overwritten.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PR_MARK } from "./pr.js";
import { exec, fail } from "./proc.js";

/** gh --paginate prints the pages back to back ([..][..]); returns every element of every page. */
export function parseJsonStream(text) {
  const out = [], s = String(text);
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "[" || ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth < 0) throw new Error("gh 응답이 올바른 JSON 이 아닙니다");
      if (depth === 0) { const v = JSON.parse(s.slice(start, i + 1)); if (Array.isArray(v)) out.push(...v); else out.push(v); }
    }
  }
  if (depth !== 0 || inStr) throw new Error("gh 응답이 올바른 JSON 이 아닙니다 (중간에 끊김)");
  return out;
}

/** https://host/owner/repo -> { host, slug } */
export function repoOf(repoUrl) {
  const m = /^https:\/\/([A-Za-z0-9.-]+(?::\d+)?)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(repoUrl ?? ""));
  if (!m) throw new Error("--repo-url 은 https://<호스트>/<owner>/<repo> 형식이어야 합니다");
  return { host: m[1], slug: `${m[2]}/${m[3]}` };
}

export const hostArgs = (host) => (host === "github.com" ? [] : ["--hostname", host]);

/**
 * @returns {{ action: "created"|"updated", id: number, url: string|null, duplicates: number[] }}
 * @throws DeniedError when GitHub refuses the write (fork pull request, read-only token)
 */
export function upsertComment({ repoUrl, pr, file, env = process.env, log = () => {} }) {
  const { host, slug } = repoOf(repoUrl);
  if (!/^[1-9][0-9]{0,8}$/.test(String(pr))) throw new Error("--pr 은 1 이상의 PR 번호여야 합니다");
  const path = resolve(file), body = readFileSync(path, "utf8");
  if (!body.startsWith(PR_MARK)) throw new Error(`코멘트 파일은 ${PR_MARK} 로 시작해야 합니다 (nacholens pr 가 만든 pr.md): ${file}`);
  const gh = (args) => exec("gh", args, { env });

  const list = gh(["api", "--paginate", ...hostArgs(host), `repos/${slug}/issues/${pr}/comments`]);
  if (list.code !== 0) throw fail("PR 코멘트 목록 읽기", list);
  const ours = parseJsonStream(list.stdout).filter((c) => c && typeof c.body === "string" && c.body.startsWith(PR_MARK));

  const send = ours.length
    ? gh(["api", "-X", "PATCH", ...hostArgs(host), `repos/${slug}/issues/comments/${ours[0].id}`, "-F", `body=@${path}`])
    : gh(["api", "-X", "POST", ...hostArgs(host), `repos/${slug}/issues/${pr}/comments`, "-F", `body=@${path}`]);
  if (send.code !== 0) throw fail(ours.length ? "PR 코멘트 갱신" : "PR 코멘트 작성", send);

  let reply = {};
  try { reply = JSON.parse(send.stdout || "{}"); } catch { /* the write worked; only the link is missing */ }
  const res = { action: ours.length ? "updated" : "created", id: ours.length ? ours[0].id : reply.id ?? null, url: reply.html_url ?? null, duplicates: ours.slice(1).map((c) => c.id) };
  log(`${res.action === "updated" ? "코멘트를 갱신했습니다" : "코멘트를 새로 올렸습니다"}${res.url ? `: ${res.url}` : ""}`);
  if (res.duplicates.length) log(`⚠ nacholens 코멘트가 ${ours.length}개 있어 첫 번째(${ours[0].id})만 갱신했습니다. 나머지(${res.duplicates.join(", ")})는 손대지 않았습니다.`);
  return res;
}
