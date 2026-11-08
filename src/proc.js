// Running `git` and `gh`: fixed argv arrays only (never a shell), a prompt-free environment, and one place that
// recognises "you may not write here" (a fork pull request, a read-only token) so callers can fail clearly or skip.
import { spawnSync } from "node:child_process";

/** Thrown when GitHub or git says the token may not write. `denied` lets callers skip instead of failing. */
export class DeniedError extends Error {
  constructor(message) { super(message); this.name = "DeniedError"; this.denied = true; }
}

// GitHub phrases: "HTTP 403", "Resource not accessible by integration", "Permission to o/r.git denied to x",
// "Permission denied", "Must have admin rights", "insufficient scope"
export const DENIED_RE = /\b403\b|Resource not accessible|Permission to \S+ denied|Permission denied|denied to \S+|Must have (?:admin|write)|insufficient (?:permission|scope)/i;

/** Runs a program and returns { code, stdout, stderr }; throws only when the program cannot start. */
export function exec(file, args, { cwd, env, input } = {}) {
  const r = spawnSync(file, args, {
    cwd, input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
  });
  if (r.error) {
    if (r.error.code === "ENOENT") throw new Error(`${file} 을(를) 실행할 수 없습니다: PATH 에서 찾지 못했습니다`);
    throw r.error;
  }
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export const firstLine = (s) => String(s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
/** the first few non-empty lines, enough to see why git or gh refused */
export const brief = (s, n = 4) => String(s ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, n).join(" | ");

export const deniedMessage = (detail) => `쓰기 권한이 없습니다 (포크 PR 이거나 읽기 전용 토큰일 수 있습니다): ${detail}`;

/** Turns a failed result into DeniedError (permission) or Error (anything else). */
export function fail(what, res) {
  const detail = brief(res.stderr) || brief(res.stdout) || `종료 코드 ${res.code}`;
  if (DENIED_RE.test(res.stderr + "\n" + res.stdout)) return new DeniedError(deniedMessage(detail));
  return new Error(`${what} 실패: ${detail}`);
}
