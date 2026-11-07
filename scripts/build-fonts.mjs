#!/usr/bin/env node
/**
 * Build the player's embedded fonts (src/player/fonts/*.woff2) from the Nacho Combo font files.
 *
 * Dev-only step; the generated .woff2 files are committed, so building pages never needs this.
 * Pure Node (no Python): it uses subset-font (HarfBuzz compiled to WebAssembly), installed from
 * scripts/tools/package.json. The root package keeps zero dependencies and does not ship this folder.
 *
 *   npm --prefix scripts/tools ci
 *   node scripts/build-fonts.mjs <dir with Anton-Regular.ttf and IBMPlex*.ttf> [out dir]
 *
 * The sources are the unmodified files shipped by Nacho Combo (Resources/Fonts), licensed under the
 * SIL Open Font License 1.1. Subsetting makes a Modified Version. IBM Plex declares the Reserved Font
 * Name "Plex", so the subsets are renamed ("Nacho Sans", "Nacho Mono"); Anton declares none and keeps its
 * name. Copyright and license records stay in each font; see src/player/fonts/FONTLOG.md.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "fonts", "package.json"));
let subsetFont, fontverter;
try {
  subsetFont = require("subset-font");
  fontverter = require("fontverter");
} catch {
  console.error("Missing dev dependencies. Run: npm --prefix scripts/tools ci");
  process.exit(2);
}

// Latin text, punctuation and the arrows / symbols the player prints. Anything else (Hangul included)
// falls back, glyph by glyph, to the system font stack.
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const TEXT_UNICODES = [
  ...range(0x20, 0x7f), ...range(0xa0, 0x100), ...range(0x2010, 0x2028), ...range(0x2030, 0x203b),
  0x2044, 0x20ac, 0x20a9, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2194, 0x2212, 0x2260, 0x2264, 0x2265, 0x2713,
];
const SIGN_UNICODES = range(0x20, 0x7f); // Anton: the one loud line, set in capitals

const FONTS = [
  // source file, family, weight, unicodes
  ["IBMPlexSans-Regular.ttf", "Nacho Sans", 400, TEXT_UNICODES],
  ["IBMPlexSans-Medium.ttf", "Nacho Sans", 500, TEXT_UNICODES],
  ["IBMPlexSans-SemiBold.ttf", "Nacho Sans", 600, TEXT_UNICODES],
  ["IBMPlexSans-Bold.ttf", "Nacho Sans", 700, TEXT_UNICODES],
  ["IBMPlexMono-Medium.ttf", "Nacho Mono", 500, TEXT_UNICODES],
  ["IBMPlexMono-SemiBold.ttf", "Nacho Mono", 600, TEXT_UNICODES],
  ["Anton-Regular.ttf", "Anton", 400, SIGN_UNICODES],
];
const STYLE = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold" };
const NOTE = " Modified Version (subset and renamed) by Mafianacho, 2026.";
const KEEP_NAME_IDS = range(0, 400); // includes the stylistic-set labels (256+)

// ---- minimal sfnt (TrueType) reader / writer -------------------------------------------------
function readTables(buf) {
  const n = buf.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = buf.toString("latin1", o, o + 4);
    const off = buf.readUInt32BE(o + 8);
    tables.set(tag, Buffer.from(buf.subarray(off, off + buf.readUInt32BE(o + 12))));
  }
  return { version: buf.readUInt32BE(0), tables };
}
function checksum(buf) {
  let sum = 0;
  const padded = Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}
function writeSfnt({ version, tables }) {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  const head = tables.get("head");
  head.writeUInt32BE(0, 8); // checkSumAdjustment is recomputed below
  let pow = 1, log = 0;
  while (pow * 2 <= n) { pow *= 2; log++; }
  const dir = Buffer.alloc(12 + n * 16);
  dir.writeUInt32BE(version, 0);
  dir.writeUInt16BE(n, 4);
  dir.writeUInt16BE(pow * 16, 6);
  dir.writeUInt16BE(log, 8);
  dir.writeUInt16BE(n * 16 - pow * 16, 10);
  let offset = dir.length;
  const parts = [dir];
  tags.forEach((tag, i) => {
    const data = tables.get(tag);
    const o = 12 + i * 16;
    dir.write(tag, o, 4, "latin1");
    dir.writeUInt32BE(checksum(data), o + 4);
    dir.writeUInt32BE(offset, o + 8);
    dir.writeUInt32BE(data.length, o + 12);
    const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
    parts.push(padded);
    offset += padded.length;
  });
  const out = Buffer.concat(parts);
  const adjust = (0xb1b0afba - checksum(out)) >>> 0;
  const headOffset = dir.readUInt32BE(12 + tags.indexOf("head") * 16 + 8);
  out.writeUInt32BE(adjust, headOffset + 8);
  return out;
}

// ---- name table -------------------------------------------------------------------------------
function readName(buf) {
  const count = buf.readUInt16BE(2), strOff = buf.readUInt16BE(4);
  const records = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const [platformID, encodingID, languageID, nameID, length, offset] = [0, 2, 4, 6, 8, 10].map((k) => buf.readUInt16BE(r + k));
    records.push({ platformID, encodingID, languageID, nameID, raw: Buffer.from(buf.subarray(strOff + offset, strOff + offset + length)) });
  }
  return records;
}
const isUtf16 = (r) => r.platformID === 3 || r.platformID === 0;
const decode = (r) => (isUtf16(r) ? Buffer.from(r.raw).swap16().toString("utf16le") : r.raw.toString("latin1"));
const utf16 = (s) => Buffer.from(s, "utf16le").swap16();
function writeName(records) {
  const sorted = [...records].sort((a, b) => a.platformID - b.platformID || a.encodingID - b.encodingID || a.languageID - b.languageID || a.nameID - b.nameID);
  const head = Buffer.alloc(6 + sorted.length * 12);
  head.writeUInt16BE(0, 0);
  head.writeUInt16BE(sorted.length, 2);
  head.writeUInt16BE(head.length, 4);
  const chunks = [];
  let off = 0;
  sorted.forEach((r, i) => {
    const o = 6 + i * 12;
    [r.platformID, r.encodingID, r.languageID, r.nameID, r.raw.length, off].forEach((v, k) => head.writeUInt16BE(v, o + k * 2));
    chunks.push(r.raw);
    off += r.raw.length;
  });
  return Buffer.concat([head, ...chunks]);
}
/** Replace every font-name record; keep copyright (0), trademark (7), vendor/designer (8-12) and license (13, 14). */
function rename(records, family, weight) {
  const style = STYLE[weight];
  const ps = family.replaceAll(" ", "") + "-" + style;
  const names = {
    1: weight === 400 || weight === 700 ? family : `${family} ${style}`,
    2: weight === 700 ? "Bold" : "Regular",
    3: `${ps};Mafianacho;2026`, 4: `${family} ${style}`, 6: ps, 16: family, 17: style,
  };
  const drop = new Set([...Object.keys(names).map(Number), 18, 21, 22, 25]);
  const kept = records.filter((r) => !drop.has(r.nameID));
  for (const r of kept) if (r.nameID === 0 && !decode(r).includes(NOTE.trim())) r.raw = isUtf16(r) ? utf16(decode(r) + NOTE) : Buffer.from(decode(r) + NOTE, "latin1");
  for (const [id, value] of Object.entries(names)) kept.push({ platformID: 3, encodingID: 1, languageID: 0x409, nameID: Number(id), raw: utf16(value) });
  return kept;
}

async function main() {
  if (process.argv.length < 3) { console.error(readFileSync(fileURLToPath(import.meta.url), "utf8").match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, "")); process.exit(2); }
  const src = resolve(process.argv[2]);
  const out = process.argv[3] ? resolve(process.argv[3]) : resolve(here, "../src/player/fonts");
  mkdirSync(out, { recursive: true });
  for (const [file, family, weight, unicodes] of FONTS) {
    const subset = await subsetFont(readFileSync(join(src, file)), String.fromCodePoint(...unicodes), {
      targetFormat: "truetype", preserveNameIds: KEEP_NAME_IDS,
    });
    const sfnt = readTables(Buffer.from(subset));
    if (sfnt.tables.has("CFF ")) throw new Error("CFF fonts are not expected here");
    let records = readName(sfnt.tables.get("name"));
    if (family !== "Anton") records = rename(records, family, weight); // "Plex" is a Reserved Font Name: a Modified Version must not carry it
    sfnt.tables.set("name", writeName(records));
    const woff2 = Buffer.from(await fontverter.convert(writeSfnt(sfnt), "woff2"));
    const name = `${family.toLowerCase().replaceAll(" ", "-")}-${weight}.woff2`;
    writeFileSync(join(out, name), woff2);
    const leftover = records.filter((r) => /plex/i.test(decode(r)) && ![0, 7, 8, 9, 10, 11, 12, 13, 14].includes(r.nameID)).map((r) => r.nameID);
    if (family !== "Anton" && leftover.length) throw new Error(`${name}: name records still say Plex: ${leftover}`);
    console.log(name, statSync(join(out, name)).size);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
