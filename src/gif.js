// Animated GIF encoder, no dependencies. One shared palette (median cut over the frames), no dithering
// (flat UI colours stay flat), and each frame stores only the rectangle that changed since the previous one,
// with unchanged pixels transparent. Frames whose pixels did not change are merged into the previous delay.

const TRANSPARENT = 255; // palette index reserved for "same as before"
const BITS = 5, LEVELS = 1 << BITS, SHIFT = 8 - BITS;
const binOf = (r, g, b) => ((r >> SHIFT) << (2 * BITS)) | ((g >> SHIFT) << BITS) | (b >> SHIFT);

/** Median-cut palette (at most `max` colours) from RGBA frames. */
export function buildPalette(frames, max = 255) {
  const n = LEVELS ** 3, count = new Float64Array(n), sr = new Float64Array(n), sg = new Float64Array(n), sb = new Float64Array(n);
  const every = Math.max(1, Math.ceil(frames.length / 16));
  for (let f = 0; f < frames.length; f += every) {
    const d = frames[f];
    for (let i = 0; i < d.length; i += 4) { const k = binOf(d[i], d[i + 1], d[i + 2]); count[k]++; sr[k] += d[i]; sg[k] += d[i + 1]; sb[k] += d[i + 2]; }
  }
  const bins = [];
  for (let k = 0; k < n; k++) if (count[k]) bins.push(k);
  const comp = (k, c) => (c === 0 ? k >> (2 * BITS) : c === 1 ? (k >> BITS) & (LEVELS - 1) : k & (LEVELS - 1));
  const box = (list) => {
    let lo = [99, 99, 99], hi = [-1, -1, -1], w = 0;
    for (const k of list) { for (let c = 0; c < 3; c++) { const v = comp(k, c); if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; } w += count[k]; }
    const range = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    const axis = [0, 1, 2].find((c) => hi[c] - lo[c] === range);
    return { list, w, range, axis };
  };
  const boxes = [box(bins)];
  while (boxes.length < max) {
    // split where it helps most: wide boxes, weighted (gently) by how many pixels they hold
    let best = -1, score = -1;
    boxes.forEach((b, i) => { if (b.list.length > 1 && b.range > 0) { const s = b.range * Math.sqrt(b.w); if (s > score) { score = s; best = i; } } });
    if (best < 0) break;
    const b = boxes[best], sorted = b.list.slice().sort((x, y) => comp(x, b.axis) - comp(y, b.axis));
    let acc = 0, cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) { acc += count[sorted[i]]; if (acc >= b.w / 2) { cut = i + 1; break; } cut = i + 1; }
    boxes.splice(best, 1, box(sorted.slice(0, cut)), box(sorted.slice(cut)));
  }
  return boxes.map((b) => {
    let w = 0, r = 0, g = 0, bl = 0;
    for (const k of b.list) { w += count[k]; r += sr[k]; g += sg[k]; bl += sb[k]; }
    return [Math.round(r / w), Math.round(g / w), Math.round(bl / w)];
  });
}

function mapper(palette) {
  const lut = new Int16Array(LEVELS ** 3).fill(-1);
  return (r, g, b) => {
    const k = binOf(r, g, b);
    if (lut[k] >= 0) return lut[k];
    let best = 0, bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i], d = (p[0] - r) ** 2 * 3 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 2;
      if (d < bd) { bd = d; best = i; }
    }
    lut[k] = best;
    return best;
  };
}

/** LZW-compressed image data (code size 8) as GIF sub-blocks. Mirrors the classic encoder (omggif). */
export function lzw(indices, minCode = 8) {
  const clear = 1 << minCode, eoi = clear + 1, out = [];
  let size = minCode + 1, next = eoi + 1, cur = 0, bits = 0;
  let table = new Map();
  const emit = (c) => { cur |= c << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i], key = (prefix << 8) | c, hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); next = eoi + 1; size = minCode + 1; table = new Map(); }
    else { if (next >= 1 << size) size++; table.set(key, next++); }
    prefix = c;
  }
  emit(prefix); emit(eoi);
  if (bits > 0) out.push(cur & 255);
  const blocks = [minCode];
  for (let i = 0; i < out.length; i += 255) { const n = Math.min(255, out.length - i); blocks.push(n); for (let j = 0; j < n; j++) blocks.push(out[i + j]); }
  blocks.push(0);
  return blocks;
}

/**
 * @param {{ data: Uint8Array, delay: number }[]} frames RGBA frames of `width` x `height`, delay in ms
 * @returns {Buffer}
 */
export function encodeGif(frames, { width, height, loop = 0 }) {
  if (!frames.length) throw new Error("no frames");
  for (const f of frames) if (f.data.length !== width * height * 4) throw new Error("frame size does not match width x height");
  const palette = buildPalette(frames.map((f) => f.data), 255);
  const map = mapper(palette);
  const bytes = [];
  const push = (...v) => { for (const x of v) bytes.push(x); };
  const u16 = (v) => push(v & 255, (v >> 8) & 255);
  push(...Buffer.from("GIF89a")); u16(width); u16(height);
  push(0xf7, 0, 0); // global colour table, 8 bits, 256 entries
  for (let i = 0; i < 256; i++) { const c = palette[i] ?? [0, 0, 0]; push(c[0], c[1], c[2]); }
  push(0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 3, 1); u16(loop); push(0);

  const n = width * height;
  let prev = null;
  const out = []; // { x, y, w, h, idx, delay }
  for (const f of frames) {
    const cur = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) cur[i] = map(f.data[j], f.data[j + 1], f.data[j + 2]);
    if (!prev) { out.push({ x: 0, y: 0, w: width, h: height, idx: cur, delay: f.delay }); prev = cur; continue; }
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0, o = y * width; x < width; x++) if (cur[o + x] !== prev[o + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { out[out.length - 1].delay += f.delay; continue; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y0 + y) * width + x0 + x; idx[y * w + x] = cur[o] === prev[o] ? TRANSPARENT : cur[o]; }
    out.push({ x: x0, y: y0, w, h, idx, delay: f.delay });
    prev = cur;
  }
  for (const fr of out) {
    const cs = Math.max(2, Math.round(fr.delay / 10)); // browsers treat 0-1 cs as 10 cs
    push(0x21, 0xf9, 4, (1 << 2) | 1); u16(cs); push(TRANSPARENT, 0); // disposal 1 (keep), transparent index
    push(0x2c); u16(fr.x); u16(fr.y); u16(fr.w); u16(fr.h); push(0);
    const data = lzw(fr.idx);
    for (const b of data) bytes.push(b);
  }
  push(0x3b);
  return Buffer.from(bytes);
}
