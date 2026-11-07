// `nacholens snap`: pictures of a built page for a pull request, taken with a local headless Chrome over the
// DevTools protocol (Node >= 22 for the global WebSocket; no npm packages). It drives the page's own
// `window.__nacholens` API, so the pictures are exactly what the player shows:
//   map.png (+ map.dark.png)          the stage of the first changed flow, at its first changed step
//   <use case>.gif (+ .dark.gif)      each changed flow played step by step, changed steps held longer
//   manifest.json                     what was written, for `nacholens pr`
// Nothing leaves the machine: the page is opened from disk, Chrome runs with a throwaway profile.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decodePng } from "./png.js";
import { encodeGif } from "./gif.js";

const NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];

/** Finds a Chrome/Chromium binary: explicit path, $CHROME, PATH, macOS app, Playwright's download cache. */
export function findChrome(explicit, env = process.env) {
  const cands = [];
  if (explicit) return existsSync(explicit) ? explicit : null;
  if (env.CHROME) cands.push(env.CHROME);
  for (const dir of (env.PATH ?? "").split(delimiter)) if (dir) for (const n of NAMES) cands.push(join(dir, n));
  cands.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium");
  const pw = join(env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), ".cache", "ms-playwright"));
  try {
    for (const d of readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])))
      for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) cands.push(join(pw, d, sub));
  } catch { /* no playwright cache */ }
  return cands.find((c) => existsSync(c)) ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

async function openChrome(chrome) {
  // a long TMPDIR makes Chrome fail with "socket path too long": keep the profile short
  const root = existsSync("/tmp") ? "/tmp" : tmpdir();
  const profile = mkdtempSync(join(root, "nls-"));
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--allow-file-access-from-files", "--hide-scrollbars", "--font-render-hinting=none", "--no-sandbox", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: root } });
  const close = async () => { proc.kill(); await sleep(400); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* temp profile */ } };
  try {
    const targets = await until(async () => (await fetch(`http://127.0.0.1:${port}/json`)).json(), 20000, "Chrome to start");
    const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cannot connect to Chrome")); });
    let id = 0; const wait = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
    const send = (method, params = {}) => new Promise((res, rej) => {
      wait.set(++id, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    return { send, evaluate, close: async () => { try { ws.close(); } catch { /* closed */ } await close(); } };
  } catch (e) { await close(); throw e; }
}

// a small label in the stage corner: the step number and words of the PR comment, so picture and text match
const TAG_JS = `(function (t) {
  var st = document.getElementById("sv-stage"), el = document.getElementById("nl-snap-tag");
  if (!el) { el = document.createElement("div"); el.id = "nl-snap-tag"; st.appendChild(el);
    el.style.cssText = "position:absolute;left:12px;bottom:10px;z-index:50;padding:5px 10px;border-radius:8px;font:600 13px/1.3 system-ui,sans-serif;" +
      "background:var(--paper2);color:var(--ink);border:1px solid var(--line);max-width:70%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none"; }
  if (!t) { el.style.display = "none"; return; }
  el.style.display = "block"; el.textContent = t.text;
  el.style.background = t.change === "added" ? "var(--guac)" : t.change ? "var(--nacho)" : "var(--paper2)";
  el.style.color = t.change === "added" ? "#fff" : t.change ? "var(--on-nacho)" : "var(--ink)";
})`;

const STR = {
  en: { change: { added: "new", modified: "changed", removed: "removed", moved: "moved" } },
  ko: { change: { added: "새로 생김", modified: "바뀜", removed: "없어짐", moved: "자리 이동" } },
};
const NUMS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const stepNo = (i) => (i < NUMS.length ? NUMS[i] : `(${i + 1})`);

/**
 * @param {object} o
 * @param {string} o.page   built page (.html)
 * @param {string} o.out    output folder
 * @param {string} [o.chrome] Chrome binary
 * @param {number} [o.flows=3] at most this many changed flows get a GIF
 * @param {number} [o.fps=10]
 * @param {string[]} [o.themes=["light","dark"]]
 * @param {string} [o.lang="en"] words of the corner label
 */
export async function snap({ page, out, chrome, flows = 3, fps = 10, width = 1352, height = 860, themes = ["light", "dark"], lang = "en", log = () => {} }) {
  if (typeof WebSocket !== "function") throw new Error("snap 은 Node 22 이상이 필요합니다 (전역 WebSocket)");
  const bin = findChrome(chrome);
  if (!bin) throw new Error("Chrome/Chromium 을 찾지 못했습니다: --chrome <경로> 또는 CHROME 환경 변수를 지정하세요");
  const S = STR[lang] ?? STR.en;
  mkdirSync(out, { recursive: true });
  const c = await openChrome(bin);
  const files = [];
  let info = null;
  try {
    await c.send("Page.enable");
    const setView = (scale, theme) => Promise.all([
      c.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false }),
      c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "no-preference" }] }),
    ]);
    await setView(1, "light");
    await c.send("Page.navigate", { url: pathToFileURL(resolve(page)).href });
    await until(() => c.evaluate("!!(window.__nacholens && document.getElementById('sv-stage'))"), 20000, "the nacholens page");
    await c.evaluate("document.fonts ? document.fonts.ready.then(function () { return 1; }) : 1");
    // a still cannot be clicked: hide the per-box copy buttons. The caption fades out while its text swaps (110 ms):
    // keep it visible, and wait for the swap only when the text can change (a new step or leg)
    await c.evaluate("(function () { var st = document.createElement('style'); st.textContent = '#sv-stage .cps { display: none !important; } .caption, .caption.swap { opacity: 1 !important; transition: none !important; }'; document.head.appendChild(st); return 1; })()");
    info = await c.evaluate(`(function () {
      var n = window.__nacholens, ch = n.changes || { steps: [] }, set = {};
      ch.steps.forEach(function (s) { set[s.useCase + "/" + s.step] = s.change; });
      return { head: ch.generated ? ch.generated.head : null, product: n.model.product.id,
        flows: n.model.useCases.map(function (u) { return { id: u.id, title: u.title, steps: u.steps.map(function (s, i) { return { id: s.id, label: s.label, change: set[u.id + "/" + s.id] || null }; }) }; })
          .filter(function (u) { return u.steps.some(function (s) { return s.change; }); }) };
    })()`);
    const tag = (t) => c.evaluate(`${TAG_JS}(${JSON.stringify(t)})`);
    const stageClip = async () => c.evaluate("(function () { var r = document.getElementById('sv-stage').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()");
    const label = (f, i) => { const s = f.steps[i]; return { text: `${stepNo(i)} ${s.label}${s.change ? " · " + S.change[s.change] : ""}  ${i + 1}/${f.steps.length}`, change: s.change }; };
    let shown = "";
    const show = async (f, i, at) => {
      const key = await c.evaluate(`(function () { var n = window.__nacholens; n.seek(${i}, ${at}); return n.state.step + ":" + n.state.leg; })()`);
      await tag(label(f, i));
      if (key !== shown) { shown = key; await sleep(140); }
    };
    const shot = async (clip) => Buffer.from((await c.send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 }, captureBeyondViewport: false })).data, "base64");
    const suffix = (theme) => (theme === "dark" ? ".dark" : "");

    for (const theme of themes) {
      // ── map: the first changed flow at its first changed step, sharp (2x) for a still
      await setView(2, theme); await sleep(250);
      const first = info.flows[0];
      if (first) {
        await c.evaluate(`window.__nacholens.selectUseCase(${JSON.stringify(first.id)})`); await sleep(450);
        const i = first.steps.findIndex((s) => s.change);
        shown = ""; await show(first, i, 0.55);
        const clip = await stageClip(), file = `map${suffix(theme)}.png`;
        writeFileSync(join(out, file), await shot(clip));
        files.push({ kind: "map", theme, useCase: first.id, file, width: clip.width, height: clip.height, scale: 2 });
        log(`생성: ${join(out, file)}`);
      }
      // ── one GIF per changed flow
      await setView(1, theme); await sleep(250);
      for (const f of info.flows.slice(0, flows)) {
        await c.evaluate(`window.__nacholens.selectUseCase(${JSON.stringify(f.id)})`); await sleep(450);
        shown = "";
        const clip = await stageClip(), frames = [], dt = Math.round(1000 / fps);
        for (let i = 0; i < f.steps.length; i++) {
          const legs = await c.evaluate(`window.__nacholens.legs(${i}).length`);
          const k = Math.min(12, Math.max(4, 4 * Math.max(1, legs)));
          for (let j = 0; j < k; j++) {
            await show(f, i, j / k);
            const png = decodePng(await shot(clip));
            frames.push({ data: png.data, delay: dt, w: png.width, h: png.height });
          }
          await show(f, i, 0.999);
          const png = decodePng(await shot(clip));
          frames.push({ data: png.data, delay: f.steps[i].change ? 1800 : 500, w: png.width, h: png.height });
        }
        frames[frames.length - 1].delay += 1500;
        const w = frames[0].w, h = frames[0].h;
        const gif = encodeGif(frames.filter((x) => x.w === w && x.h === h), { width: w, height: h });
        const file = `${f.id}${suffix(theme)}.gif`;
        writeFileSync(join(out, file), gif);
        files.push({ kind: "flow", theme, useCase: f.id, file, width: w, height: h, frames: frames.length, seconds: Math.round(frames.reduce((s, x) => s + x.delay, 0) / 100) / 10, bytes: gif.length });
        log(`생성: ${join(out, file)} (${Math.round(gif.length / 1024)} KB)`);
      }
    }
    await tag(null);
  } finally { await c.close(); }
  const manifest = { schemaVersion: 1, page: basename(page), product: info?.product ?? null, head: info?.head ?? null, files };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
