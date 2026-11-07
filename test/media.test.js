// PNG decoder, GIF encoder (checked by an independent decoder written here), and `snap` against a real Chrome when one is installed.
import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePng } from "../src/png.js";
import { encodeGif, lzw } from "../src/gif.js";
import { findChrome } from "../src/snap.js";
import { run, EXIT } from "../src/cli.js";
import { root } from "./helpers.js";

/* ── a tiny PNG writer for the decoder test (filters 0-4 applied by hand) ── */
function crc32(buf) { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "latin1"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(width, height, bpp, px) {
  const stride = width * bpp, rows = [];
  for (let y = 0; y < height; y++) {
    const f = y % 5, row = Buffer.alloc(stride + 1); row[0] = f;
    for (let x = 0; x < stride; x++) {
      const v = px[y * stride + x], a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      row[x + 1] = (v - pred) & 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = bpp === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

test("PNG decoder: RGB and RGBA, every filter type", () => {
  for (const bpp of [3, 4]) {
    const w = 7, h = 10, px = Buffer.alloc(w * h * bpp);
    for (let i = 0; i < px.length; i++) px[i] = (i * 37 + (i >> 3) * 11) & 255;
    const d = decodePng(png(w, h, bpp, px));
    assert.equal(d.width, w); assert.equal(d.height, h);
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 4; c++) assert.equal(d.data[i * 4 + c], c < bpp ? px[i * bpp + c] : 255);
  }
  assert.throws(() => decodePng(Buffer.from("nope")), /not a PNG/);
});

/* ── an independent GIF decoder: header, global table, extensions, LZW, transparency + disposal 1 ── */
function decodeGif(buf) {
  let p = 6; const W = buf.readUInt16LE(p), H = buf.readUInt16LE(p + 2), flags = buf[p + 4]; p += 7;
  const gct = []; const size = 2 << (flags & 7); for (let i = 0; i < size; i++) gct.push([buf[p + i * 3], buf[p + i * 3 + 1], buf[p + i * 3 + 2]]); p += size * 3;
  const canvas = new Uint8Array(W * H * 3), frames = []; let trans = -1, delay = 0, loop = null;
  while (buf[p] !== 0x3b) {
    if (buf[p] === 0x21) {
      const label = buf[p + 1]; p += 2;
      if (label === 0xf9) { const f = buf[p + 1]; delay = buf.readUInt16LE(p + 2) * 10; trans = f & 1 ? buf[p + 4] : -1; assert.equal((f >> 2) & 7, 1, "disposal 1"); }
      if (label === 0xff && buf.toString("latin1", p + 1, p + 12) === "NETSCAPE2.0") loop = buf.readUInt16LE(p + 14);
      while (buf[p]) p += buf[p] + 1; p++;
      continue;
    }
    assert.equal(buf[p], 0x2c);
    const x = buf.readUInt16LE(p + 1), y = buf.readUInt16LE(p + 3), w = buf.readUInt16LE(p + 5), h = buf.readUInt16LE(p + 7); p += 10;
    const min = buf[p++]; const data = []; while (buf[p]) { for (let i = 1; i <= buf[p]; i++) data.push(buf[p + i]); p += buf[p] + 1; } p++;
    // LZW decode
    const clear = 1 << min, eoi = clear + 1; let size = min + 1, dict = [], prev = null, bit = 0; const out = [];
    const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = null; size = min + 1; prev = null; };
    reset();
    for (;;) {
      let code = 0; for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === eoi) break;
      let entry = dict[code];
      if (entry === undefined) entry = [...dict[prev], dict[prev][0]];
      out.push(...entry);
      if (prev !== null && dict.length < 4096) dict.push([...dict[prev], entry[0]]);
      prev = code;
      if (dict.length === 1 << size && size < 12) size++;
    }
    assert.equal(out.length, w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = out[j * w + i]; if (v === trans) continue; const o = ((y + j) * W + x + i) * 3; canvas.set(gct[v], o); }
    frames.push({ rgb: canvas.slice(), delay, rect: [x, y, w, h] });
  }
  return { W, H, frames, loop };
}

const frame = (w, h, fn, delay) => { const d = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y), o = (y * w + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; } return { data: d, delay }; };

test("GIF: frames round-trip exactly (few colours), unchanged frames merge, later frames store only the changed rectangle", () => {
  const w = 40, h = 24, bg = [255, 247, 225], ink = [36, 24, 13], nacho = [255, 196, 61];
  const f0 = frame(w, h, (x, y) => (y === 5 ? ink : bg), 100);
  const f1 = frame(w, h, (x, y) => (y === 5 ? ink : bg), 300); // identical: merged into f0
  const f2 = frame(w, h, (x, y) => (x >= 10 && x < 14 && y >= 8 && y < 11 ? nacho : y === 5 ? ink : bg), 200);
  const g = decodeGif(encodeGif([f0, f1, f2], { width: w, height: h }));
  assert.equal(g.W, w); assert.equal(g.loop, 0); assert.equal(g.frames.length, 2);
  assert.equal(g.frames[0].delay, 400, "the identical frame's delay is added to the previous one");
  assert.deepEqual(g.frames[1].rect, [10, 8, 4, 3]);
  for (const [k, src] of [[0, f0], [1, f2]]) for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) assert.equal(g.frames[k].rgb[i * 3 + c], src.data[i * 4 + c]);
});

test("GIF: LZW past 4096 codes (clear code) and many colours decode to the nearest palette colour", () => {
  const w = 180, h = 120;
  const f = frame(w, h, (x, y) => [(x * 7 + y * 3) & 255, (x * y) & 255, (y * 11) & 255], 100);
  const g = decodeGif(encodeGif([f], { width: w, height: h }));
  let err = 0; for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) err = Math.max(err, Math.abs(g.frames[0].rgb[i * 3 + c] - f.data[i * 4 + c]));
  assert.ok(err <= 72, `largest channel error ${err}`); // 255 colours for ~21k distinct ones: approximate, never garbage
  const blocks = lzw(new Uint8Array(20000).map((_, i) => (i * 31) % 251));
  assert.equal(blocks[0], 8); assert.equal(blocks.at(-1), 0);
});

test("snap / pr: arguments are checked before anything runs", () => {
  const log = () => {};
  assert.throws(() => run(["pr"], {}, log), /--from/);
  assert.throws(() => run(["pr", "--from", "/nonexistent-dir"], {}, log), /report\.json/);
  assert.throws(() => run(["pr", "--from", ".", "--pr", "3"], {}, log), /--repo-url/);
  assert.throws(() => run(["pr", "--from", ".", "--repo-url", "https://github.com/o/r", "--pr", "0"], {}, log), /PR 번호/);
  assert.throws(() => run(["pr", "--from", ".", "--player-url", "javascript:alert(1)"], {}, log), /https/);
  assert.throws(() => run(["pr", "--from", ".", "--media-url", "https://x.example/a b"], {}, log), /https/);
  assert.throws(() => run(["pr", "--from", ".", "--repo-url", "https://github.com/onlyowner"], {}, log), /owner/);
});

const chrome = findChrome();
const canSnap = typeof WebSocket === "function" && !!chrome;
test("snap + pr end to end on the committed demo page (real headless Chrome)", { skip: canSnap ? false : "needs Node 22+ and a local Chrome/Chromium", timeout: 120000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), "nl-snap-"));
  const logs = [];
  const code = await run(["snap", "--page", join(root, "examples", "demo-shop.html"), "--out", out, "--flows", "1", "--themes", "light", "--fps", "6"], {}, (m) => logs.push(m));
  assert.equal(code, EXIT.OK);
  const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  const map = m.files.find((f) => f.kind === "map"), gif = m.files.find((f) => f.kind === "flow");
  assert.ok(map && gif, JSON.stringify(m));
  assert.equal(readFileSync(join(out, map.file)).subarray(1, 4).toString(), "PNG");
  const g = decodeGif(readFileSync(join(out, gif.file)));
  assert.equal(g.W, gif.width);
  assert.ok(g.frames.length > 4, "it moves");
  assert.ok(existsSync(join(out, `${gif.useCase}.gif`)));
});
