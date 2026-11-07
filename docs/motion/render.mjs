#!/usr/bin/env node
// Capture frames of blackbox-to-whitebox.html with headless Chrome (DevTools protocol, no npm packages).
//   node docs/motion/render.mjs --lang en --out /tmp/frames-en [--fps 25] [--at 7.5,9.4]   (--at = only those seconds)
// Needs Node >= 22 (global WebSocket) and a Chrome/Chromium: set CHROME=/path/to/chrome if it is not on PATH.
// Encode the frames with encode.mjs.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const lang = args.lang || "en";
const fps = parseFloat(args.fps || "25");
const out = resolve(args.out || `frames-${lang}`);
const chrome = process.env.CHROME || "google-chrome";
process.env.TMPDIR = "/tmp"; // Chrome refuses a profile/socket path that is too long
const html = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "blackbox-to-whitebox.html")).href + `?lang=${lang}`;
mkdirSync(out, { recursive: true });

const profile = mkdtempSync(join("/tmp", "nlm-"));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--allow-file-access-from-files",
  "--no-sandbox", "--hide-scrollbars", "--force-device-scale-factor=1", "--font-render-hinting=none", "about:blank"
], { stdio: "ignore" });

async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() > end) throw new Error("timeout");
    await new Promise(r => setTimeout(r, 100));
  }
}
try {
  const targets = await until(async () => (await fetch(`http://127.0.0.1:${port}/json`)).json());
  const page = targets.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const wait = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const send = (method, params = {}) => new Promise(r => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: html });
  await until(async () => (await send("Runtime.evaluate", { expression: "typeof window.READY", returnByValue: true })).result.result.value === "object");
  await send("Runtime.evaluate", { expression: "window.READY", awaitPromise: true });
  const dur = (await send("Runtime.evaluate", { expression: "window.DURATION", returnByValue: true })).result.result.value;
  const times = args.at ? args.at.split(",").map(Number) : Array.from({ length: Math.round(dur * fps) }, (_, i) => i / fps);
  let n = 0;
  for (const t of times) {
    await send("Runtime.evaluate", { expression: `window.renderFrame(${t})` });
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const name = args.at ? `still-${String(t).replace(".", "_")}.png` : `f${String(n++).padStart(4, "0")}.png`;
    writeFileSync(join(out, name), Buffer.from(shot.result.data, "base64"));
  }
  console.log(`${times.length} frame(s) -> ${out}`);
  ws.close();
} finally {
  proc.kill();
  await new Promise(r => setTimeout(r, 500));
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* temp profile, harmless */ }
}
