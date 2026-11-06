// Minimal PNG decoder for screenshots: 8-bit RGB / RGBA, not interlaced (what Chrome's DevTools protocol writes).
import { inflateSync } from "node:zlib";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @returns {{ width: number, height: number, data: Uint8Array }} data = RGBA, 4 bytes per pixel */
export function decodePng(buf) {
  buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG file");
  let p = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString("latin1", p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3, stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error("truncated PNG data");
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y > 0 ? px[up + x] : 0, c = x >= bpp && y > 0 ? px[up + x - bpp] : 0;
      let out;
      if (f === 0) out = v;
      else if (f === 1) out = v + a;
      else if (f === 2) out = v + b;
      else if (f === 3) out = v + ((a + b) >> 1);
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new Error(`bad PNG filter ${f}`);
      px[dst + x] = out & 255;
    }
  }
  if (bpp === 4) return { width, height, data: px };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) { data[j] = px[i]; data[j + 1] = px[i + 1]; data[j + 2] = px[i + 2]; data[j + 3] = 255; }
  return { width, height, data };
}
