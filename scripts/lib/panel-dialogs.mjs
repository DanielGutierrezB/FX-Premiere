// The two dialogs 1.6.0 adds: the ease amount, and which corner the anchor goes to. Driven through
// the booted panel the caller hands over, because what is worth checking is the keyboard reaching
// the host, not the classes each one renders.

import { crc32, deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { check } from './check.mjs';
import { settle } from './mock-cep.mjs';
import { TICKS_PER_SECOND, keyframed, makeProjectItem } from './mock-premiere.mjs';

const paeth = (left, up, upLeft) => {
  const guess = left + up - upLeft;
  const dLeft = Math.abs(guess - left);
  const dUp = Math.abs(guess - up);
  const dUpLeft = Math.abs(guess - upLeft);
  if (dLeft <= dUp && dLeft <= dUpLeft) {
    return left;
  }
  return dUp <= dUpLeft ? up : upLeft;
};

const filterRow = (type, row, previous, bpp) => {
  const out = Buffer.alloc(row.length);
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bpp ? row[index - bpp] : 0;
    const up = previous ? previous[index] : 0;
    const upLeft = index >= bpp && previous ? previous[index - bpp] : 0;
    let predictor = 0;
    if (type === 1) {
      predictor = left;
    } else if (type === 2) {
      predictor = up;
    } else if (type === 3) {
      predictor = (left + up) >> 1;
    } else if (type === 4) {
      predictor = paeth(left, up, upLeft);
    }
    out[index] = (row[index] - predictor) & 0xff;
  }
  return out;
};

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  // A real checksum, so the fixture is a PNG any reader would take rather than only ours.
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/**
 * An RGBA PNG with one opaque rectangle in it, written with a different scanline filter on every
 * row: the box only comes out right if all five of them are undone correctly.
 */
const writeAlphaFixture = (path, { width, height, box }) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const bpp = 4;
  const rows = [];
  let previous = null;
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(width * bpp);
    for (let x = 0; x < width; x += 1) {
      const inside = x >= box.left && x < box.right && y >= box.top && y < box.bottom;
      row[x * bpp] = inside ? 200 : 30;
      row[x * bpp + 1] = inside ? 100 : 30;
      row[x * bpp + 2] = inside ? 50 : 30;
      row[x * bpp + 3] = inside ? 255 : 0;
    }
    const type = y % 5;
    rows.push(Buffer.concat([Buffer.from([type]), filterRow(type, row, previous, bpp)]));
    previous = row;
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return path;
};

export const easeAndAnchorDialogs = async ({ window, world, cep, cepCalls, stage, type, press, savedSettings, toastText }) => {
  const rowNames = () => [...window.document.querySelectorAll('.row__name')].map((node) => node.textContent ?? '');
  const digit = async (number) => press(String(number), { code: `Digit${number}` });
  const chipNamed = (label) => [...window.document.querySelectorAll('.chip')].find((node) => node.textContent === label);
  const click = (node) => {
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    return settle(4);
  };
  const paramOf = (clip, matchName, displayName) =>
    clip.componentList
      .find((component) => component.matchName === matchName)
      ?.paramList.find((param) => param.displayName === displayName);
  const summon = async () => {
    cep.emit('com.fxpremiere.event.trigger', { settings: false });
    await settle(20);
  };

  world.select('A.mp4', 'B.mp4', 'A.wav');
  await summon();

  console.log('\nThe ease dialog');
  for (const query of ['ease', 'suavizar', 'curvas', 'easyfy', 'interpolar']) {
    await type(query);
    const at = rowNames().indexOf('Ease Keyframes');
    check(`"${query}" finds the ease command`, at >= 0 && at < 5, `position ${at} of ${rowNames().length}`);
  }

  const influences = () => [...window.document.querySelectorAll('.influence__value')].map((node) => node.value);
  const activeField = () =>
    window.document.querySelector('.influence--active .influence__label')?.textContent ?? '';

  await type('ease');
  await press('Enter');
  check('the command opens a dialog rather than running straight away', Boolean(window.document.querySelector('.ease')));
  check('it opens on the factory pair', influences().join('/') === '33/100', influences().join('/'));
  check('with the outgoing influence under the keyboard', activeField() === 'Out', activeField());
  await press('ArrowUp');
  check('ArrowUp adds one', influences()[0] === '34', influences()[0]);
  await press('ArrowUp', { shiftKey: true });
  check('Shift+ArrowUp jumps ten', influences()[0] === '44', influences()[0]);
  await press('ArrowDown');
  check('ArrowDown takes one off', influences()[0] === '43', influences()[0]);
  await press('Tab');
  check('Tab moves to the incoming influence', activeField() === 'In', activeField());
  await press('ArrowDown', { shiftKey: true });
  check('and the arrows drive that one instead', influences()[1] === '90', influences()[1]);
  await press('ArrowRight');
  check('the arrows walk between the fields too', activeField() === 'Out', activeField());
  for (let press45 = 0; press45 < 6; press45 += 1) {
    await press('ArrowDown', { shiftKey: true });
  }
  check('an influence cannot go below nothing', influences()[0] === '0', influences()[0]);

  await click(chipNamed('Save as default'));
  check('saving makes the pair on screen the default', savedSettings().ease.saved.easeOut === 0 && savedSettings().ease.saved.easeIn === 90, JSON.stringify(savedSettings().ease));
  check('and remembers the default it replaced', savedSettings().ease.previous.easeOut === 33 && savedSettings().ease.previous.easeIn === 100, JSON.stringify(savedSettings().ease.previous));
  await click(chipNamed('Restore previous'));
  check('restoring puts the older default back on screen', influences().join('/') === '33/100', influences().join('/'));
  check('on disk as well', savedSettings().ease.saved.easeOut === 33, JSON.stringify(savedSettings().ease));
  check('and keeps the one it just replaced, so the button works both ways', savedSettings().ease.previous.easeIn === 90, JSON.stringify(savedSettings().ease.previous));

  const scale = paramOf(world.clips.clipB, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [0, 100],
    [0.2, 160],
  ]);
  // The ease is drawn between the two keyframes the playhead sits between, so it has to be parked
  // inside the pair. Put back afterwards, because where the playhead is is also where a paste lands.
  const playheadWas = world.sequence.getPlayerPosition().ticks;
  world.sequence.setPlayerPosition(String((world.clips.clipB.start.seconds + 0.1) * TICKS_PER_SECOND));
  await press('ArrowUp');
  await press('Enter');
  await settle(20);
  check('Enter eases every keyframed property of the selection', scale.keys.length === 7, JSON.stringify(scale.keys.map((key) => key.at)));
  check('the amount on screen is the one that reached the host', /34 out \/ 100 in/.test(toastText()), toastText());
  check('and it is remembered for the next time the dialog opens', savedSettings().ease.current.easeOut === 34, JSON.stringify(savedSettings().ease.current));
  check('the palette leaves the dialog once it has run', !window.document.querySelector('.ease'));
  world.sequence.setPlayerPosition(playheadWas);

  await summon();
  await type('ease');
  await press('Enter');
  check('which is what it opens on', influences().join('/') === '34/100', influences().join('/'));
  const closesBeforeEaseEscape = cepCalls.closeExtension;
  await press('Escape');
  check('Escape leaves the dialog', !window.document.querySelector('.ease'));
  check('and does not close the palette', cepCalls.closeExtension === closesBeforeEaseEscape, String(cepCalls.closeExtension));

  console.log('\nThe anchor dialog');
  for (const query of ['anchor', 'ancla', 'pivote', 'punto de anclaje']) {
    await type(query);
    const at = rowNames().indexOf('Move Anchor Point');
    check(`"${query}" finds the anchor command`, at >= 0 && at < 5, `position ${at} of ${rowNames().length}`);
  }

  // A 40x20 source with the drawing in it off centre, so the two modes cannot agree by accident.
  const alphaBox = { left: 8, top: 2, right: 28, bottom: 12 };
  const png = writeAlphaFixture(join(stage, 'logo.png'), { width: 40, height: 20, box: alphaBox });
  world.select('A.mp4');
  world.clips.clipA.projectItem = makeProjectItem({ name: 'logo.png', mediaPath: png, width: 40, height: 20 });
  const anchor = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Anchor Point');
  const position = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position');
  // Back to a clip nothing has been done to: the scale a earlier test left on it would halve every
  // correction and hide whether the offset itself was right.
  const reset = () => {
    anchor.current = [20, 10];
    position.current = [0.5, 0.5];
    paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale').current = 100;
    paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale Width').current = 100;
    paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Rotation').current = 0;
  };
  await summon();

  const cells = () => [...window.document.querySelectorAll('.grid__cell')];
  const lit = () => cells().findIndex((cell) => cell.className.includes('grid__cell--on'));
  await type('anchor');
  await press('Enter');
  check('the command opens the grid', cells().length === 9, String(cells().length));
  check('a fresh profile starts in the middle', lit() === 4, String(lit()));
  await digit(1);
  check('the digits reach the corners', lit() === 0, String(lit()));
  await press('ArrowRight');
  check('the arrows walk across the grid', lit() === 1, String(lit()));
  await press('ArrowDown');
  check('and down it', lit() === 4, String(lit()));
  await press('ArrowUp');
  await press('ArrowUp');
  check('the top row is the top: it does not wrap round to the bottom', lit() === 1, String(lit()));
  await digit(9);
  check('nine is the far corner', lit() === 8, String(lit()));

  const segNamed = (label) => [...window.document.querySelectorAll('.seg__item')].find((node) => node.textContent === label);
  check('the dialog offers Motion or the Transform effect', Boolean(segNamed('Motion')) && Boolean(segNamed('Transform')), '');
  check('and the frame or what is drawn inside it', Boolean(segNamed('Frame')) && Boolean(segNamed('Alpha')), '');

  // The sheet is one screenful: the grid and the two switches share a row, and the window it asks
  // for is short enough that nothing needs scrolling to be read.
  const body = window.document.querySelector('.anchor__body');
  check('the grid and the switches sit in one row', Boolean(body?.querySelector('.grid')) && Boolean(body?.querySelector('.anchor__side .seg')), body?.className ?? 'no body');
  check('with no section headings between them', window.document.querySelectorAll('.anchor .section-title').length === 0, String(window.document.querySelectorAll('.anchor .section-title').length));
  check(
    'and the window it asks for is short',
    (cepCalls.resizes.at(-1)?.[1] ?? 0) <= 240,
    JSON.stringify(cepCalls.resizes.at(-1)),
  );

  reset();
  await digit(1);
  await press('Enter');
  await settle(20);
  check(
    'in Frame mode the corner is the corner of the whole source',
    JSON.stringify(anchor.current) === JSON.stringify([0, 0]),
    JSON.stringify(anchor.current),
  );
  check(
    'and the position is corrected so the picture does not move',
    Math.abs(position.current[0] - (0.5 - 20 / 1280)) < 1e-9,
    JSON.stringify(position.current),
  );

  await summon();
  await type('anchor');
  await press('Enter');
  check('the dialog reopens on the corner used last time', lit() === 0, String(lit()));
  await click(segNamed('Alpha'));
  reset();
  await press('Enter');
  await settle(30);
  check(
    'in Alpha mode the corner sits on the drawing inside the frame',
    JSON.stringify(anchor.current) === JSON.stringify([alphaBox.left, alphaBox.top]),
    JSON.stringify(anchor.current),
  );
  check(
    'which is a shorter correction than the frame would have needed',
    Math.abs(position.current[0] - (0.5 + (alphaBox.left - 20) / 1280)) < 1e-9,
    JSON.stringify(position.current),
  );
  check('and the choice of mode is remembered', savedSettings().anchor.bounds === 'alpha', JSON.stringify(savedSettings().anchor));

  // There is no way to read the alpha of a video from CEP, so the honest answer is the whole frame
  // and a sentence saying that is what happened.
  const mov = join(stage, 'take.mov');
  writeFileSync(mov, Buffer.from('not a picture we can take apart'));
  world.clips.clipA.projectItem = makeProjectItem({ name: 'take.mov', mediaPath: mov, width: 40, height: 20 });
  await summon();
  await type('anchor');
  await press('Enter');
  reset();
  await press('Enter');
  await settle(30);
  check(
    'a source whose alpha cannot be read falls back to the frame',
    JSON.stringify(anchor.current) === JSON.stringify([0, 0]),
    JSON.stringify(anchor.current),
  );
  check('and says so rather than pretending it measured something', /not a PNG/.test(toastText()), toastText());

  await summon();
  await type('anchor');
  await press('Enter');
  const closesBeforeAnchorEscape = cepCalls.closeExtension;
  await press('Escape');
  check('Escape leaves the grid', !window.document.querySelector('.anchor'));
  check('without closing the palette', cepCalls.closeExtension === closesBeforeAnchorEscape, String(cepCalls.closeExtension));

  world.select('A.mp4', 'B.mp4', 'A.wav');
  await settle(10);
};
