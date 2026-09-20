#!/usr/bin/env node
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "icons");

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function mix(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
    a: (a.a === undefined ? 255 : a.a) + ((b.a === undefined ? 255 : b.a) - (a.a === undefined ? 255 : a.a)) * t,
  };
}

function render(size) {
  const ss = 4;
  const w = size * ss;
  const px = Buffer.alloc(size * size * 4);
  const cx = w / 2;
  const cy = w / 2;
  const radius = w * 0.46;
  const ringOuter = w * 0.31;
  const ringInner = w * 0.185;
  const slashWidth = w * 0.085;
  const top = { r: 0x3b, g: 0x82, b: 0xf6 };
  const bottom = { r: 0x0e, g: 0x74, b: 0xe0 };
  const bg = { r: 0x0b, g: 0x12, b: 0x20 };
  const white = { r: 0xf8, g: 0xfa, b: 0xfc };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px1 = x * ss + sx + 0.5;
          const py1 = y * ss + sy + 0.5;
          const dx = px1 - cx;
          const dy = py1 - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          let color = null;
          if (dist <= radius) {
            const t = (py1 - (cy - radius)) / (2 * radius);
            color = mix(bg, mix(top, bottom, t), 0.35);
            color = mix(top, bottom, t);
          }
          if (dist <= radius && dist > radius - w * 0.012) {
            color = mix(color || top, { r: 0x1e, g: 0x29, b: 0x3b }, 0.5);
          }
          const ring = dist <= ringOuter && dist >= ringInner;
          const slashDx = Math.abs((px1 - cx) * 0.7071 - (py1 - cy) * 0.7071);
          const inSlash =
            slashDx <= slashWidth &&
            Math.abs(px1 - cx) <= ringOuter &&
            Math.abs(py1 - cy) <= ringOuter;
          if (ring && !inSlash) color = white;
          if (inSlash && dist <= ringOuter + w * 0.005) color = { r: 0xef, g: 0x44, b: 0x44 };
          if (color) {
            r += color.r;
            g += color.g;
            b += color.b;
            a += 255;
          }
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      if (a === 0) {
        px[i] = 0;
        px[i + 1] = 0;
        px[i + 2] = 0;
        px[i + 3] = 0;
      } else {
        const cov = a / (n * 255);
        px[i] = Math.round(r / (a / 255));
        px[i + 1] = Math.round(g / (a / 255));
        px[i + 2] = Math.round(b / (a / 255));
        px[i + 3] = Math.round(cov * 255);
      }
    }
  }
  return encodePng(size, size, px);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const buf = render(size);
  writeFileSync(join(OUT, `icon${size}.png`), buf);
  console.log(`icons/icon${size}.png  ${buf.length} bytes`);
}
