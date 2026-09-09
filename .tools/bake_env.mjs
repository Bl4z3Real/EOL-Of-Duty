#!/usr/bin/env node
// Convert the map's own lighting assets into things the web viewer can load.
// Output paths come from the map registry (export/web/maps.js); for Hijacked:
//
//   export/web/textures/env/{px,nx,py,ny,pz,nz}.png   sky cubemap, glTF axes
//   export/web/textures/probe/{...}.png               reflection probe cubemap
//   export/web/textures/mp_hijacked_lut.png           vision-set colour grade
//   export/web/vision.json                            parsed .vision constants
//
//   npm run bake:env -- --map mp_nuketown_2020 [--images export/images_nuketown]
//
// Every map's dump names its reflection probe _reflection_probe1.dds, so a
// second map's images need their own folder, hence --images.
//
// The DDS files are BC3 cubemaps in the engine's z-up space. Rather than guess
// per-face flips, every output texel is resampled: take the glTF direction for
// the texel, rotate it back into engine space with the inverse of compose's
// (x, z, -y) swap, then sample whichever engine face that direction lands on.
//
// DXT1/DXT5 (BC1/BC3) and uncompressed RGBA cubemaps are decoded here; any
// other DDS format falls back to texconv.exe when it is present in .tools/.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DEFAULT_MAP, MAP_IDS, findMap } from '../export/web/maps.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'export', 'web');
const TEXCONV = path.join(ROOT, '.tools', 'texconv.exe');
const TMP = path.join(ROOT, '.tools', '.env_tmp');

// glTF/Three cube face order; engine DDS order is +X -X +Y -Y +Z -Z (z-up).
const FACE_NAMES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

// ------------------------------- PNG output -------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// rgb: Uint8Array of w*h*3
export function encodePng(rgb, w, h) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.copy
      ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
      : Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------- DDS input --------------------------------

const DDS_HEADER = 128;
const DDPF_FOURCC = 0x4;
const DDSCAPS2_CUBEMAP = 0x200;

function rgb565(value) {
  return [((value >> 11) & 31) * 255 / 31, ((value >> 5) & 63) * 255 / 63, (value & 31) * 255 / 31];
}

// One 4x4 block of BC1 (DXT1) or BC3 (DXT5) into an RGBA8 image.
function decodeBlock(data, p, fourcc, out, w, h, bx, by) {
  let alpha = null;
  if (fourcc === 'DXT5') {
    const a0 = data[p];
    const a1 = data[p + 1];
    const table = a0 > a1
      ? [a0, a1, (6 * a0 + a1) / 7, (5 * a0 + 2 * a1) / 7, (4 * a0 + 3 * a1) / 7, (3 * a0 + 4 * a1) / 7, (2 * a0 + 5 * a1) / 7, (a0 + 6 * a1) / 7]
      : [a0, a1, (4 * a0 + a1) / 5, (3 * a0 + 2 * a1) / 5, (2 * a0 + 3 * a1) / 5, (a0 + 4 * a1) / 5, 0, 255];
    // 16 three-bit indices packed little-endian across six bytes.
    let bits = 0n;
    for (let i = 5; i >= 0; i--) bits = (bits << 8n) | BigInt(data[p + 2 + i]);
    alpha = new Array(16);
    for (let i = 0; i < 16; i++) alpha[i] = table[Number((bits >> BigInt(i * 3)) & 7n)];
    p += 8;
  }
  const c0 = data.readUInt16LE(p);
  const c1 = data.readUInt16LE(p + 2);
  const idx = data.readUInt32LE(p + 4);
  const [r0, g0, b0] = rgb565(c0);
  const [r1, g1, b1] = rgb565(c1);
  const palette = fourcc === 'DXT1' && c0 <= c1
    ? [[r0, g0, b0, 255], [r1, g1, b1, 255], [(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255], [0, 0, 0, 0]]
    : [[r0, g0, b0, 255], [r1, g1, b1, 255], [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3, 255], [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3, 255]];
  for (let i = 0; i < 16; i++) {
    const x = bx * 4 + (i & 3);
    const y = by * 4 + (i >> 2);
    if (x >= w || y >= h) continue;
    const color = palette[(idx >> (i * 2)) & 3];
    const o = (y * w + x) * 4;
    out[o] = color[0];
    out[o + 1] = color[1];
    out[o + 2] = color[2];
    out[o + 3] = alpha ? alpha[i] : color[3];
  }
}

function decodeBc(data, offset, w, h, fourcc) {
  const out = Buffer.alloc(w * h * 4);
  const blockBytes = fourcc === 'DXT1' ? 8 : 16;
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) decodeBlock(data, offset + (by * bw + bx) * blockBytes, fourcc, out, w, h, bx, by);
  }
  return out;
}

function mipBytes(w, h, fourcc) {
  if (fourcc === 'DXT1') return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 8;
  if (fourcc === 'DXT5') return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * 16;
  return w * h * 4;
}

// Decode the top mip of every face into one flat RGBA8 array. Faces are
// stored face-major in DDS, each with its full mip chain.
function readCubeRGBA(ddsPath) {
  const file = fs.readFileSync(ddsPath);
  const h = file.readUInt32LE(12);
  const w = file.readUInt32LE(16);
  const mips = Math.max(1, file.readUInt32LE(28));
  const pfFlags = file.readUInt32LE(80);
  const fourcc = pfFlags & DDPF_FOURCC ? file.toString('latin1', 84, 88) : 'RGBA';
  const faces = file.readUInt32LE(112) & DDSCAPS2_CUBEMAP ? 6 : 1;
  if (fourcc !== 'DXT1' && fourcc !== 'DXT5' && fourcc !== 'RGBA') return readCubeRGBAWithTexconv(ddsPath);
  if (fourcc === 'RGBA' && file.readUInt32LE(88) !== 32) return readCubeRGBAWithTexconv(ddsPath);
  const bgra = fourcc === 'RGBA' && file.readUInt32LE(92) === 0x00ff0000;

  let faceStride = 0;
  for (let level = 0, mw = w, mh = h; level < mips; level++, mw = Math.max(1, mw >> 1), mh = Math.max(1, mh >> 1)) faceStride += mipBytes(mw, mh, fourcc);
  const faceBytes = w * h * 4;
  const buf = Buffer.alloc(faceBytes * faces);
  for (let f = 0; f < faces; f++) {
    const src = DDS_HEADER + f * faceStride;
    const decoded = fourcc === 'RGBA' ? file.subarray(src, src + faceBytes) : decodeBc(file, src, w, h, fourcc);
    decoded.copy(buf, f * faceBytes);
    if (bgra) {
      for (let i = f * faceBytes; i < (f + 1) * faceBytes; i += 4) {
        const b = buf[i];
        buf[i] = buf[i + 2];
        buf[i + 2] = b;
      }
    }
  }
  return { buf, w, h, faces, offset: 0, faceBytes };
}

// Other block formats: decompress to RGBA8 via texconv, then read the flat face array.
function readCubeRGBAWithTexconv(ddsPath) {
  if (!fs.existsSync(TEXCONV)) throw new Error(`${path.basename(ddsPath)} is not DXT1/DXT5/RGBA8 and .tools/texconv.exe is not available`);
  fs.mkdirSync(TMP, { recursive: true });
  execFileSync(TEXCONV, ['-y', '-ft', 'dds', '-f', 'R8G8B8A8_UNORM', '-m', '1', '-o', TMP, ddsPath], {
    stdio: 'pipe',
  });
  const out = path.join(TMP, path.basename(ddsPath));
  const buf = fs.readFileSync(out);
  const h = buf.readUInt32LE(12);
  const w = buf.readUInt32LE(16);
  const faceBytes = w * h * 4;
  const faces = buf.length - 128 >= faceBytes * 6 ? 6 : 1;
  return { buf, w, h, faces, offset: 128, faceBytes };
}

// Direction for a texel on engine face `f` at [-1,1] coords (D3D convention).
export function faceDir(f, u, v) {
  switch (f) {
    case 0: return [1, -v, -u];
    case 1: return [-1, -v, u];
    case 2: return [u, 1, v];
    case 3: return [u, -1, -v];
    case 4: return [u, -v, 1];
    default: return [-u, -v, -1];
  }
}

// Inverse: which face does this direction hit, and where.
export function dirToFace(d) {
  const [x, y, z] = d;
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) {
    return x > 0 ? [0, -z / ax, -y / ax] : [1, z / ax, -y / ax];
  }
  if (ay >= az) {
    return y > 0 ? [2, x / ay, z / ay] : [3, x / ay, -z / ay];
  }
  return z > 0 ? [4, x / az, -y / az] : [5, -x / az, -y / az];
}

// compose_scene.py maps engine (x,y,z) -> glTF (x, z, -y).
// Inverse: glTF (dx,dy,dz) -> engine (dx, -dz, dy).
export const gltfDirToEngine = (d) => [d[0], -d[2], d[1]];

function resampleCube(src, size) {
  const { buf, w, h, offset, faceBytes } = src;
  const out = [];
  for (let f = 0; f < 6; f++) {
    const px = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = ((x + 0.5) / size) * 2 - 1;
        const v = ((y + 0.5) / size) * 2 - 1;
        const [ef, eu, ev] = dirToFace(gltfDirToEngine(faceDir(f, u, v)));
        const sx = Math.min(w - 1, Math.max(0, Math.floor(((eu + 1) / 2) * w)));
        const sy = Math.min(h - 1, Math.max(0, Math.floor(((ev + 1) / 2) * h)));
        const so = offset + ef * faceBytes + (sy * w + sx) * 4;
        const to = (y * size + x) * 3;
        px[to] = buf[so];
        px[to + 1] = buf[so + 1];
        px[to + 2] = buf[so + 2];
      }
    }
    out.push(px);
  }
  return out;
}

/**
 * Repair the dark seam the engine's skybox carries at its horizon.
 *
 * The source cubemap has a band at the horizon whose core is ~(8,8,8) - the
 * join between the two halves of the sky art. In game the ocean geometry
 * covers it; here it magnifies into a dark line across the horizon.
 *
 * The seam is a soft dark band, not just a run of black texels. Repairing only
 * the near-black core leaves rows at ~160 luma between neighbours at ~210,
 * which still reads as a dark line across the horizon. So the test is a
 * per-row dip against a baseline taken from outside the band, and the whole
 * row is rebuilt rather than individual texels.
 *
 * Runs longer than maxRows are left alone, so a genuine dark mass (a storm
 * front, a landmass) is not smoothed away - only a thin band that is darker
 * than both sides qualifies.
 */
export function repairHorizonSeam(px, w, h, { dip = 0.88, maxRows = 20, gap = 8 } = {}) {
  const rowMean = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      s += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    }
    rowMean[y] = s / w;
  }

  // baseline from rows well clear of the band on both sides
  const baselineAt = (y) => {
    const a = rowMean[Math.max(0, y - gap - 4)];
    const b = rowMean[Math.min(h - 1, y + gap + 4)];
    return (a + b) / 2;
  };

  const suspect = new Uint8Array(h);
  for (let y = gap; y < h - gap; y++) {
    if (rowMean[y] < dip * baselineAt(y)) suspect[y] = 1;
  }

  let repaired = 0;
  let y = 0;
  while (y < h) {
    if (!suspect[y]) { y++; continue; }
    let end = y;
    while (end < h && suspect[end]) end++;
    const above = y - 1;
    const below = end;
    // Both brackets must be meaningfully brighter than the run. Testing only
    // the row above lets the edge of a large dark mass qualify - bright on one
    // side, still dark on the other - and the repair then eats into real
    // content instead of a seam.
    let runMean = 0;
    for (let k = y; k < end; k++) runMean += rowMean[k];
    runMean /= (end - y);
    const bracketed = above >= 0 && below < h
      && rowMean[above] > runMean / dip
      && rowMean[below] > runMean / dip;
    if (end - y <= maxRows && bracketed) {
      for (let k = y; k < end; k++) {
        const t = (k - above) / (below - above);
        for (let x = 0; x < w; x++) {
          for (let c = 0; c < 3; c++) {
            px[(k * w + x) * 3 + c] = Math.round(
              px[(above * w + x) * 3 + c] * (1 - t) + px[(below * w + x) * 3 + c] * t,
            );
          }
        }
      }
      repaired += end - y;
    }
    y = end;
  }
  return repaired;
}

/**
 * Wash the sky into atmospheric haze toward and below the horizon.
 *
 * Two problems, one fix. The lower hemisphere of the skybox is never seen in
 * game - the ocean covers it - so the artists left junk down there, including
 * a black cloud mass on the -X face that reads as smoke sitting on our
 * horizon. And the band just above the horizon is the most saturated part of
 * the art, which is what makes the sky look unnatural next to the real game,
 * where distance washes out into pale haze.
 *
 * Blending toward the measured horizon colour handles both: everything below
 * the horizon becomes clean haze, and the vivid band above it is muted with a
 * falloff that leaves the zenith alone.
 */
export function applySkyHaze(faces, size, { strength = 0.6, falloff = 0.30 } = {}) {
  // Horizon colour: mean of the texels sitting within a narrow elevation band.
  // The band widens until it catches something, because at small face sizes no
  // texel direction may land inside a fixed narrow band at all.
  let haze = null;
  for (let band = 0.02; band <= 0.5 && !haze; band *= 2) {
    let hr = 0, hg = 0, hb = 0, n = 0;
    for (let f = 0; f < 6; f++) {
      const px = faces[f];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = ((x + 0.5) / size) * 2 - 1;
          const v = ((y + 0.5) / size) * 2 - 1;
          const d = faceDir(f, u, v);
          const e = d[1] / Math.hypot(d[0], d[1], d[2]);
          if (Math.abs(e) > band) continue;
          const o = (y * size + x) * 3;
          hr += px[o]; hg += px[o + 1]; hb += px[o + 2];
          n++;
        }
      }
    }
    if (n) haze = [hr / n, hg / n, hb / n];
  }
  if (!haze) return null;

  for (let f = 0; f < 6; f++) {
    const px = faces[f];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = ((x + 0.5) / size) * 2 - 1;
        const v = ((y + 0.5) / size) * 2 - 1;
        const d = faceDir(f, u, v);
        const len = Math.hypot(d[0], d[1], d[2]);
        const e = d[1] / len;
        // Below the horizon go fully to haze; above it, fade out with height.
        const t = e < 0 ? 1 : strength * Math.exp(-e / falloff);
        if (t <= 0.001) continue;
        const o = (y * size + x) * 3;
        for (let c = 0; c < 3; c++) {
          px[o + c] = Math.round(px[o + c] * (1 - t) + haze[c] * t);
        }
      }
    }
  }
  return haze.map((v) => Math.round(v));
}

function writeCube(dir, faces, size) {
  fs.mkdirSync(dir, { recursive: true });
  faces.forEach((px, i) => {
    fs.writeFileSync(path.join(dir, `${FACE_NAMES[i]}.png`), encodePng(px, size, size));
  });
}

// ------------------------------ vision set --------------------------------

// mp_hijacked.vision holds the map's authored filmic curve. vc_YH / vc_YL are
// the highlight and lowlight tone targets (rgb + exposure scale in .w).
export function parseVision(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(vc_\w+)\s+"([^"]+)"/);
    if (m) out[m[1]] = m[2].trim().split(/\s+/).map(Number);
  }
  return out;
}

export function visionGrade(vision) {
  const yh = vision.vc_YH || [1, 1, 1, 1];
  const yl = vision.vc_YL || [0, 0, 0, 1];
  // .w on the highlight target is the engine's exposure multiplier.
  return {
    highlight: yh.slice(0, 3),
    lowlight: yl.slice(0, 3),
    exposure: yh[3] ?? 1,
    lowlightScale: yl[3] ?? 1,
  };
}

// --------------------------------- main -----------------------------------

function parseArgs(argv) {
  const args = { map: DEFAULT_MAP, images: path.join(ROOT, 'export', 'images'), sky: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--map' || arg === '-m') args.map = argv[++i];
    else if (arg === '--images') args.images = path.resolve(ROOT, argv[++i]);
    // Stand-in sky (a DDS name without extension) while the real skybox is
    // not exported; a reflection probe carries the sky in its upper half.
    else if (arg === '--sky') args.sky = argv[++i];
    else throw new Error(`unknown argument ${arg}; usage: bake_env.mjs [--map <${MAP_IDS.join('|')}>] [--images <dir>] [--sky <dds name>]`);
  }
  return args;
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const map = findMap(args.map);
  if (!map) throw new Error(`unknown map ${args.map}; expected one of ${MAP_IDS.join(', ')}`);
  const IMAGES = args.images;
  const envDir = path.join(WEB, map.env);
  const probeDir = path.join(WEB, map.probe);
  // A map whose LUT is not exported yet has lut: null in the registry; the
  // PNG still lands at the conventional name so the entry can be flipped.
  const lutOut = path.join(WEB, map.lut ?? path.join('textures', `${map.id}_lut.png`));
  const visionOut = path.join(WEB, map.vision);
  fs.mkdirSync(path.dirname(lutOut), { recursive: true });

  // --- sky cubemap
  const skyName = args.sky ?? map.sources.sky;
  const skyPath = path.join(IMAGES, `${skyName}.dds`);
  if (fs.existsSync(skyPath)) {
    const src = readCubeRGBA(skyPath);
    console.log(`sky: ${skyName} ${src.w}x${src.h} x${src.faces} faces${args.sky ? ' (stand-in)' : ''}`);
    if (src.faces === 6) {
      const faces = resampleCube(src, src.w);
      let fixed = 0;
      for (const face of faces) fixed += repairHorizonSeam(face, src.w, src.w);
      const haze = applySkyHaze(faces, src.w);
      writeCube(envDir, faces, src.w);
      console.log(`  -> ${map.env}*.png (${src.w}px, glTF axes), ${fixed} seam rows repaired`);
      console.log(`     horizon haze rgb(${haze.join(', ')})`);
    }
  } else {
    console.warn(`sky: ${map.sources.sky}.dds not found in ${IMAGES}`);
  }

  // --- reflection probe. No positions survive the dump, so probe 1 (the first
  // non-stub) stands in as a single global specular source.
  const probePath = path.join(IMAGES, '_reflection_probe1.dds');
  if (fs.existsSync(probePath)) {
    const src = readCubeRGBA(probePath);
    console.log(`probe: ${src.w}x${src.h} x${src.faces} faces`);
    if (src.faces === 6) {
      writeCube(probeDir, resampleCube(src, src.w), src.w);
      console.log(`  -> ${map.probe}*.png (${src.w}px)`);
    }
  }

  // --- colour grading LUT
  const lutPath = path.join(IMAGES, `${map.sources.lut}.dds`);
  if (fs.existsSync(lutPath)) {
    const src = readCubeRGBA(lutPath);
    const px = Buffer.alloc(src.w * src.h * 3);
    for (let i = 0; i < src.w * src.h; i++) {
      px[i * 3] = src.buf[src.offset + i * 4];
      px[i * 3 + 1] = src.buf[src.offset + i * 4 + 1];
      px[i * 3 + 2] = src.buf[src.offset + i * 4 + 2];
    }
    fs.writeFileSync(lutOut, encodePng(px, src.w, src.h));
    console.log(`lut: ${src.w}x${src.h} -> ${map.lut}`);
  }

  // --- vision set
  const visionPath = path.join(ROOT, 'export', 'vision', `${map.sources.vision}.vision`);
  if (fs.existsSync(visionPath)) {
    const vision = parseVision(fs.readFileSync(visionPath, 'utf8'));
    const grade = visionGrade(vision);
    fs.writeFileSync(visionOut, JSON.stringify({ ...grade, raw: vision }, null, 2));
    console.log(`vision: exposure ${grade.exposure}, highlight ${grade.highlight.map((v) => v.toFixed(3))}`);
  }

  fs.rmSync(TMP, { recursive: true, force: true });
}

function invokedDirectly() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
if (invokedDirectly()) run();
