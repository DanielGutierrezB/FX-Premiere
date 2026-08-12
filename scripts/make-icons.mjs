import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'icons');
const SIZE = 23;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};

const encodePng = (pixels) => {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  let offset = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < SIZE; x += 1) {
      const index = (y * SIZE + x) * 4;
      raw[offset] = pixels[index];
      raw[offset + 1] = pixels[index + 1];
      raw[offset + 2] = pixels[index + 2];
      raw[offset + 3] = pixels[index + 3];
      offset += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const coverage = (distance, halfWidth) => {
  const value = halfWidth - Math.abs(distance);
  if (value >= 0.5) {
    return 1;
  }
  if (value <= -0.5) {
    return 0;
  }
  return value + 0.5;
};

/** A magnifier glyph: ring plus handle, drawn analytically so it stays crisp at 23px. */
const drawIcon = (rgb) => {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const cx = 9.5;
  const cy = 9.5;
  const radius = 6.4;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const ring = coverage(Math.hypot(px - cx, py - cy) - radius, 1.1);

      let handle = 0;
      const hx = px - 14.2;
      const hy = py - 14.2;
      const along = (hx + hy) / Math.SQRT2;
      const across = (hx - hy) / Math.SQRT2;
      if (along >= -0.6 && along <= 7.2) {
        handle = coverage(across, 1.1);
      }

      const alpha = Math.min(1, Math.max(ring, handle));
      if (alpha <= 0) {
        continue;
      }
      const index = (y * SIZE + x) * 4;
      pixels[index] = rgb[0];
      pixels[index + 1] = rgb[1];
      pixels[index + 2] = rgb[2];
      pixels[index + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon-light.png'), encodePng(drawIcon([248, 248, 250])));
writeFileSync(join(outDir, 'icon-dark.png'), encodePng(drawIcon([58, 58, 64])));
console.log(`icons written to ${outDir}`);
