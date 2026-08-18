// The PNG alpha reader behind Move Anchor's "around what is drawn" mode: which files it can read,
// which it refuses, and that a refusal says something true about the file.
// Usage: node scripts/test-alpha.mjs

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { loadShared } from './lib/bundle-shared.mjs';
import { check, finish } from './lib/check.mjs';

const { resolveAnchorBounds } = await loadShared('panel/src/alpha.ts', ['resolveAnchorBounds']);

const stage = mkdtempSync(join(tmpdir(), 'fxp-alpha-'));
const sequence = { width: 1280, height: 720 };

const crc = (() => {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) {
      c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
})();

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, sum]);
};

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdr = (width, height, depth, colorType, interlace = 0) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = colorType;
  header[12] = interlace;
  return chunk('IHDR', header);
};

const png = (name, parts) => {
  const path = join(stage, name);
  writeFileSync(path, Buffer.concat([SIGNATURE, ...parts, chunk('IEND', Buffer.alloc(0))]));
  return path;
};

const paeth = (a, b, c) => {
  const guess = a + b - c;
  const da = Math.abs(guess - a);
  const db = Math.abs(guess - b);
  const dc = Math.abs(guess - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
};

const encode = (row, previous, bpp, filter) => {
  const out = Buffer.alloc(row.length + 1);
  out[0] = filter;
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bpp ? row[index - bpp] : 0;
    const up = previous ? previous[index] : 0;
    const upLeft = previous && index >= bpp ? previous[index - bpp] : 0;
    const predicted =
      filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0;
    out[index + 1] = (row[index] - predicted) & 0xff;
  }
  return out;
};

const idat = (rows, bpp, filterFor = () => 0) =>
  chunk(
    'IDAT',
    deflateSync(Buffer.concat(rows.map((row, y) => encode(row, y > 0 ? rows[y - 1] : null, bpp, filterFor(y))))),
  );

// Every sample file is this canvas with this one object drawn in it, so a box that is not exactly
// the object is a defect in the reader rather than a difference between the fixtures.
const W = 40;
const H = 20;
const BOX = { left: 8, top: 2, right: 28, bottom: 12 };
const inBox = (x, y) => x >= BOX.left && x < BOX.right && y >= BOX.top && y < BOX.bottom;

const rowsOf = (bpp, write) => {
  const rows = [];
  for (let y = 0; y < H; y += 1) {
    const row = Buffer.alloc(W * bpp);
    for (let x = 0; x < W; x += 1) {
      write(row, x, y);
    }
    rows.push(row);
  }
  return rows;
};

const packedRows = (depth, indexFor) => {
  const stride = Math.ceil((W * depth) / 8);
  const mask = (1 << depth) - 1;
  const rows = [];
  for (let y = 0; y < H; y += 1) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < W; x += 1) {
      const bit = x * depth;
      row[bit >> 3] |= (indexFor(x, y) & mask) << (8 - depth - (bit & 7));
    }
    rows.push(row);
  }
  return rows;
};

const rgba8 = (alphaFor) =>
  rowsOf(4, (row, x, y) => {
    row[x * 4] = 200;
    row[x * 4 + 1] = 100;
    row[x * 4 + 2] = 50;
    row[x * 4 + 3] = alphaFor(x, y);
  });

const measure = (path, clipName = 'shot.png') => {
  const started = process.hrtime.bigint();
  const out = resolveAnchorBounds([{ key: 'k1', clipName, mediaPath: path, width: 0, height: 0 }], 'alpha', sequence);
  return {
    box: out.bounds[0],
    notes: out.notes,
    said: out.notes.join(' ; ') || '(no note)',
    ms: Number(process.hrtime.bigint() - started) / 1e6,
  };
};

const shape = (box) => (box ? `${box.from} ${box.left},${box.top} -> ${box.right},${box.bottom} of ${box.width}x${box.height}` : 'no bounds');

const isObject = (box) =>
  Boolean(box) &&
  box.from === 'alpha' &&
  box.left === BOX.left &&
  box.top === BOX.top &&
  box.right === BOX.right &&
  box.bottom === BOX.bottom &&
  box.width === W &&
  box.height === H;

console.log('Files whose alpha it can measure');
{
  const rgba = png('rgba8.png', [ihdr(W, H, 8, 6), idat(rgba8((x, y) => (inBox(x, y) ? 255 : 0)), 4)]);
  const got = measure(rgba);
  check('an 8-bit RGBA still is measured around the object, not the frame', isObject(got.box), shape(got.box));
  check('and reading it says nothing, because there is nothing to warn about', got.notes.length === 0, got.said);
  check('the box the caller gets carries the key of the clip it came from', got.box?.key === 'k1', got.box?.key);

  const deep = png('rgba16.png', [
    ihdr(W, H, 16, 6),
    idat(
      rowsOf(8, (row, x, y) => {
        row.writeUInt16BE(40000, x * 8);
        row.writeUInt16BE(20000, x * 8 + 2);
        row.writeUInt16BE(10000, x * 8 + 4);
        row.writeUInt16BE(inBox(x, y) ? 65535 : 0, x * 8 + 6);
      }),
      8,
    ),
  ]);
  const deepBox = measure(deep).box;
  check('a 16-bit RGBA still gives the same box as the 8-bit one', isObject(deepBox), shape(deepBox));

  const grey = png('grey.png', [
    ihdr(W, H, 8, 4),
    idat(
      rowsOf(2, (row, x, y) => {
        row[x * 2] = 180;
        row[x * 2 + 1] = inBox(x, y) ? 255 : 0;
      }),
      2,
    ),
  ]);
  const greyBox = measure(grey).box;
  check('so does greyscale with an alpha channel', isObject(greyBox), shape(greyBox));

  const filtered = png('filtered.png', [
    ihdr(W, H, 8, 6),
    idat(rgba8((x, y) => (inBox(x, y) ? 255 : 0)), 4, (y) => y % 5),
  ]);
  const filteredBox = measure(filtered).box;
  check('and a file that uses every scanline filter there is', isObject(filteredBox), shape(filteredBox));
}

console.log('\nA logo saved for the web, where the transparency lives in the palette');
{
  const palette = png('palette8.png', [
    ihdr(W, H, 8, 3),
    chunk('PLTE', Buffer.from([0, 0, 0, 200, 100, 50])),
    chunk('tRNS', Buffer.from([0, 255])),
    idat(packedRows(8, (x, y) => (inBox(x, y) ? 1 : 0)), 1),
  ]);
  const got = measure(palette, 'logo.png');
  check('a palette PNG is measured from its tRNS chunk like any other alpha', isObject(got.box), shape(got.box));
  check('so it is not refused for storing no alpha channel', !got.said.includes('no alpha channel'), got.said);

  const depth4 = png('palette4.png', [
    ihdr(W, H, 4, 3),
    chunk('PLTE', Buffer.from([0, 0, 0, 10, 10, 10, 20, 20, 20, 30, 30, 30, 40, 40, 40, 200, 100, 50])),
    chunk('tRNS', Buffer.from([0, 0, 0, 0, 0, 255])),
    idat(packedRows(4, (x, y) => (inBox(x, y) ? 5 : 0)), 1),
  ]);
  const depth4Box = measure(depth4, 'logo.png').box;
  check('a 16-colour palette packs two pixels to a byte and is still measured', isObject(depth4Box), shape(depth4Box));

  const depth1 = png('palette1.png', [
    ihdr(W, H, 1, 3),
    chunk('PLTE', Buffer.from([0, 0, 0, 200, 100, 50])),
    chunk('tRNS', Buffer.from([0, 255])),
    idat(packedRows(1, (x, y) => (inBox(x, y) ? 1 : 0)), 1),
  ]);
  const depth1Box = measure(depth1, 'logo.png').box;
  check('and so is a two-colour one at eight pixels to a byte', isObject(depth1Box), shape(depth1Box));

  const short = png('short-trns.png', [
    ihdr(W, H, 8, 3),
    chunk('PLTE', Buffer.from([0, 0, 0, 10, 10, 10, 20, 20, 20, 200, 100, 50])),
    // Only the first entry is listed, which is how an encoder says the rest of the palette is opaque.
    chunk('tRNS', Buffer.from([0])),
    idat(packedRows(8, (x, y) => (inBox(x, y) ? 3 : 0)), 1),
  ]);
  const shortBox = measure(short, 'logo.png').box;
  check('a tRNS shorter than the palette leaves the entries it does not reach opaque', isObject(shortBox), shape(shortBox));

  const opaque = png('palette-opaque.png', [
    ihdr(W, H, 8, 3),
    chunk('PLTE', Buffer.from([0, 0, 0, 200, 100, 50])),
    idat(packedRows(8, (x, y) => (inBox(x, y) ? 1 : 0)), 1),
  ]);
  const flat = measure(opaque, 'logo.png');
  check('a palette PNG with no tRNS at all falls back to the whole frame', flat.box?.from === 'frame', shape(flat.box));
  check('and is told it stores no transparency, which is true of it', flat.said.includes('no transparency'), flat.said);
}

console.log('\nFiles it will not read, and what it says about them');
{
  const interlaced = png('interlaced.png', [ihdr(W, H, 8, 6, 1), idat(rgba8((x, y) => (inBox(x, y) ? 255 : 0)), 4)]);
  const got = measure(interlaced, 'interlaced.png');
  check('an interlaced PNG is refused as interlaced', got.said.includes('is interlaced'), got.said);
  check('and the sequence frame is used instead of nothing', got.box?.from === 'frame' && got.box.right === sequence.width, shape(got.box));

  const full = deflateSync(Buffer.concat(rgba8((x, y) => (inBox(x, y) ? 255 : 0)).map((row) => Buffer.concat([Buffer.from([0]), row]))));
  const cut = png('cut.png', [ihdr(W, H, 8, 6), chunk('IDAT', full.subarray(0, Math.floor(full.length / 2)))]);
  const truncated = measure(cut, 'cut.png');
  check('a file that stops in the middle of its compressed data is refused', truncated.said.includes('could not be decompressed'), truncated.said);

  const jpeg = join(stage, 'really-a-jpeg.png');
  writeFileSync(jpeg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]));
  check('a JPEG someone renamed .png is refused as not a PNG', measure(jpeg, 'really-a-jpeg.png').said.includes('is not a PNG'), measure(jpeg).said);

  const greyOnly = png('grey-only.png', [ihdr(W, H, 8, 0), idat(rowsOf(1, (row, x) => { row[x] = 180; }), 1)]);
  const flatGrey = measure(greyOnly, 'grey-only.png');
  check('a greyscale PNG with no transparency of any kind says exactly that', flatGrey.said.includes('no transparency'), flatGrey.said);

  const colorKey = png('color-key.png', [
    ihdr(W, H, 8, 2),
    chunk('tRNS', Buffer.from([0, 0, 0, 0, 0, 0])),
    idat(rowsOf(3, (row, x, y) => { row[x * 3] = inBox(x, y) ? 200 : 0; }), 3),
  ]);
  const keyed = measure(colorKey, 'color-key.png');
  check('an RGB PNG that keys out one colour is not told it has no transparency', !keyed.said.includes('no transparency'), keyed.said);
  check('it is told its transparency is a colour key, so it can be re-exported', keyed.said.includes('colour key'), keyed.said);

  const empty = png('empty.png', [ihdr(W, H, 8, 6), idat(rgba8(() => 0), 4)]);
  const nothing = measure(empty, 'empty.png');
  check('a still where nothing is opaque is not measured as a zero-size box', nothing.box?.from === 'frame', shape(nothing.box));
  check('and the caller is told nothing is drawn in it', nothing.said.includes('nothing is drawn in empty.png'), nothing.said);

  const missing = measure(join(stage, 'not-here.png'), 'not-here.png');
  check('a file Premiere points at but that is not there is refused, not thrown', missing.box?.from === 'frame', missing.said);
  check('with a sentence about opening it', missing.said.includes('could not be opened'), missing.said);

  const none = measure('', 'title on the timeline');
  check('a clip with no file behind it falls back to the sequence size', none.box?.right === sequence.width, shape(none.box));
  check('and says so rather than blaming the file', none.said.includes('no file behind it'), none.said);

  const framed = resolveAnchorBounds([{ key: 'k1', clipName: 'shot.png', mediaPath: '', width: 0, height: 0 }], 'frame', sequence);
  check('asking for the whole frame reads no file and says nothing at all', framed.notes.length === 0 && framed.bounds[0].from === 'frame', framed.notes.join(' ; '));
}

console.log('\nA faint haze is not something drawn');
{
  const haze = png('haze.png', [ihdr(W, H, 8, 6), idat(rgba8((x, y) => (inBox(x, y) ? 255 : 1)), 4)]);
  const got = measure(haze, 'haze.png');
  check('an alpha of 1 over the whole canvas does not count as drawn', isObject(got.box), shape(got.box));

  const feather = png('feather.png', [ihdr(W, H, 8, 6), idat(rgba8((x, y) => (inBox(x, y) ? 255 : 7)), 4)]);
  const featherBox = measure(feather, 'feather.png').box;
  check('nor does the outer tail of a wide feathered edge', isObject(featherBox), shape(featherBox));

  const justVisible = png('just-visible.png', [ihdr(W, H, 8, 6), idat(rgba8((x, y) => (inBox(x, y) ? 8 : 0)), 4)]);
  const justVisibleBox = measure(justVisible, 'just-visible.png').box;
  check('an object drawn at the threshold itself is measured, not dropped', isObject(justVisibleBox), shape(justVisibleBox));

  const deepHaze = png('haze16.png', [
    ihdr(W, H, 16, 6),
    idat(
      rowsOf(8, (row, x, y) => {
        row.writeUInt16BE(inBox(x, y) ? 65535 : 0x07ff, x * 8 + 6);
      }),
      8,
    ),
  ]);
  const deepHazeBox = measure(deepHaze, 'haze16.png').box;
  check('a 16-bit haze is judged by the same fraction as an 8-bit one', isObject(deepHazeBox), shape(deepHazeBox));

  const covered = png('covered.png', [ihdr(W, H, 8, 6), idat(rgba8(() => 40), 4)]);
  const whole = measure(covered, 'covered.png');
  check('an alpha that reaches every edge is still measured from the alpha', whole.box?.from === 'alpha', shape(whole.box));
  check('and its box really is the whole canvas', whole.box?.left === 0 && whole.box.top === 0 && whole.box.right === W && whole.box.bottom === H, shape(whole.box));
  check('but the caller is warned, because that is usually haze', whole.said.includes('every edge'), whole.said);
  const tight = measure(png('tight.png', [ihdr(W, H, 8, 6), idat(rgba8((x, y) => (inBox(x, y) ? 255 : 0)), 4)]), 'tight.png');
  check('a still whose object stops short of the edges gets no such warning', tight.notes.length === 0, tight.said);
}

console.log('\nA still too large to read on the panel thread');
{
  // The ceiling is read straight off the header, so a file that only declares its size exercises
  // the same path as a real one without spending a second building it.
  const declared = (name, width, height) =>
    png(name, [ihdr(width, height, 8, 6), chunk('IDAT', deflateSync(Buffer.alloc(64)))]);

  const huge = measure(declared('six-k.png', 6000, 6000), 'six-k.png');
  check('a 6000x6000 still is refused rather than freezing the panel', huge.said.includes('6000x6000'), huge.said);
  check('and the refusal is about its size, not about its pixels running out', !huge.said.includes('middle of its pixels'), huge.said);
  check('the whole frame is used in its place, as with any other refusal', huge.box?.from === 'frame', shape(huge.box));
  check('and the answer comes back before anything that big is allocated', huge.ms < 100, `${huge.ms.toFixed(0)}ms`);

  const liar = measure(declared('liar.png', 20000, 20000), 'liar.png');
  check('a header claiming 20000x20000 is refused for its size', liar.said.includes('20000x20000'), liar.said);
  check('rather than being read until it runs out of pixels', !liar.said.includes('middle of its pixels'), liar.said);

  const over = measure(declared('over.png', 4000, 3001), 'over.png');
  check('one pixel over the ceiling is over the ceiling', over.said.includes('4000x3001'), over.said);

  const at = measure(declared('at.png', 4000, 3000), 'at.png');
  check('a still exactly at the ceiling is read rather than refused for its size', at.said.includes('middle of its pixels'), at.said);

  const rows = [];
  for (let y = 0; y < 1200; y += 1) {
    const row = Buffer.alloc(1600 * 4);
    if (y >= 100 && y < 200) {
      row.fill(255, 400 * 4, 600 * 4);
    }
    rows.push(Buffer.concat([Buffer.from([0]), row]));
  }
  const real = png('real-hd.png', [ihdr(1600, 1200, 8, 6), chunk('IDAT', deflateSync(Buffer.concat(rows)))]);
  const measured = measure(real, 'real-hd.png');
  check('a still an editor would really anchor is read normally', measured.box?.from === 'alpha' && measured.box.top === 100 && measured.box.bottom === 200, shape(measured.box));
  check('with no warning about its size', measured.notes.length === 0, measured.said);
}

rmSync(stage, { recursive: true, force: true });
finish('alpha');
