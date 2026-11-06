// PR comment: the build output (model + changes + review + report) as one GitHub-flavoured markdown comment,
// so a reviewer understands the change from the pull request page alone.
//
// Rules: the text alone carries everything (images only speed it up); one numbering everywhere (the step number
// of the player = the number in the diagrams, the GIF overlay and the text); nothing is claimed that the model
// and the review data do not say ("unknown" stays unknown); no network, a pure function of its inputs.
import { createHash } from "node:crypto";

export const PR_MARK = "<!-- nacholens:pr -->";
const MAX_CHARS = 60000; // GitHub comments stop at 65536 characters

const STR = {
  en: {
    title: "nacholens · what this PR changes in the flows",
    flow: "Flow",
    counts: (f, s, a, m, r) => `**${f}** ${f === 1 ? "flow" : "flows"} · **${s}** ${s === 1 ? "step" : "steps"} changed (new ${a} · changed ${m} · removed ${r})`,
    recheckCount: (n) => `**${n}** to re-test`,
    unmappedCount: (n) => `**${n}** changed ${n === 1 ? "file" : "files"} outside the flows`,
    noChange: "No step of the model is touched by this change.",
    player: "Open the interactive player",
    playerClaude: "Open the interactive player (Claude artifact)",
    playerNote: "pick a flow, press Play, click a box to look inside",
    map: "At a glance",
    mapAlt: (t) => `Architecture of ${t}: changed parts are highlighted`,
    mapText: "Diagram (text)",
    legend: "Yellow = changed in this PR · green = new in this PR",
    flowAlt: (t) => `Animation of the flow "${t}": the request moves step by step, changed steps are highlighted`,
    seq: "Sequence diagram",
    steps: "Steps",
    stepsHint: "changed steps in bold; same numbers as in the player and the animation",
    change: { added: "new", modified: "changed", removed: "removed", moved: "moved" },
    what: "What happens",
    route: "Route",
    sends: "Sends",
    gets: "Gets back",
    code: "Code",
    before: "Before",
    beforeUnknown: "The code of this step changed; the model has no earlier version, so the old wording is not shown.",
    movedNote: "Only its place in the flow changed.",
    removedFlow: "Steps that are gone",
    intent: "Does it do what was planned?",
    intentFrom: (t, s) => `Plan: **${t}**${s ? ` (${s})` : ""}`,
    intentCounts: (m, u, k) => `met ${m} · not met ${u} · unknown ${k}`,
    status: { met: "met", unmet: "not met", unknown: "unknown — a person has to check" },
    proof: "proved by",
    touched: "touched by this PR",
    uncovered: "Changed steps no expectation mentions (possible scope drift, a person decides)",
    recheck: "What to re-test",
    recheckHint: "tick them here as you test",
    direct: "direct",
    indirect: "indirect",
    tests: { "covered-changed": "test changed in this PR", covered: "a test mentions it", "none-found": "no test found", unknown: "tests not read" },
    testsNote: "\"no test found\" means no test file mentions the route; it is not proof that nothing tests it.",
    why: "why",
    stepsChanged: "changed steps",
    outside: "Changes the flows do not show",
    outsideHint: "files changed in this PR that no flow step cites: new paths, or code the model does not cover",
    cat: { code: "code", style: "style", config: "config" },
    ignored: (n) => `${n} more ${n === 1 ? "file" : "files"} ignored (tests, docs, lock files)`,
    trust: "Can I trust this?",
    range: "Compared",
    model: "Model read at",
    evidence: "Every step cites real code (`file:lines`); the evidence was checked against the source before this was built.",
    depth: { diff: "Depth 1 · Changes only", brief: "Depth 2 · Overview", full: "Depth 3 · Detailed" },
    depthLine: "Depth",
    stale: (h) => `Made for commit \`${h}\`. If the PR has newer commits, this comment is out of date until it is rebuilt.`,
    made: (v) => `Made with [nacholens](https://github.com/mafianacho/nacholens)${v ? ` ${v}` : ""}. Nothing is guessed: what the model cannot show is listed as unknown.`,
    cut: (n) => `${n} more ${n === 1 ? "flow is" : "flows are"} only listed by name to keep this comment under GitHub's size limit; the player shows them.`,
    forward: "passes on",
  },
  ko: {
    title: "nacholens · 이 PR이 바꾼 흐름",
    flow: "흐름",
    counts: (f, s, a, m, r) => `흐름 **${f}**개 · 단계 **${s}**개 바뀜 (새로 ${a} · 바뀜 ${m} · 없어짐 ${r})`,
    recheckCount: (n) => `다시 테스트할 흐름 **${n}**개`,
    unmappedCount: (n) => `흐름에 안 잡힌 변경 파일 **${n}**개`,
    noChange: "이 변경이 닿는 모델 단계가 없습니다.",
    player: "인터랙티브 플레이어 열기",
    playerClaude: "인터랙티브 플레이어 열기 (Claude 아티팩트)",
    playerNote: "흐름을 고르고 재생, 상자를 누르면 안쪽을 봅니다",
    map: "한눈에 보기",
    mapAlt: (t) => `${t} 구조도: 바뀐 부분이 강조되어 있습니다`,
    mapText: "구조도 (텍스트)",
    legend: "노란색 = 이 PR에서 바뀜 · 초록색 = 이 PR에서 새로 생김",
    flowAlt: (t) => `"${t}" 흐름 애니메이션: 요청이 단계별로 이동하고 바뀐 단계가 강조됩니다`,
    seq: "시퀀스 다이어그램",
    steps: "단계",
    stepsHint: "바뀐 단계는 굵게, 번호는 플레이어·애니메이션과 같습니다",
    change: { added: "새로 생김", modified: "바뀜", removed: "없어짐", moved: "자리 이동" },
    what: "무슨 일",
    route: "경로",
    sends: "보냄",
    gets: "받음",
    code: "코드",
    before: "이전",
    beforeUnknown: "이 단계의 코드가 바뀌었습니다. 모델에 이전 버전이 없어 예전 설명은 보여 주지 않습니다.",
    movedNote: "흐름 안에서 자리만 바뀌었습니다.",
    removedFlow: "없어진 단계",
    intent: "기획대로 됐나요?",
    intentFrom: (t, s) => `기획: **${t}**${s ? ` (${s})` : ""}`,
    intentCounts: (m, u, k) => `충족 ${m} · 미충족 ${u} · 확인 안 됨 ${k}`,
    status: { met: "충족", unmet: "미충족", unknown: "확인 안 됨 — 사람이 확인해야 합니다" },
    proof: "근거 단계",
    touched: "이 PR에서 바뀐 단계",
    uncovered: "어떤 기대사항도 가리키지 않는 바뀐 단계 (범위 밖 변경일 수 있음, 사람이 판단)",
    recheck: "다시 테스트할 것",
    recheckHint: "테스트하면서 여기서 체크하세요",
    direct: "직접",
    indirect: "간접",
    tests: { "covered-changed": "이 PR에서 테스트도 바뀜", covered: "테스트가 언급함", "none-found": "테스트 못 찾음", unknown: "테스트 안 읽음" },
    testsNote: "\"테스트 못 찾음\"은 경로를 언급하는 테스트 파일이 없다는 뜻이지, 테스트가 없다는 증명은 아닙니다.",
    why: "이유",
    stepsChanged: "바뀐 단계",
    outside: "흐름에 안 잡힌 변경",
    outsideHint: "이 PR에서 바뀌었지만 어떤 흐름 단계도 근거로 삼지 않는 파일: 새 경로이거나 모델이 다루지 않는 코드",
    cat: { code: "코드", style: "스타일", config: "설정" },
    ignored: (n) => `그 밖에 ${n}개 파일은 제외 (테스트·문서·lock 파일)`,
    trust: "이 설명을 믿어도 되나요?",
    range: "비교 구간",
    model: "모델을 읽은 커밋",
    evidence: "모든 단계는 실제 코드(`파일:줄`)를 근거로 하며, 만들기 전에 근거를 소스와 대조했습니다.",
    depth: { diff: "깊이 1 · 변경만", brief: "깊이 2 · 한눈에", full: "깊이 3 · 자세히" },
    depthLine: "깊이",
    stale: (h) => `커밋 \`${h}\` 기준입니다. PR에 더 새 커밋이 있으면 다시 만들기 전까지 이 코멘트는 낡은 정보입니다.`,
    made: (v) => `[nacholens](https://github.com/mafianacho/nacholens)${v ? ` ${v}` : ""}로 만들었습니다. 추측은 없습니다: 모델이 보여 줄 수 없는 것은 "확인 안 됨"으로 적습니다.`,
    cut: (n) => `GitHub 코멘트 크기 제한 때문에 흐름 ${n}개는 이름만 적었습니다. 플레이어에서 볼 수 있습니다.`,
    forward: "전달",
  },
};

const NUMS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
export const stepNo = (i) => (i < NUMS.length ? NUMS[i] : `(${i + 1})`);
const DOT = { added: "🟢", modified: "🟠", removed: "🔴", moved: "🔵" };
const short = (s) => (s ? String(s).slice(0, 7) : "?");
const firstLine = (s) => String(s ?? "").split("\n")[0].trim();
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// inline code that survives backticks and pipes inside the value
const code = (s) => { const v = oneLine(s); const fence = v.includes("`") ? "``" : "`"; return `${fence}${fence === "``" ? " " : ""}${v}${fence === "``" ? " " : ""}${fence}`; };
// plain text from the model: no raw HTML, no accidental markdown links/emphasis at the start of a line
const md = (s) => oneLine(s).replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;")).replace(/([\\`*_[\]|])/g, "\\$1");
const attr = (s) => oneLine(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// mermaid label text: entity codes for the characters that end or break a statement
export const mer = (s, max = 60) => {
  let v = oneLine(s);
  if (v.length > max) v = v.slice(0, max - 1) + "…";
  return v.replace(/#/g, "#35;").replace(/;/g, "#59;").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;").replace(/:/g, "#58;").replace(/\{/g, "#123;").replace(/\}/g, "#125;");
};

/** GitHub's anchor for a file in the "Files changed" tab: `diff-` + sha256 of the path. */
export const diffAnchor = (file) => "diff-" + createHash("sha256").update(file).digest("hex");

/** Link maker for evidence ranges. PR diff anchors only when the model lines are head lines. */
export function codeLinker({ repoUrl = null, pr = null, head = null, modelCommit = null } = {}) {
  const base = repoUrl ? String(repoUrl).replace(/\/+$/, "") : null;
  const sameAsHead = head && modelCommit && (head.startsWith(modelCommit) || modelCommit.startsWith(head));
  return (e) => {
    const [a, b] = e.lines, text = `${e.file}:${a}${b !== a ? "-" + b : ""}`;
    if (!base) return code(text);
    if (pr && sameAsHead) return `[${code(text)}](${base}/pull/${pr}/files#${diffAnchor(e.file)}R${a}${b !== a ? `-R${b}` : ""})`;
    if (modelCommit) return `[${code(text)}](${base}/blob/${modelCommit}/${e.file.split("/").map(encodeURIComponent).join("/")}#L${a}${b !== a ? `-L${b}` : ""})`;
    return code(text);
  };
}

const pathOf = (st) => [st.from, ...(st.via ?? []), st.to];

/** Mermaid flowchart of the architecture with the changed components classed. */
export function mermaidMap(model, changes) {
  const id = new Map(model.components.map((c, i) => [c.id, `c${i}`]));
  const chg = new Map((changes?.components ?? []).map((c) => [c.id, c.change]));
  const shape = { client: ["([", "])"], gateway: ["{{", "}}"], service: ["[", "]"], datastore: ["[(", ")]"], external: ["[/", "/]"] };
  const out = ["```mermaid", "flowchart LR"];
  for (const c of model.components) {
    const [o, cl] = shape[c.kind] ?? ["[", "]"];
    out.push(`  ${id.get(c.id)}${o}"${mer(firstLine(c.label), 40)}"${cl}`);
  }
  for (const l of model.links) if (id.has(l.a) && id.has(l.b)) out.push(`  ${id.get(l.a)} --- ${id.get(l.b)}`);
  out.push("  classDef chg fill:#ffd166,stroke:#b8860b,color:#1f1a10", "  classDef add fill:#b7e4c7,stroke:#2d6a4f,color:#10251a");
  const changed = [...chg].filter(([, v]) => v !== "added").map(([k]) => id.get(k)).filter(Boolean);
  const added = [...chg].filter(([, v]) => v === "added").map(([k]) => id.get(k)).filter(Boolean);
  if (changed.length) out.push(`  class ${changed.join(",")} chg`);
  if (added.length) out.push(`  class ${added.join(",")} add`);
  out.push("```");
  return out.join("\n");
}

/** Mermaid sequence diagram of one use case; changed steps sit in a coloured box. */
export function mermaidSequence(model, uc, changeOf, S = STR.en) {
  const comp = new Map(model.components.map((c) => [c.id, c]));
  const used = [];
  for (const st of uc.steps) for (const c of pathOf(st)) if (!used.includes(c)) used.push(c);
  const pid = new Map(used.map((c, i) => [c, `p${i}`]));
  const out = ["```mermaid", "sequenceDiagram"];
  for (const c of used) out.push(`  participant ${pid.get(c)} as ${mer(firstLine(comp.get(c)?.label ?? c), 40)}`);
  uc.steps.forEach((st, i) => {
    const ch = changeOf(uc.id, st.id), lines = [], label = `${stepNo(i)} ${mer(st.label)}`;
    const hops = (ids, arrow, text) => {
      for (let k = 0; k < ids.length - 1; k++) lines.push(`  ${pid.get(ids[k])}${arrow}${pid.get(ids[k + 1])}: ${k === 0 ? text : mer(S.forward)}`);
    };
    if (st.kind === "internal") lines.push(`  Note over ${pid.get(st.from)}: ${label}`);
    else if (st.kind === "call") {
      hops(pathOf(st), "->>", label);
      hops([...pathOf(st)].reverse(), "-->>", st.response ? mer(st.response, 48) : "…");
    } else hops(pathOf(st), st.kind === "response" ? "-->>" : "->>", label);
    if (ch) out.push(`  rect ${ch === "added" ? "rgba(46, 160, 67, 0.22)" : "rgba(255, 190, 0, 0.28)"}`, ...lines.map((l) => "  " + l), "  end");
    else out.push(...lines);
  });
  out.push("```");
  return out.join("\n");
}

function details(summary, body, open = false) {
  return [`<details${open ? " open" : ""}>`, `<summary>${summary}</summary>`, "", body, "", "</details>"].join("\n");
}

/**
 * @param {object} p
 * @param {object} p.model     the model the page was built from
 * @param {object} [p.changes] changes.json
 * @param {object} [p.review]  review.json
 * @param {object} [p.report]  report.json
 * @param {object} [p.media]   media manifest from `snap` ({ files: [{ kind: "map"|"flow", useCase?, file, width, height }] })
 * @param {object} [p.opt]     { lang, repoUrl, pr, playerUrl, mediaUrl, version }
 */
export function buildPrComment({ model, changes = null, review = null, report = null, media = null, opt = {} }) {
  const S = STR[opt.lang] ?? STR.en;
  const head = report?.head ?? changes?.generated?.head ?? null, base = report?.base ?? changes?.generated?.base ?? null;
  const modelCommit = report?.modelCommit ?? model.source?.commit ?? null;
  const link = codeLinker({ repoUrl: opt.repoUrl, pr: opt.pr, head, modelCommit });
  const stepChange = new Map((changes?.steps ?? []).map((s) => [`${s.useCase}/${s.step}`, s]));
  const changeOf = (u, s) => stepChange.get(`${u}/${s}`)?.change ?? null;
  const compareOf = new Map((review?.compare?.useCases ?? []).map((u) => [u.id, u]));
  const comp = new Map(model.components.map((c) => [c.id, c]));
  const name = (id) => firstLine(comp.get(id)?.label ?? id);
  const mediaUrl = opt.mediaUrl ? String(opt.mediaUrl).replace(/\/+$/, "") : null;
  const files = mediaUrl ? (media?.files ?? []) : [];
  const img = (f, alt) => `<img src="${attr(`${mediaUrl}/${f.file}`)}" alt="${attr(alt)}" width="${Math.min(f.width ?? 800, 800)}">`;
  // light picture, with the dark one as a <picture> source when snap made both
  const pic = (kind, useCase, alt) => {
    const of = (dark) => files.find((f) => f.kind === kind && (useCase == null || f.useCase === useCase) && (f.theme === "dark") === dark);
    const light = of(false), dark = of(true);
    if (!light && !dark) return null;
    const i = img(light ?? dark, alt);
    return light && dark ? ["<picture>", `<source media="(prefers-color-scheme: dark)" srcset="${attr(`${mediaUrl}/${dark.file}`)}">`, i, "</picture>"].join("\n") : i;
  };

  const changedUcs = model.useCases.filter((u) => u.steps.some((s) => changeOf(u.id, s.id)) || (compareOf.get(u.id)?.rows ?? []).some((r) => r.status === "removed"));
  const removedRows = (u) => (compareOf.get(u.id)?.rows ?? []).filter((r) => r.status === "removed");
  const all = changes?.steps ?? [];
  // steps that exist only in the before-model are not in changes.steps
  const goneExtra = changedUcs.reduce((n, u) => n + removedRows(u).filter((r) => !stepChange.has(`${u.id}/${r.id}`)).length, 0);
  const cnt = (k) => all.filter((s) => s.change === k).length + (k === "removed" ? goneExtra : 0);
  const impact = review?.impact ?? null, intent = review?.intent ?? null;
  const unmapped = changes?.unmapped ?? [];

  const out = [PR_MARK, `## 🔎 ${S.title}`, ""];
  if (changes?.title) out.push(`> **${md(changes.title)}**`, ">");
  const facts = [];
  if (changedUcs.length) facts.push(S.counts(changedUcs.length, all.length + goneExtra, cnt("added"), cnt("modified") + cnt("moved"), cnt("removed")));
  else facts.push(S.noChange);
  if (impact?.useCases?.length) facts.push(S.recheckCount(impact.useCases.length));
  if (unmapped.length) facts.push(S.unmappedCount(unmapped.length));
  out.push(`> ${facts.join(" · ")}`, "");
  if (opt.playerUrl) {
    const claude = /^https:\/\/claude\.ai\//.test(opt.playerUrl);
    out.push(`**[▶ ${claude ? S.playerClaude : S.player}](${opt.playerUrl})** — ${S.playerNote}`, "");
  }

  // ── at a glance
  out.push(`### ${S.map}`, "");
  const mapPic = pic("map", null, S.mapAlt(model.product.name));
  if (mapPic) out.push(mapPic, "", details(S.mapText, `${mermaidMap(model, changes)}\n\n${S.legend}`));
  else out.push(mermaidMap(model, changes), "", `<sub>${S.legend}</sub>`);
  out.push("");

  // ── flows
  let budgetCut = 0;
  const flowParts = changedUcs.map((u, n) => {
    const p = [`### ${S.flow} ${n + 1} · ${md(u.title)} — ${code(u.trigger)}`, "", md(u.summary), ""];
    const gif = pic("flow", u.id, S.flowAlt(u.title));
    const seq = mermaidSequence(model, u, changeOf, S);
    if (gif) p.push(gif, "", details(S.seq, seq));
    else p.push(seq);
    p.push("", `**${S.steps}** <sub>${S.stepsHint}</sub>`, "");
    const rows = new Map((compareOf.get(u.id)?.rows ?? []).map((r) => [r.id, r]));
    u.steps.forEach((st, i) => {
      const ch = changeOf(u.id, st.id);
      if (!ch) { p.push(`- ${stepNo(i)} ${md(st.label)}`); return; }
      p.push(`- ${stepNo(i)} **${md(st.label)}** ${DOT[ch] ?? ""} ${S.change[ch] ?? ch}`);
      const sub = [];
      if (st.narration) sub.push(`- ${S.what}: ${md(st.narration)}`);
      sub.push(`- ${S.route}: ${pathOf(st).filter((c, k, a) => k === 0 || c !== a[k - 1]).map((c) => md(name(c))).join(" → ")}`);
      if (st.request) sub.push(`- ${S.sends}: ${code(st.request)}`);
      if (st.response) sub.push(`- ${S.gets}: ${code(st.response)}`);
      const row = rows.get(st.id);
      if (ch === "modified" && row) {
        if (row.codeOnly || review?.compare?.mode !== "models") sub.push(`- ${S.before}: ${S.beforeUnknown}`);
        else if (row.before) {
          const diffs = ["label", "kind", "route", "request", "response"].filter((k) => (row.before[k] ?? "") !== (row.after?.[k] ?? ""));
          if (diffs.length) sub.push(`- ${S.before}: ${diffs.map((k) => `${k} ${code(row.before[k] ?? "—")}`).join(" · ")}`);
        }
      }
      if (ch === "moved") sub.push(`- ${S.movedNote}`);
      if (st.evidence?.length) sub.push(`- ${S.code}: ${st.evidence.map(link).join(", ")}`);
      p.push(...sub.map((l) => "  " + l));
    });
    const gone = removedRows(u);
    if (gone.length) {
      p.push("", `**${S.removedFlow}**`, "");
      for (const r of gone) p.push(`- ${DOT.removed} ${md(r.before?.label ?? r.id)}${r.before?.route ? ` (${md(r.before.route)})` : ""}`);
    }
    return p.join("\n");
  });
  let used = out.join("\n").length;
  for (const [n, part] of flowParts.entries()) {
    if (used + part.length > MAX_CHARS * 0.7 && n > 0) {
      budgetCut = flowParts.length - n;
      out.push(...changedUcs.slice(n).map((u, k) => `### ${S.flow} ${n + k + 1} · ${md(u.title)} — ${code(u.trigger)}`), "", `<sub>${S.cut(budgetCut)}</sub>`, "");
      break;
    }
    out.push(part, ""); used += part.length;
  }

  // ── intent
  if (intent) {
    const icon = { met: "✅", unmet: "❌", unknown: "❓" };
    const ucTitle = (id) => model.useCases.find((x) => x.id === id)?.title ?? id;
    out.push(`### ${S.intent}`, "", S.intentFrom(md(intent.title), intent.source ? md(intent.source) : ""), `${S.intentCounts(intent.summary.met, intent.summary.unmet, intent.summary.unknown)}`, "");
    for (const r of intent.results) {
      const proofs = (r.proof ?? []).map((p) => {
        const u = model.useCases.find((x) => x.id === p.useCase), i = u ? u.steps.findIndex((s) => s.id === p.step) : -1;
        return `${i >= 0 ? stepNo(i) + " " : ""}${md(p.label)}${p.change ? ` (${S.touched})` : ""}`;
      });
      out.push(`- ${icon[r.status] ?? "❓"} **${md(r.text)}** — ${S.status[r.status] ?? r.status}${r.useCase ? ` · ${md(ucTitle(r.useCase))}` : ""}`);
      if (proofs.length) out.push(`  - ${S.proof}: ${proofs.join(", ")}`);
      if (r.status === "unmet" && r.reason) out.push(`  - ${md(r.reason)}`);
    }
    if (intent.uncovered?.length) {
      out.push("", `**${S.uncovered}**`, "");
      for (const s of intent.uncovered) out.push(`- ${DOT[s.change] ?? ""} ${md(s.useCaseTitle)} · ${md(s.label)}`);
    }
    out.push("");
  }

  // ── what to re-test
  if (impact?.useCases?.length) {
    out.push(`### ${S.recheck}`, "", `<sub>${S.recheckHint}</sub>`, "");
    for (const u of impact.useCases) {
      const t = u.tests?.state ?? "unknown";
      out.push(`- [ ] **${md(u.title)}** ${code(u.trigger)} — ${u.relation === "direct" ? S.direct : S.indirect} · ${S.tests[t] ?? t}`);
      const uc = model.useCases.find((x) => x.id === u.useCase || x.id === u.id);
      const no = (sid) => { const i = uc ? uc.steps.findIndex((s) => s.id === sid) : -1; return i >= 0 ? stepNo(i) : ""; };
      if (u.direct?.length) out.push(`  - ${S.stepsChanged}: ${u.direct.map((d) => `${no(d.step)} ${md(d.label)}`).join(", ")}`);
      for (const r of u.reasons ?? []) out.push(`  - ${S.why}: ${md(r.text)}`);
      if (u.tests?.files?.length) out.push(`  - ${u.tests.files.map((f) => code(f.file ?? f)).join(", ")}`);
    }
    if (impact.useCases.some((u) => u.tests?.state === "none-found")) out.push("", `<sub>${S.testsNote}</sub>`);
    out.push("");
  }

  // ── outside the flows
  if (unmapped.length || changes?.ignored?.length) {
    out.push(`### ${S.outside}`, "", `<sub>${S.outsideHint}</sub>`, "");
    for (const f of unmapped) out.push(`- ${code(f.file)} — ${S.cat[f.category] ?? f.category} · ${S.change[f.status] ?? f.status} · ${md(f.lines)}`);
    if (changes?.ignored?.length) out.push(`- <sub>${S.ignored(changes.ignored.length)}</sub>`);
    out.push("");
  }

  // ── trust
  const t = [];
  if (base || head) t.push(`- ${S.range}: ${code(`${short(base)}..${short(head)}`)}`);
  if (modelCommit) t.push(`- ${S.model}: ${code(short(modelCommit))}`);
  const depth = report?.depth ?? model.depth;
  if (depth) t.push(`- ${S.depth[depth] ?? `${S.depthLine} ${depth}`}`);
  t.push(`- ${S.evidence}`);
  if (head) t.push(`- ${S.stale(short(head))}`);
  out.push(details(`<b>${S.trust}</b>`, t.join("\n")), "", `<sub>${S.made(opt.version)}</sub>`);
  if (head) out.push(`<!-- nacholens:head=${head} -->`);
  let text = out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - 200) + `\n\n…\n${PR_MARK}\n`;
  return text;
}
