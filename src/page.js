// One model -> two output shapes. Both embed the same player; only the `target` differs:
//   html     : single-file HTML (deep-links via URL hash)
//   artifact : Claude-artifact-ready HTML (no history/URL side effects, sandbox-safe) + manifest
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateModel, validateChanges } from "./model.js";

const here = dirname(fileURLToPath(import.meta.url));
const asset = (n) => readFileSync(join(here, "player", n), "utf8");

// Embedded fonts (SIL OFL 1.1, see player/fonts/FONTLOG.md): one @font-face per file, WOFF2 as data.
const FONT_FILES = [
  ["Nacho Sans", 400, "nacho-sans-400"], ["Nacho Sans", 500, "nacho-sans-500"], ["Nacho Sans", 600, "nacho-sans-600"],
  ["Nacho Sans", 700, "nacho-sans-700"], ["Nacho Mono", 500, "nacho-mono-500"], ["Nacho Mono", 600, "nacho-mono-600"],
  ["Anton", 400, "anton-400"],
];
let fontCss = null;
export function fontFaces() {
  if (fontCss) return fontCss;
  const head = "/* Nacho Sans and Nacho Mono: IBM Plex Sans / Mono, Copyright 2017 IBM Corp., subset and renamed (Reserved Font Name \"Plex\").\n" +
    "   Anton: Copyright 2020 The Anton Project Authors. Both: SIL Open Font License 1.1, https://openfontlicense.org */\n";
  fontCss = head + FONT_FILES.map(([family, weight, file]) =>
    `@font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight}; font-display: swap; ` +
    `src: url(data:font/woff2;base64,${readFileSync(join(here, "player", "fonts", file + ".woff2")).toString("base64")}) format("woff2"); }`).join("\n");
  return fontCss;
}

// JSON embedded in <script type="application/json">: neutralise anything that could close
// the script element or start an HTML comment.
export function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const TARGETS = ["html", "artifact"];
/** Page languages for the player's own words (model text is shown as written). English is the default. */
export const LANGS = ["en", "ko"];
const UI = {
  en: { UOVERLAY: "Highlight changes", UNAV: "Flows and steps", USEARCH: "Search flows", USTAGE: "Data flow animation", UCANVAS: "Architecture and request flow", UTRANSPORT: "Playback", UREVIEW: "Review", UINSP: "About the current step" },
  ko: { UOVERLAY: "변경 강조", UNAV: "흐름과 단계", USEARCH: "흐름 검색", USTAGE: "데이터 흐름 애니메이션", UCANVAS: "아키텍처와 요청 흐름", UTRANSPORT: "재생 제어", UREVIEW: "검토", UINSP: "현재 단계 설명" },
};

export function buildPage(model, changes = null, { target = "html", review = null, lang = "en" } = {}) {
  if (!TARGETS.includes(target)) throw new Error(`unknown target: ${target}`);
  if (!LANGS.includes(lang)) throw new Error(`unknown lang: ${lang} (${LANGS.join("|")})`);
  const errors = [...validateModel(model), ...validateChanges(changes, model)];
  if (errors.length) throw new Error("model validation failed:\n" + errors.map((e) => " - " + e).join("\n"));
  const values = {
    TARGET: target,
    LANG: lang,
    ...UI[lang],
    TITLE: esc(`${model.product.name} · Nacholens`),
    FONTS: fontFaces(),
    CSS: asset("player.css"),
    JS: asset("player.js"),
    MODEL: safeJson(model),
    CHANGES: safeJson(changes ?? null),
    REVIEWCSS: asset("review.css"),
    REVIEWJS: asset("review.js"),
    REVIEW: safeJson(review ?? null),
  };
  // function replacer: model text may contain `$&` etc. and must be inserted literally
  return asset("template.html").replace(/\{\{([A-Z]+)\}\}/g, (_, k) => values[k]);
}

export function artifactManifest(model, file) {
  return {
    identifier: `nacholens-${model.product.id}`,
    title: `${model.product.name} · Nacholens`,
    type: "text/html",
    file,
    note: "Paste or upload as a Claude artifact (HTML) as is. No external resources.",
  };
}

/** Which output an executing agent should produce. Claude -> artifact, anything else -> single-file HTML. */
export function formatForAgent(agent) {
  return String(agent ?? "").trim().toLowerCase().startsWith("claude") ? "artifact" : "html";
}
