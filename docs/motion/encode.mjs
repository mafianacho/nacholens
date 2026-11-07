#!/usr/bin/env node
// Encode captured frames (render.mjs output) into one looping GIF with a shared palette. Node only.
//   node docs/motion/encode.mjs <frames dir> <out.gif> [--fps 25] [--hold-last 1500] [--colors 255]
// Needs the dev-only packages of scripts/tools (npm --prefix scripts/tools ci): gifenc and pngjs.
// The shared palette is built from a sample of the frames (every 6th), so the colours do not flicker between
// frames. Pixels that did not change from the previous frame are written as the transparent colour with
// "leave in place" disposal, so unchanged areas cost almost nothing.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tools = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/tools/package.json");
const require = createRequire(tools);
let gifenc, PNG;
try {
  gifenc = require("gifenc");
  ({ PNG } = require("pngjs"));
} catch {
  console.error("Missing dev dependencies. Run: npm --prefix scripts/tools ci");
  process.exit(2);
}
const { GIFEncoder, quantize, applyPalette } = gifenc;

const argv = process.argv.slice(2);
const positional = [];
const opt = { fps: 25, "hold-last": 0, colors: 255 };
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = Number(argv[++i]);
  else positional.push(argv[i]);
}
if (positional.length !== 2 || !(opt.fps > 0) || !(opt.colors >= 2 && opt.colors <= 255) || !(opt["hold-last"] >= 0)) {
  console.error("usage: node docs/motion/encode.mjs <frames dir> <out.gif> [--fps 25] [--hold-last 1500] [--colors 255]");
  process.exit(2);
}
const [dir, outFile] = positional.map((p) => resolve(p));
const files = readdirSync(dir).filter((f) => /^f.*\.png$/.test(f)).sort();
if (!files.length) { console.error("no frames found"); process.exit(1); }

const frames = files.map((f) => PNG.sync.read(readFileSync(join(dir, f))));
const { width, height } = frames[0];
if (frames.some((f) => f.width !== width || f.height !== height)) { console.error("frames differ in size"); process.exit(1); }

// palette from a contact sheet of every 6th frame
const sample = frames.filter((_, i) => i % 6 === 0);
const sheet = new Uint8Array(width * height * 4 * sample.length);
sample.forEach((f, i) => sheet.set(f.data, i * width * height * 4));
const colors = quantize(sheet, opt.colors, { format: "rgb565" });
const palette = colors.slice(0, opt.colors);
while (palette.length < 256) palette.push([0, 0, 0]); // the last entry is the transparent colour
const TRANSPARENT = 255;

const gif = GIFEncoder();
const delay = Math.round(1000 / opt.fps);
let prev = null;
frames.forEach((f, i) => {
  const index = applyPalette(f.data, palette.slice(0, opt.colors), "rgb565");
  const send = index.slice();
  if (prev) for (let p = 0; p < index.length; p++) if (index[p] === prev[p]) send[p] = TRANSPARENT;
  gif.writeFrame(send, width, height, {
    palette: i === 0 ? palette : undefined,
    delay: delay + (i === frames.length - 1 ? opt["hold-last"] : 0),
    transparent: i > 0, transparentIndex: TRANSPARENT, dispose: 1, repeat: 0,
  });
  prev = index;
});
gif.finish();
writeFileSync(outFile, gif.bytes());
console.log(`${frames.length} frames, ${Math.round(statSync(outFile).size / 1024)} KiB -> ${outFile}`);
