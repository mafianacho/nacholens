#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { validateModel, validateChanges } from "./model.js";
import { verifyEvidence, verifyEvidenceWith, collectEvidence } from "./verify.js";
import { buildPage, artifactManifest, formatForAgent, LANGS } from "./page.js";
import { openRepo } from "./gitio.js";
import { overlayFromRepo } from "./diff.js";
import { makeTemplate } from "./template.js";
import { scanRepo, formatScan } from "./scan.js";
import { makeDemoRepo } from "./demo.js";
import { install, version } from "./install.js";
import { DEPTHS, normalizeDepth, depthName, resolveDepth, checkDepth, sizeOf, scanDiff, formatScanDiff } from "./depth.js";
import { buildReview, validateIntent, checkIntent, buildImpact, discoverTests, isTestFile } from "./review.js";

export const EXIT = { OK: 0, MODEL: 1, USAGE: 2, STRICT: 3, INTENT: 4 };

const USAGE = `nacholens — AI 가 바꾼 백엔드 변경을 유즈케이스 흐름 애니메이션으로 보여 줍니다

  한 줄 실행 (대상 저장소 + 비교 구간):
    nacholens build --repo <경로> --base <ref> [--head <ref>] [--out <dir>] [--agent claude|...]

  바로 보기 (대상 저장소 없이, 번들된 데모 앱):
    nacholens demo [--out <dir>] [--agent claude|...] [--lang en|ko]

  에이전트에 설치 (스킬 + 단독 실행 CLI 사본, 의존성 없음):
    nacholens install --claude [--into <프로젝트>] [--global] [--force]   .claude/skills/nacholens
    nacholens install --agents [--into <프로젝트>] [--force]             .nacholens/ + AGENTS.md 블록
    nacholens install --to <스킬 폴더> [--force]                           <폴더>/nacholens

  단계별:
    nacholens init     --repo <경로> [--model <파일>] [--name <제품명>]   빈 모델 템플릿 생성
    nacholens scan     --repo <경로> [--json] [--limit N]                  모델 초안용 후보(스택·라우트·게이트웨이·DB·외부 주소·HTTP 호출)
    nacholens scan     --repo <경로> --depth diff --base <ref> [--head <ref>] [--json]   변경 줄에 닿는 모델링 후보 (diff 수준)
    nacholens validate [<model.json>] [--repo <경로>] [--changes <파일>] [--depth ...] [--base <ref>]
    nacholens verify   [<model.json>] (--repo <경로> [--ref <ref>] [--base <ref>] | --source <디렉터리>) [--depth ...]
    nacholens diff     --repo <경로> --base <ref> [--head <ref>] [--model <파일>] [--out <changes.json>] [--strict]
    nacholens build    <model.json> [--changes <파일>] ...                (저장소 없이 만들기)
    nacholens intent   --model <파일> --intent <intent.json> [--repo <경로> --base <ref>] [--strict-intent]   기획 의도 대조
    nacholens impact   --repo <경로> --base <ref> [--head <ref>] [--model <파일>]                           회귀 지도 (다시 확인할 유즈케이스)

  검토 패널 (build):  --before-model <파일>  변경 전 모델 (있으면 흐름 자체를 전/후 비교)
                      --intent <intent.json>  기획 의도 (기대사항을 모델과 대조)
              회귀 지도는 --repo --base 가 있으면 자동 (테스트는 경로 문자열로 찾는 추정)

  깊이:       --depth 1|2|3  또는  diff|brief|full   (scan·validate·verify·build; 모델의 선택 필드 depth 와 같은 값)
              1 변경만 (diff)   변경(--base..--head)이 닿는 유즈케이스·단계와 그 단계가 지나는 컴포넌트·table 만. 얕다는 뜻이 아니라 변경에 한정한다는 뜻
              2 한눈에 (brief)  전체 구성(컴포넌트·연결·주요 유즈케이스·datastore), drill-down(parts·wires·columns·endpoints·trace·payload) 없음
              3 자세히 (full)   전체 구성 + 스키마가 허용하는 세부 전부
              수준을 어기면 경고(종료 코드 영향 없음). 모델에 depth 가 없고 --depth 도 없으면 수준 검사를 하지 않습니다.

  공통 옵션:  --model <파일>   모델 위치 (기본 <repo>/.nacholens/model.json)
              --head <ref>     기본 HEAD
              --out <dir>      기본 ./nacholens-out (저장소 없이 만들 때는 ./dist)
              --format html|artifact|both|auto   auto(기본): --agent/NACHOLENS_AGENT 가 claude* 이면 artifact, 아니면 html
              --lang en|ko     화면 글자 언어 (기본 en; 모델 글자는 쓴 그대로)
              --strict         모델에 없는 변경이 있으면 종료 코드 3

  nacholens --version   설치된 CLI 버전 (깊이는 0.3.2 부터)

  종료 코드:  0 정상 · 1 모델/근거 문제(고쳐야 함) · 2 사용법/입출력/git 오류 · 3 --strict 에서 모델에 없는 변경 발견
              4 --strict-intent 에서 기획 의도가 미충족
`;

const BOOL = new Set(["strict", "strict-intent", "json", "help", "claude", "agents", "global", "force"]);
function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (BOOL.has(k)) { opt[k] = true; continue; }
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} 에 값이 필요합니다`);
      opt[k] = v; i++;
    } else pos.push(a);
  }
  return { pos, opt };
}
const readJson = (p, what) => {
  try { return JSON.parse(readFileSync(resolve(p), "utf8")); }
  catch (e) { throw new Error(`${what ?? "파일"} 을 읽을 수 없습니다 (${p}): ${e.message}`); }
};
const defaultModelPath = (repo) => join(resolve(repo), ".nacholens", "model.json");

function printErrors(errors, log) {
  const todo = errors.filter((e) => e.includes("채워 주세요"));
  const rest = errors.filter((e) => !e.includes("채워 주세요"));
  rest.forEach((e) => log("✗ " + e));
  if (todo.length) {
    log(`✗ 모델 템플릿에 채워야 할 곳이 ${todo.length}개 있습니다 (JSON 경로 → 무엇을 쓸지):`);
    todo.forEach((e) => log("   - " + e.replace(/^model\./, "").replace(": 채워 주세요 →", "  →")));
    log("  각 TODO 를 실제 코드에서 확인한 내용과 근거(파일:줄)로 바꾼 뒤 다시 실행하세요. 가이드: skills/nacholens/SKILL.md");
  }
}

// evidence without `contains` still checks the file and range, but cannot notice that the lines drifted onto other code
function warnNoContains(model, log) {
  const n = collectEvidence(model).filter(({ e }) => e.contains === undefined).length;
  if (n) log(`⚠ contains 가 없는 근거 ${n}건 — 줄이 다른 코드로 밀려도 검증이 알아채지 못합니다. 각 근거에 줄 안의 고유한 문자열을 contains 로 적으세요.`);
}

const codeUnmapped = (o) => (o.unmapped ?? []).filter((u) => u.category !== "style" && u.category !== "config");
function summarize(o, log) {
  const style = o.unmapped.length - codeUnmapped(o).length;
  log(`변경 단계 ${o.steps.length} · 변경 컴포넌트 ${o.components.length} · 모델에 없는 변경 코드 ${codeUnmapped(o).length} · 스타일·설정 ${style} · 무시한 파일 ${o.ignored.length}`);
  o.steps.forEach((s) => log(`  단계  ${s.useCase}/${s.step}  [${s.change}]`));
  o.components.forEach((c) => log(`  컴포넌트  ${c.id}  [${c.change}]`));
  o.unmapped.forEach((u) => log(`  ${u.category === "style" || u.category === "config" ? "·" : "⚠"} 모델에 없는 변경${u.category === "style" ? "(스타일)" : u.category === "config" ? "(설정·의존성)" : ""}  ${u.file} (${u.status}, 줄 ${u.lines.length > 60 ? u.lines.slice(0, 57) + "…" : u.lines})`));
  if (o.ignored.length) log(`  (무시: ${o.ignored.map((i) => `${i.file}[${i.reason}]`).join(", ")})`);
}

function initTemplate(repo, modelPath, name) {
  if (existsSync(modelPath)) throw new Error(`이미 모델이 있습니다: ${modelPath}`);
  const t = makeTemplate({ slug: repo.remoteSlug(), commit: repo.resolve("HEAD"), name: name ?? basename(resolve(repo.path)) });
  mkdirSync(dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, JSON.stringify(t, null, 2) + "\n");
  return t;
}

/** test files at head that mention routes: read-only, capped so a huge repo stays fast */
function loadTests(repo, headSha, changes) {
  const names = repo.files(headSha).filter(isTestFile).slice(0, 600);
  const files = [];
  for (const path of names) { const text = repo.show(headSha, path); if (text !== null && text.length <= 400_000) files.push({ path, text }); }
  const changed = (changes?.ignored ?? []).filter((i) => i.reason === "test").map((i) => i.file);
  return { files, changed };
}

/** compare / intent / impact for the review panel. Returns { review, intentReport, code } (code != 0 -> stop) */
function makeReview(model, changes, opt, repo, log) {
  let beforeModel = null, intent = null, tests = null;
  if (opt["before-model"]) {
    beforeModel = readJson(opt["before-model"], "변경 전 모델");
    const errs = validateModel(beforeModel);
    if (errs.length) { log("변경 전 모델이 올바르지 않습니다:"); printErrors(errs, log); return { code: EXIT.MODEL }; }
  }
  if (opt.intent) {
    intent = readJson(opt.intent, "기획 의도");
    const errs = validateIntent(intent, model);
    if (errs.length) { errs.forEach((e) => log("✗ " + e)); return { code: EXIT.MODEL }; }
  }
  if (repo && changes) {
    const head = repo.resolve(opt.head ?? "HEAD");
    const t = loadTests(repo, head, changes);
    tests = discoverTests(model, t.files, t.changed);
  }
  return { review: buildReview(model, changes, { beforeModel, intent, tests }), code: EXIT.OK };
}

function logIntent(rep, log) {
  const s = rep.summary;
  log(`기획 의도 「${rep.title}」: 충족 ${s.met} · 미충족 ${s.unmet} · 확인 불가 ${s.unknown} (전체 ${s.total})` + (s.changedSteps ? ` · 기획에 연결되지 않은 변경 ${s.uncovered}/${s.changedSteps}` : ""));
  rep.results.forEach((r) => log(`  ${{ met: "✓ 충족  ", unmet: "✗ 미충족", unknown: "? 불명  " }[r.status]} ${r.id}  ${r.text}${r.touched ? "  [이번 변경이 건드림]" : ""}\n             ${r.reason}`));
  rep.uncovered.forEach((u) => log(`  ⚠ 기획에 연결되지 않은 변경  ${u.useCase}/${u.step} [${u.change}] ${u.label}`));
}
function logImpact(im, log) {
  const s = im.summary;
  log(`회귀 지도: 다시 확인할 유즈케이스 ${s.direct + s.indirect}개 (직접 ${s.direct} · 간접 ${s.indirect})` + (s.testsKnown ? ` · 테스트를 찾지 못한 곳 ${s.withoutTests}` : " · 테스트 확인 안 함"));
  im.useCases.forEach((u) => {
    log(`  ${u.relation === "direct" ? "직접" : "간접"}  ${u.id}  (${u.trigger})  테스트: ${{ "covered-changed": "있음·이번에 바뀜", covered: "있음·안 바뀜", "none-found": "찾지 못함", unknown: "확인 안 함" }[u.tests.state]}`);
    u.direct.forEach((d) => log(`        바뀐 단계 ${d.step} [${d.change}] ${d.label}`));
    u.reasons.forEach((r) => log(`        ${r.text}  (단계 ${r.step})`));
  });
}

/** --depth against the model's own depth, plus the diff scope when there is one. `{ code }` != 0 stops the command. */
function applyDepth(model, opt, { changes = null, repo = null } = {}) {
  const r = resolveDepth(model, opt.depth);
  if (r.error) return { code: EXIT.MODEL, error: r.error };
  const out = { code: EXIT.OK, depth: r.depth, declared: r.declared, warnings: [], notes: [], scopeWarnings: [] };
  if (!r.depth) return out;
  let scope = changes;
  if (r.depth === "diff" && !scope && repo && opt.base) {
    const o = overlayFromRepo(repo, model, opt.base, opt.head ?? "HEAD");
    scope = o.overlay; out.scopeWarnings = o.warnings;
  }
  if (r.depth === "diff" && !scope && opt.depth === "diff")
    throw new Error("--depth diff 는 변경 범위가 필요합니다: --repo 와 --base (또는 --changes)\n" + USAGE);
  const c = checkDepth(model, r.depth, { changes: scope });
  out.warnings = c.warnings; out.notes = c.notes; out.scope = scope;
  return out;
}
function logDepth(d, model, log) {
  if (!d.depth) return;
  const z = sizeOf(model);
  log(`${depthName(d.depth)}${d.declared ? "" : " (--depth 로 지정, 모델에 depth 선언 없음)"} · 컴포넌트 ${z.components} · 연결 ${z.links} · 유즈케이스 ${z.useCases} · 단계 ${z.steps} · 상세 parts ${z.parts} · wires ${z.wires} · tables ${z.tables}(columns ${z.columns}) · endpoints ${z.endpoints}`);
  d.scopeWarnings.forEach((w) => log("⚠ " + w));
  d.warnings.forEach((w) => log("⚠ " + w));
  d.notes.forEach((n) => log("· " + n));
}

export function run(argv, env = process.env, log = console.log) {
  const [cmd, ...rest] = argv;
  if (cmd === "--version" || cmd === "-v" || cmd === "version") { log(version()); return EXIT.OK; }
  if (!cmd || cmd === "help" || cmd === "--help") { log(USAGE); return EXIT.OK; }
  const { pos, opt } = parseArgs(rest);
  if (opt.depth !== undefined) opt.depth = normalizeDepth(opt.depth); // 1|2|3 -> diff|brief|full (usage error otherwise)
  if (opt.help) { log(USAGE); return EXIT.OK; }

  if (cmd === "init") {
    if (!opt.repo) throw new Error("--repo 가 필요합니다\n" + USAGE);
    const repo = openRepo(opt.repo);
    const modelPath = resolve(opt.model ?? defaultModelPath(opt.repo));
    initTemplate(repo, modelPath, opt.name);
    log(`생성: ${modelPath}`);
    log("다음: ① nacholens scan --repo … 로 후보를 보고 ② 코드를 읽으며 TODO 를 채운 뒤 ③ nacholens validate --repo … 로 남은 곳을 확인하세요.");
    return EXIT.OK;
  }

  if (cmd === "scan") {
    if (!opt.repo) throw new Error("--repo 가 필요합니다\n" + USAGE);
    const repo = openRepo(opt.repo);
    if (opt.depth === "diff") {
      if (!opt.base) throw new Error("scan --depth diff 는 --base 가 필요합니다 (비교할 이전 ref)\n" + USAGE);
      const d = scanDiff(repo, opt.base, opt.head ?? "HEAD");
      log(opt.json ? JSON.stringify(d, null, 2) : formatScanDiff(d));
      return EXIT.OK;
    }
    // brief needs the composition, not every call site: fewer leads per section unless --limit says otherwise
    const limit = opt.limit ? Math.max(1, Number(opt.limit) || 60) : opt.depth === "brief" ? 25 : 60;
    const r = scanRepo(resolve(opt.repo), { limit });
    if (opt.depth) r.depth = opt.depth;
    const guide = { brief: "brief 수준: 컴포넌트·연결·주요 유즈케이스·datastore 만 쓰세요. parts·wires·columns·endpoints·trace·payload 는 쓰지 않습니다.", full: "full 수준: 전체 구성에 더해 table·column(마이그레이션 근거), 서비스 내부 parts·wires, endpoints, trace, data, payload, transforms 까지 쓰세요." }[opt.depth];
    log(opt.json ? JSON.stringify(r, null, 2) : (guide ? guide + "\n\n" : "") + formatScan(r));
    return EXIT.OK;
  }

  if (cmd === "install") return install(opt, env, log).code;

  if (cmd === "demo") {
    const bundled = join(dirname(fileURLToPath(import.meta.url)), "..", "models", "demo-shop", "model.json");
    if (!existsSync(bundled) || !existsSync(join(dirname(bundled), "..", "..", "demo"))) throw new Error("번들된 데모가 없습니다 (nacholens 저장소 전체가 필요합니다)");
    const dir = mkdtempSync(join(tmpdir(), "nacholens-demo-"));
    rmSync(dir, { recursive: true });
    const { base } = makeDemoRepo(dir);
    log(`데모 저장소: ${dir} (커밋 2개: v1 → v2)`);
    const args = ["build", "--repo", dir, "--model", bundled, "--base", base, "--out", opt.out ?? "nacholens-demo"];
    if (opt.format) args.push("--format", opt.format);
    if (opt.agent) args.push("--agent", opt.agent);
    if (opt.lang) args.push("--lang", opt.lang);
    if (opt.depth) args.push("--depth", opt.depth);
    return run(args, env, log);
  }

  const modelArg = pos[0] ?? opt.model ?? (opt.repo ? defaultModelPath(opt.repo) : null);
  if (!modelArg) throw new Error("model.json 경로(또는 --repo)가 필요합니다\n" + USAGE);
  const needModel = () => {
    if (!existsSync(resolve(modelArg))) throw new Error(`모델이 없습니다: ${modelArg}. 새로 만들려면: nacholens init --repo <경로>`);
    return readJson(modelArg, "모델");
  };

  if (cmd === "intent" || cmd === "impact") {
    const model = needModel();
    const errors = validateModel(model);
    if (errors.length) { printErrors(errors, log); return EXIT.MODEL; }
    let changes = null, repo = null;
    if (opt.changes) changes = readJson(opt.changes, "변경 오버레이");
    else if (opt.repo && opt.base) {
      repo = openRepo(opt.repo);
      const r = overlayFromRepo(repo, model, opt.base, opt.head ?? "HEAD");
      changes = r.overlay; r.warnings.forEach((w) => log("⚠ " + w));
    } else if (cmd === "impact") throw new Error("impact 는 --repo 와 --base (또는 --changes) 가 필요합니다\n" + USAGE);
    if (changes) { const bad = validateChanges(changes, model); if (bad.length) { printErrors(bad, log); return EXIT.MODEL; } }
    if (cmd === "impact") {
      let tests = null;
      if (repo) { const t = loadTests(repo, repo.resolve(opt.head ?? "HEAD"), changes); tests = discoverTests(model, t.files, t.changed); }
      const im = buildImpact(model, changes, tests);
      logImpact(im, log);
      if (opt.out) { mkdirSync(dirname(resolve(opt.out)), { recursive: true }); writeFileSync(resolve(opt.out), JSON.stringify(im, null, 2) + "\n"); log("생성: " + resolve(opt.out)); }
      return EXIT.OK;
    }
    if (!opt.intent) throw new Error("--intent <intent.json> 이 필요합니다\n" + USAGE);
    const intent = readJson(opt.intent, "기획 의도");
    const ierr = validateIntent(intent, model);
    if (ierr.length) { ierr.forEach((e) => log("✗ " + e)); return EXIT.MODEL; }
    const rep = checkIntent(model, intent, changes);
    logIntent(rep, log);
    if (opt.out) { mkdirSync(dirname(resolve(opt.out)), { recursive: true }); writeFileSync(resolve(opt.out), JSON.stringify(rep, null, 2) + "\n"); log("생성: " + resolve(opt.out)); }
    return opt["strict-intent"] && rep.summary.unmet ? EXIT.INTENT : EXIT.OK;
  }

  if (cmd === "validate") {
    const model = needModel();
    const changes = opt.changes ? readJson(opt.changes, "변경 오버레이") : null;
    const errors = [...validateModel(model), ...validateChanges(changes, model)];
    if (errors.length) { printErrors(errors, log); return EXIT.MODEL; }
    const steps = model.useCases.reduce((n, u) => n + u.steps.length, 0);
    log(`✓ 유효: 컴포넌트 ${model.components.length}, 연결 ${model.links.length}, 유즈케이스 ${model.useCases.length}, 단계 ${steps}` + (changes ? `, 변경 오버레이 ${changes.components.length}개 컴포넌트` : ""));
    const d = applyDepth(model, opt, { changes, repo: opt.repo && opt.base ? openRepo(opt.repo) : null });
    if (d.code) { log("✗ " + d.error); return d.code; }
    logDepth(d, model, log);
    return EXIT.OK;
  }

  if (cmd === "verify") {
    const model = needModel();
    const errors = validateModel(model);
    if (errors.length) { printErrors(errors, log); return EXIT.MODEL; }
    let result, where, repo = null;
    if (opt.repo) {
      repo = openRepo(opt.repo);
      const sha = repo.resolve(opt.ref ?? model.source.commit);
      result = verifyEvidenceWith(model, (f) => repo.show(sha, f));
      where = `${model.source.repo} @ ${sha.slice(0, 7)}`;
    } else if (opt.source) {
      result = verifyEvidence(model, opt.source);
      where = `${model.source.repo} @ ${model.source.commit.slice(0, 7)}`;
    } else throw new Error("--repo 또는 --source 가 필요합니다");
    if (result.failures.length) { result.failures.forEach((f) => log("✗ " + f)); log(`근거 ${result.checked}건 중 ${result.failures.length}건 실패`); return EXIT.MODEL; }
    log(`✓ 근거 ${result.checked}건 모두 소스와 일치 (${where})`);
    warnNoContains(model, log);
    let changes = null;
    if (opt.changes) { changes = readJson(opt.changes, "변경 오버레이"); const bad = validateChanges(changes, model); if (bad.length) { printErrors(bad, log); return EXIT.MODEL; } }
    const d = applyDepth(model, opt, { changes, repo });
    if (d.code) { log("✗ " + d.error); return d.code; }
    logDepth(d, model, log);
    return EXIT.OK;
  }

  if (cmd === "diff") {
    if (!opt.repo || !opt.base) throw new Error("--repo 와 --base 가 필요합니다\n" + USAGE);
    const repo = openRepo(opt.repo);
    const model = needModel();
    const errors = validateModel(model);
    if (errors.length) { printErrors(errors, log); return EXIT.MODEL; }
    const { overlay, warnings } = overlayFromRepo(repo, model, opt.base, opt.head ?? "HEAD");
    const bad = validateChanges(overlay, model);
    if (bad.length) throw new Error("내부 오류: 생성된 오버레이가 스키마에 맞지 않습니다\n" + bad.join("\n"));
    const outFile = resolve(opt.out ?? join("nacholens-out", "changes.json"));
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(overlay, null, 2) + "\n");
    warnings.forEach((w) => log("⚠ " + w));
    summarize(overlay, log);
    log("생성: " + outFile);
    return opt.strict && codeUnmapped(overlay).length ? EXIT.STRICT : EXIT.OK;
  }

  if (cmd === "build") {
    const out = resolve(opt.out ?? (opt.repo ? "nacholens-out" : "dist"));
    let format = opt.format ?? "auto";
    if (format === "auto") format = formatForAgent(opt.agent ?? env.NACHOLENS_AGENT);
    if (!["html", "artifact", "both"].includes(format)) throw new Error("--format 은 html|artifact|both|auto");
    const lang = opt.lang ?? "en";
    if (!LANGS.includes(lang)) throw new Error(`--lang 은 ${LANGS.join("|")}`);

    let changes = null, repo = null, warnings = [];
    const modelPath = resolve(modelArg);
    if (opt.repo) {
      repo = openRepo(opt.repo);
      if (!existsSync(modelPath)) {
        initTemplate(repo, modelPath, opt.name);
        log(`이 저장소에는 아직 모델이 없어 빈 템플릿을 만들었습니다: ${modelPath}`);
        printErrors(validateModel(readJson(modelPath)), log);
        return EXIT.MODEL;
      }
    }
    const model = needModel();
    const errors = validateModel(model);
    if (errors.length) { printErrors(errors, log); return EXIT.MODEL; }

    if (repo) {
      const sha = repo.tryResolve(model.source.commit);
      if (!sha) { log(`✗ 모델 기준 커밋 ${model.source.commit} 를 저장소에서 찾을 수 없습니다 (git fetch 또는 model.source.commit 확인)`); return EXIT.MODEL; }
      const v = verifyEvidenceWith(model, (f) => repo.show(sha, f));
      if (v.failures.length) { v.failures.forEach((f) => log("✗ " + f)); log(`근거 ${v.checked}건 중 ${v.failures.length}건이 ${sha.slice(0, 7)} 의 소스와 다릅니다. 모델의 근거를 고치세요.`); return EXIT.MODEL; }
      log(`✓ 근거 ${v.checked}건 확인 (${sha.slice(0, 7)})`);
      warnNoContains(model, log);
      if (opt.base && !opt.changes) {
        const r = overlayFromRepo(repo, model, opt.base, opt.head ?? "HEAD");
        changes = r.overlay; warnings = r.warnings;
        const bad = validateChanges(changes, model);
        if (bad.length) throw new Error("내부 오류: 생성된 오버레이가 스키마에 맞지 않습니다\n" + bad.join("\n"));
        warnings.forEach((w) => log("⚠ " + w));
        summarize(changes, log);
      } else if (!opt.base && !opt.changes) log("--base 가 없어 변경 강조 없이 모델만 그립니다.");
    }
    if (opt.changes) {
      changes = readJson(opt.changes, "변경 오버레이");
      const bad = validateChanges(changes, model);
      if (bad.length) { printErrors(bad, log); return EXIT.MODEL; }
    }

    const d = applyDepth(model, opt, { changes });
    if (d.code) { log("✗ " + d.error); return d.code; }
    logDepth(d, model, log);
    // the page and the artifact show the depth that was checked, also when it came from --depth
    const shown = d.depth ? { ...model, depth: d.depth } : model;

    const mr = makeReview(model, changes, opt, repo, log);
    if (mr.code) return mr.code;
    const review = mr.review;
    if (review?.intent) logIntent(review.intent, log);
    if (review?.impact) logImpact(review.impact, log);

    mkdirSync(out, { recursive: true });
    const id = model.product.id, written = [];
    if (format === "html" || format === "both") {
      const f = join(out, `${id}.html`);
      writeFileSync(f, buildPage(shown, changes, { target: "html", review, lang })); written.push(f);
    }
    if (format === "artifact" || format === "both") {
      const f = join(out, `${id}.artifact.html`), m = join(out, `${id}.artifact.json`);
      writeFileSync(f, buildPage(shown, changes, { target: "artifact", review, lang }));
      writeFileSync(m, JSON.stringify(artifactManifest(model, `${id}.artifact.html`), null, 2) + "\n");
      written.push(f, m);
    }
    if (repo) {
      if (review) { const rv = join(out, "review.json"); writeFileSync(rv, JSON.stringify(review, null, 2) + "\n"); written.push(rv); }
      if (changes) { const c = join(out, "changes.json"); writeFileSync(c, JSON.stringify(changes, null, 2) + "\n"); written.push(c); }
      const r = join(out, "report.json");
      writeFileSync(r, JSON.stringify({
        ok: true, product: id, modelPath, modelCommit: model.source.commit, format,
        base: changes?.generated?.base ?? null, head: changes?.generated?.head ?? null,
        changedSteps: (changes?.steps ?? []).map((s) => `${s.useCase}/${s.step}`),
        changedComponents: (changes?.components ?? []).map((c) => c.id),
        depth: d.depth, depthWarnings: d.warnings,
        unmapped: changes?.unmapped ?? [], ignoredCount: (changes?.ignored ?? []).length, warnings,
        review: review ? { compare: review.compare?.summary ?? null, intent: review.intent?.summary ?? null, impact: review.impact?.summary ?? null } : null,
        outputs: written.map((w) => w.slice(out.length + 1)).concat("report.json"),
      }, null, 2) + "\n");
      written.push(r);
    }
    written.forEach((w) => log("생성: " + w));
    if (opt.strict && changes && codeUnmapped(changes).length) return EXIT.STRICT;
    return opt["strict-intent"] && review?.intent?.summary.unmet ? EXIT.INTENT : EXIT.OK;
  }
  throw new Error(`알 수 없는 명령: ${cmd}\n` + USAGE);
}

// npm starts bin entries through a symlink: compare real paths, or the CLI would silently do nothing
const isMain = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (e) { console.error("오류: " + e.message); process.exitCode = EXIT.USAGE; }
}
