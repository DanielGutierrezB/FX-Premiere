import { nodeRequire } from '@shared/node';
import type { AnchorBounds, AnchorBoundsMode, AnchorSource, SequenceInfo } from '@shared/types';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A CEP page has no global `Buffer`; it lives in the Node side of the bridge like `fs` does. */
const buffers = (): typeof Buffer => (nodeRequire()('buffer') as { Buffer: typeof Buffer }).Buffer;

/** Channels per pixel for the two PNG colour types that carry an alpha channel of their own. */
const CHANNELS: Record<number, number> = { 4: 2, 6: 4 };

/** Colour type 3: the pixels are indices into a palette, and `tRNS` gives each entry its alpha. */
const PALETTE = 3;

/**
 * How much alpha a pixel needs before it counts as drawn: 8 of 255, about 3%. Under that sit the
 * noise of an exported matte and the invisible tail of a feathered edge, and counting those in
 * hands back a box the size of the whole frame. A 16-bit alpha is read by its high byte, which
 * puts its threshold at the same fraction.
 */
const VISIBLE = 8;

/**
 * The most pixels worth inflating on the panel's only thread, which is the thread the editor is
 * waiting on. A 4K frame is 8.3 megapixels, so this clears the largest still anyone normally
 * anchors with room over it; past this the unfiltered raster alone runs into hundreds of megabytes
 * and the panel stops answering for long enough to feel broken.
 */
const MAX_PIXELS = 12_000_000;

/** The tight box around everything drawn, in source pixels, with the right and bottom exclusive. */
interface AlphaBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface AlphaScan {
  width: number;
  height: number;
  /** Null when nothing in the image is opaque, which is not something to move an anchor onto. */
  box: AlphaBox | null;
}

interface Unreadable {
  reason: string;
}

type ScanResult = AlphaScan | Unreadable;

const failed = <T extends object>(result: T | Unreadable): result is Unreadable => 'reason' in result;

/** The alpha of one pixel, as 0-255, whatever shape the file keeps it in. */
type AlphaRow = (x: number, y: number) => number;

/** Where a colour type keeps its alpha: next to the colour, or in the table a palette indexes. */
type Layout = { kind: 'direct'; channels: number } | { kind: 'palette'; opacity: Buffer };

/**
 * Keyed by path and modification stamp: the alpha of a still does not change while Premiere holds
 * it, and inflating a 4K PNG is far too slow to do again for every clip of a selection.
 */
const cache = new Map<string, ScanResult>();

/**
 * Walks the chunk list for the header and the pixel data. Everything else in the file is skipped,
 * which is what makes this a reader rather than a PNG library: colour, gamma and text chunks cannot
 * change which pixels are transparent.
 */
interface Chunks {
  header: Buffer | null;
  palette: Buffer | null;
  /** `tRNS`, which is an alpha per palette entry on colour type 3 and a keyed-out colour otherwise. */
  transparency: Buffer | null;
  data: Buffer[];
}

const readChunks = (buffer: Buffer): Chunks => {
  let offset = 8;
  const chunks: Chunks = { header: null, palette: null, transparency: null, data: [] };
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const from = offset + 8;
    if (from + length > buffer.length) {
      break;
    }
    if (type === 'IHDR') {
      chunks.header = buffer.subarray(from, from + length);
    } else if (type === 'PLTE') {
      chunks.palette = buffer.subarray(from, from + length);
    } else if (type === 'tRNS') {
      chunks.transparency = buffer.subarray(from, from + length);
    } else if (type === 'IDAT') {
      chunks.data.push(buffer.subarray(from, from + length));
    } else if (type === 'IEND') {
      break;
    }
    // Four more for the chunk's CRC, which is not checked: a corrupt file fails at the inflate.
    offset = from + length + 4;
  }
  return chunks;
};

/**
 * Undoes the per-scanline filter PNG applies before compressing. Each line names its own filter and
 * predicts from the pixel to its left and the line above, so the lines have to be walked in order.
 */
const unfilter = (raw: Buffer, height: number, stride: number, bpp: number): Buffer | null => {
  const out = buffers().alloc(height * stride);
  let read = 0;
  for (let line = 0; line < height; line += 1) {
    if (read + 1 + stride > raw.length) {
      return null;
    }
    const filter = raw[read];
    read += 1;
    const at = line * stride;
    const above = at - stride;
    for (let index = 0; index < stride; index += 1) {
      const value = raw[read + index];
      const left = index >= bpp ? out[at + index - bpp] : 0;
      const up = line > 0 ? out[above + index] : 0;
      const upLeft = line > 0 && index >= bpp ? out[above + index - bpp] : 0;
      let restored = value;
      if (filter === 1) {
        restored = value + left;
      } else if (filter === 2) {
        restored = value + up;
      } else if (filter === 3) {
        restored = value + ((left + up) >> 1);
      } else if (filter === 4) {
        const guess = left + up - upLeft;
        const dLeft = Math.abs(guess - left);
        const dUp = Math.abs(guess - up);
        const dUpLeft = Math.abs(guess - upLeft);
        restored = value + (dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft);
      } else if (filter !== 0) {
        return null;
      }
      out[at + index] = restored & 0xff;
    }
    read += stride;
  }
  return out;
};

/**
 * Big-endian samples, so the first byte of a 16-bit alpha is the one worth looking at, and a palette
 * entry the `tRNS` chunk does not reach is opaque: that is how an encoder lists only what it must.
 */
const alphaReader = (pixels: Buffer, stride: number, bitDepth: number, layout: Layout): AlphaRow => {
  if (layout.kind === 'direct') {
    const sample = bitDepth / 8;
    const bpp = layout.channels * sample;
    const alphaAt = (layout.channels - 1) * sample;
    return (x, y) => pixels[y * stride + alphaAt + x * bpp];
  }
  const opacity = layout.opacity;
  const mask = (1 << bitDepth) - 1;
  return (x, y) => {
    const bit = x * bitDepth;
    const index = (pixels[y * stride + (bit >> 3)] >> (8 - bitDepth - (bit & 7))) & mask;
    return index < opacity.length ? opacity[index] : 255;
  };
};

const boxOf = (width: number, height: number, alphaAt: AlphaRow): AlphaBox | null => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alphaAt(x, y) < VISIBLE) {
        continue;
      }
      if (x < left) {
        left = x;
      }
      if (x > right) {
        right = x;
      }
      if (y < top) {
        top = y;
      }
      bottom = y;
    }
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
};

/**
 * Which of the three ways a PNG can carry transparency this file uses, or the sentence to refuse it
 * with. The two that are not an alpha channel are named for what they are, because an editor told
 * the file has none goes looking for a bug in an export that did exactly what they asked.
 */
const layoutOf = (colorType: number, chunks: Chunks, label: string): Layout | Unreadable => {
  const channels = CHANNELS[colorType];
  if (channels) {
    return { kind: 'direct', channels };
  }
  if (colorType === PALETTE) {
    if (!chunks.palette) {
      return { reason: `${label} has no palette to read its transparency from` };
    }
    if (!chunks.transparency) {
      return { reason: `${label} stores no transparency` };
    }
    return { kind: 'palette', opacity: chunks.transparency };
  }
  if (chunks.transparency) {
    return { reason: `${label} carries its transparency as a colour key rather than an alpha channel` };
  }
  return { reason: `${label} stores no transparency` };
};

/** Bit depths each layout can be read at: a palette packs several pixels into a byte, alpha cannot. */
const depthFits = (layout: Layout, bitDepth: number): boolean =>
  layout.kind === 'palette' ? [1, 2, 4, 8].includes(bitDepth) : bitDepth === 8 || bitDepth === 16;

const scanPng = (buffer: Buffer, label: string): ScanResult => {
  if (buffer.length < 8 || SIGNATURE.some((byte, index) => buffer[index] !== byte)) {
    return { reason: `${label} is not a PNG` };
  }
  const chunks = readChunks(buffer);
  const header = chunks.header;
  if (!header || header.length < 13 || chunks.data.length === 0) {
    return { reason: `${label} has no readable PNG header` };
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const interlace = header[12];
  const layout = layoutOf(header[9], chunks, label);
  if (failed(layout)) {
    return layout;
  }
  if (!depthFits(layout, bitDepth)) {
    return { reason: `${label} is ${bitDepth}-bit, which we do not unpack` };
  }
  if (interlace !== 0) {
    return { reason: `${label} is interlaced` };
  }
  if (width <= 0 || height <= 0) {
    return { reason: `${label} reports no size` };
  }
  // Read off the header, before the inflate: the point is not to allocate the raster at all.
  if (width * height > MAX_PIXELS) {
    return { reason: `${label} is ${width}x${height}, too large to read without freezing the panel` };
  }
  let raw: Buffer;
  try {
    const zlib = nodeRequire()('zlib') as typeof import('zlib');
    raw = zlib.inflateSync(buffers().concat(chunks.data));
  } catch {
    return { reason: `${label} could not be decompressed` };
  }
  const bits = bitDepth * (layout.kind === 'palette' ? 1 : layout.channels);
  const stride = Math.ceil((width * bits) / 8);
  const pixels = unfilter(raw, height, stride, Math.max(1, bits >> 3));
  if (!pixels) {
    return { reason: `${label} ended in the middle of its pixels` };
  }
  return { width, height, box: boxOf(width, height, alphaReader(pixels, stride, bitDepth, layout)) };
};

const scanFile = (path: string): ScanResult => {
  const label = path === '' ? 'this clip' : `"${path.split(/[/\\]/).pop() ?? path}"`;
  if (path === '') {
    return { reason: 'this clip has no file behind it' };
  }
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const stat = fs.statSync(path);
    const key = `${path}@${stat.mtimeMs}:${stat.size}`;
    const known = cache.get(key);
    if (known) {
      return known;
    }
    const result = scanPng(fs.readFileSync(path), label);
    cache.set(key, result);
    return result;
  } catch {
    return { reason: `${label} could not be opened` };
  }
};

/**
 * Where the object is inside each selected clip. The alpha channel is the panel's half of the anchor
 * job because reading one needs Node, which the host does not have; the host says what each clip is
 * made of and this answers in source pixels. Anything that is not a PNG cannot be read at all from
 * CEP, so it falls back to the whole frame and the caller is given the sentence that says so.
 */
export const resolveAnchorBounds = (
  sources: AnchorSource[],
  mode: AnchorBoundsMode,
  sequence: SequenceInfo | null,
): { bounds: AnchorBounds[]; notes: string[] } => {
  const bounds: AnchorBounds[] = [];
  const notes: string[] = [];
  const note = (text: string): void => {
    if (!notes.includes(text)) {
      notes.push(text);
    }
  };
  for (const source of sources) {
    const scan = mode === 'alpha' ? scanFile(source.mediaPath) : null;
    if (scan && !failed(scan) && scan.box) {
      bounds.push({ key: source.key, ...scan.box, width: scan.width, height: scan.height, from: 'alpha' });
      // A box the size of the canvas is what a haze over the whole still measures as, and it is
      // indistinguishable from an object that really does bleed off every side.
      const whole =
        scan.box.left === 0 && scan.box.top === 0 && scan.box.right === scan.width && scan.box.bottom === scan.height;
      if (whole) {
        note(`what is drawn in ${source.clipName} reaches every edge, so its box is the whole still`);
      }
      continue;
    }
    if (scan) {
      note(failed(scan) ? `${scan.reason}, so the whole frame was used` : `nothing is drawn in ${source.clipName}`);
    }
    const width = (!scan || failed(scan) ? 0 : scan.width) || source.width || sequence?.width || 0;
    const height = (!scan || failed(scan) ? 0 : scan.height) || source.height || sequence?.height || 0;
    if (width <= 0 || height <= 0) {
      note(`Premiere would not say how big ${source.clipName} is, so it was left alone`);
      continue;
    }
    bounds.push({
      key: source.key,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      from: 'frame',
    });
  }
  return { bounds, notes };
};
