// Compass: the wildcard engine both new features share, how a template becomes a folder on disk,
// which settings win for a given project, and the two things only Premiere can answer — whether the
// undocumented export-path preferences round-trip, and whether Media Encoder takes the fallback.
// Usage: node scripts/test-compass.mjs

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadShared } from './lib/bundle-shared.mjs';
import { check, finish } from './lib/check.mjs';
import { createHost } from './lib/mock-premiere.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');

if (!existsSync(hostScript)) {
  console.error('dist/host/fxpremiere.jsx missing. Run: npm run build');
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), 'fxp-compass-'));

const wild = await loadShared('shared/wildcards.ts', [
  'WILDCARDS',
  'expandWildcards',
  'insertWildcard',
  'isAbsolutePath',
  'parentFolder',
  'resolveExportPath',
  'safeFileName',
  'safeSegment',
  'separatorFor',
]);
const compass = await loadShared('shared/compass.ts', [
  'EXPORT_FRAME_KEY',
  'EXPORT_MEDIA_KEY',
  'activePaths',
  'compassFrom',
  'compassKey',
  'defaultCompass',
  'defaultPaste',
  'ensureFolder',
  'pasteFrom',
  'planCompass',
]);

/** The moment Compass's own documentation works its example at: 15:30 on 20 May 2022. */
const DOC_MOMENT = new Date(2022, 4, 20, 15, 30, 0);

const context = {
  production: '',
  project: 'Vikings',
  sequence: 'DrakeShip',
  bin: 'Episodios',
  at: DOC_MOMENT,
};

console.log("Compass's own worked example");
{
  // The documentation's table spells the project wildcard #PRJ and its example writes #PROJ, so
  // both have to reach the same place or the example it ships cannot be typed in.
  const template = '/Users/Dropbox/EXPORT/#YYYY#MM#DD/#PROJ/#SEQ_#hh#mm';
  const resolved = wild.resolveExportPath({
    template,
    relative: false,
    projectFile: '/Users/Dropbox/Vikings.prproj',
    productionFolder: '',
    context,
    sep: '/',
  });
  check(
    'the documented example resolves to the documented path',
    resolved.path === '/Users/Dropbox/EXPORT/20220520/Vikings/DrakeShip_1530/',
    resolved.path,
  );
  check('with the trailing separator Premiere requires', resolved.path.endsWith('/'), resolved.path);
  check('and nothing reported missing', resolved.missing.length === 0, JSON.stringify(resolved.missing));
  check(
    '#PRJ is the same wildcard as #PROJ',
    wild.expandWildcards('#PRJ', context).text === wild.expandWildcards('#PROJ', context).text,
  );
}

console.log('\nEvery wildcard');
{
  const inProduction = { ...context, production: 'Season One' };
  const expected = [
    ['#PROD', 'Season One'],
    ['#PRJ', 'Vikings'],
    ['#SEQ', 'DrakeShip'],
    ['#BIN', 'Episodios'],
    ['#YYYY', '2022'],
    ['#YY', '22'],
    ['#MM', '05'],
    ['#DD', '20'],
    ['#hh', '15'],
    ['#mm', '30'],
  ];
  for (const [token, value] of expected) {
    check(`${token} is ${value}`, wild.expandWildcards(token, inProduction).text === value, wild.expandWildcards(token, inProduction).text);
  }
  check(
    'the panel offers exactly those ten',
    wild.WILDCARDS.map((entry) => entry.token).join(' ') === expected.map(([token]) => token).join(' '),
    wild.WILDCARDS.map((entry) => entry.token).join(' '),
  );
  check('#MM and #mm are told apart by case', wild.expandWildcards('#MM-#mm', inProduction).text === '05-30');
  check(
    '#YYYY is not read as #YY followed by two stray characters',
    wild.expandWildcards('#YYYY', inProduction).text === '2022',
  );
}

console.log('\nA wildcard with nothing behind it');
{
  const nameless = wild.expandWildcards('#PROD/#SEQ', { ...context, production: '', sequence: '' });
  check('expands to nothing rather than to its own name', nameless.text === '/', nameless.text);
  check('and is reported, both of them', nameless.missing.join(',') === '#PROD,#SEQ', nameless.missing.join(','));
  const resolved = wild.resolveExportPath({
    template: 'EXPORT/#PROD/#SEQ',
    relative: true,
    projectFile: '/Users/me/Vikings.prproj',
    productionFolder: '',
    context: { ...context, production: '' },
    sep: '/',
  });
  // Collapsing it would export into /Users/me/EXPORT/DrakeShip, which is a real folder one level up
  // from the one that was asked for, and nothing on screen would say the export had moved.
  check('a path with a folder that has no name is refused rather than collapsed', resolved.path === '', resolved.path);
  check('and the missing wildcard travels with it', resolved.missing.join(',') === '#PROD', resolved.missing.join(','));
  check('with an error that names it', resolved.error.includes('#PROD'), resolved.error);
  const named = wild.resolveExportPath({
    template: 'EXPORT/#PROD/#SEQ',
    relative: true,
    projectFile: '/Users/me/Vikings.prproj',
    productionFolder: '',
    context: { ...context, production: 'Season One' },
    sep: '/',
  });
  check('and resolves the moment the wildcard has something behind it', named.path === '/Users/me/EXPORT/Season One/DrakeShip/', named.path);
  check('with no error left over', named.error === '', named.error);
}

console.log('\nA wildcard value is a name, never a path');
// An editor names a sequence "01/02 - rough" and a bin ".." without meaning anything by it. The
// template is the only place structure comes from; a value that added its own would export
// somewhere else entirely, and the panel's preview would agree with it.
{
  const escaping = {
    template: 'EXPORT/#SEQ',
    relative: true,
    projectFile: '/Users/me/Projects/Vikings.prproj',
    productionFolder: '',
    sep: '/',
  };
  const traversal = wild.resolveExportPath({ ...escaping, context: { ...context, sequence: '../../Desktop' } });
  check(
    'a sequence named for a path upwards cannot climb out of the chosen root',
    traversal.path === '/Users/me/Projects/EXPORT/Desktop/',
    traversal.path,
  );
  const nested = wild.resolveExportPath({ ...escaping, context: { ...context, sequence: 'S01/E02' } });
  check('a slash in the name makes one folder, not two', nested.path === '/Users/me/Projects/EXPORT/S01-E02/', nested.path);
  const windows = wild.resolveExportPath({ ...escaping, context: { ...context, sequence: 'S01\\E02' } });
  check('and neither does a backslash', windows.path === '/Users/me/Projects/EXPORT/S01-E02/', windows.path);
  const absolute = wild.resolveExportPath({ ...escaping, context: { ...context, sequence: '/Volumes/Other' } });
  check('a name that reads as an absolute path stays inside the root', absolute.path === '/Users/me/Projects/EXPORT/Volumes-Other/', absolute.path);
  const drive = wild.resolveExportPath({
    ...escaping,
    projectFile: 'C:\\Work\\Vikings.prproj',
    sep: '\\',
    context: { ...context, sequence: 'D:\\Elsewhere' },
    template: 'EXPORT\\#SEQ',
  });
  check('nor does one carrying another drive letter', drive.path === 'C:\\Work\\EXPORT\\D-Elsewhere\\', drive.path);
  const dots = wild.resolveExportPath({ ...escaping, context: { ...context, sequence: '..' } });
  check('a name that is nothing but dots is a missing wildcard, not a step upwards', dots.path === '' && dots.missing.join(',') === '#SEQ', dots.path);
  const ordinary = wild.resolveExportPath({ ...escaping, context: { ...context, sequence: '01/02 - rough' } });
  check('and the ordinary case an editor really types still reads well', ordinary.path === '/Users/me/Projects/EXPORT/01-02 - rough/', ordinary.path);
  check('a device name Windows reserves is moved off it', wild.safeSegment('CON') === 'CON-', wild.safeSegment('CON'));
  check('while the filename half of the job is unchanged', wild.safeFileName('A/B:C') === 'A-B-C', wild.safeFileName('A/B:C'));
}

console.log('\nWhere a relative path hangs from');
{
  const relative = {
    template: 'EXPORT/#PRJ',
    relative: true,
    projectFile: '/Users/me/Projects/Vikings.prproj',
    productionFolder: '',
    context,
    sep: '/',
  };
  const off = wild.resolveExportPath(relative);
  check('the project file\u2019s own folder, when there is no Production', off.path === '/Users/me/Projects/EXPORT/Vikings/', off.path);
  check('and it says so', off.base === 'project', off.base);
  const inProduction = wild.resolveExportPath({ ...relative, productionFolder: '/Volumes/Team/Season One' });
  check(
    'the Production folder wins over the project file',
    inProduction.path === '/Volumes/Team/Season One/EXPORT/Vikings/',
    inProduction.path,
  );
  check('and it says that too', inProduction.base === 'production', inProduction.base);
  const unsaved = wild.resolveExportPath({ ...relative, projectFile: '' });
  check('a project that was never saved has nothing to be relative to', unsaved.path === '', unsaved.path);
  check('and is told to save first, in the English the rest of the panel speaks', unsaved.error.includes('Save the project'), unsaved.error);
  const absolute = wild.resolveExportPath({ ...relative, relative: false });
  check('a relative template used as an absolute one is refused', absolute.path === '', absolute.path);
  check('with a reason that names the toggle', absolute.error.includes('Turn on R'), absolute.error);
  check('an empty template is refused', wild.resolveExportPath({ ...relative, template: '  ' }).error !== '');
}

console.log('\nWindows paths');
{
  const resolved = wild.resolveExportPath({
    template: 'EXPORT\\#PRJ',
    relative: true,
    projectFile: 'C:\\Work\\Vikings.prproj',
    productionFolder: '',
    context,
    sep: '\\',
  });
  check('resolve with backslashes and one trailing one', resolved.path === 'C:\\Work\\EXPORT\\Vikings\\', resolved.path);
  check('a drive letter is absolute', wild.isAbsolutePath('C:\\Work') === true);
  check('so is a UNC share', wild.isAbsolutePath('\\\\server\\share') === true);
  check('a bare folder name is not', wild.isAbsolutePath('EXPORT') === false);
  const unc = wild.resolveExportPath({
    template: '\\\\server\\share\\EXPORT',
    relative: false,
    projectFile: '',
    productionFolder: '',
    context,
    sep: '\\',
  });
  check('and the doubled separator that makes a server survives', unc.path === '\\\\server\\share\\EXPORT\\', unc.path);
  check('the separator follows the platform', wild.separatorFor('win32') === '\\' && wild.separatorFor('darwin') === '/');
  check('a project file at the root of a volume still has a parent', wild.parentFolder('/Vikings.prproj') === '/');
}

console.log('\nInserting a wildcard where the caret is');
{
  const appended = wild.insertWildcard('EXPORT/', 7, 7, '#PRJ');
  check('it lands at the caret', appended.value === 'EXPORT/#PRJ', appended.value);
  check('and the caret ends up past it', appended.caret === 11, String(appended.caret));
  const replaced = wild.insertWildcard('EXPORT/OLD', 7, 10, '#SEQ');
  check('a selection is replaced rather than pushed aside', replaced.value === 'EXPORT/#SEQ', replaced.value);
  const clamped = wild.insertWildcard('AB', 99, 99, '#DD');
  check('a caret past the end is pulled back into range', clamped.value === 'AB#DD', clamped.value);
}

console.log('\nNames that have to survive a file system');
// This is the filename, which is a different job from the folder segments above: the export is
// named after the sequence, and a sequence may be called anything at all.
{
  check('a slash in a sequence name cannot get into the filename', wild.safeFileName('A/B:C') === 'A-B-C', wild.safeFileName('A/B:C'));
  check('trailing dots and spaces go, because Windows drops them', wild.safeFileName(' Take 1. ') === 'Take 1');
  check('a name that is nothing but punctuation comes back empty', wild.safeFileName('...') === '', wild.safeFileName('...'));
}

console.log('\nMaking the folders');
{
  const folder = join(stage, 'made', 'deeply', 'nested') + '/';
  const first = compass.ensureFolder(folder);
  check('a missing folder is created', first.created === true && first.error === '', JSON.stringify(first));
  check('and it is really there', existsSync(folder));
  const second = compass.ensureFolder(folder);
  check('a folder that already exists is not created twice', second.created === false && second.error === '', JSON.stringify(second));

  const blocker = join(stage, 'blocker');
  writeFileSync(blocker, 'not a folder', 'utf8');
  const refused = compass.ensureFolder(join(blocker, 'child'));
  check('a path that cannot be created explains itself', refused.error !== '' && refused.created === false, JSON.stringify(refused));
  check('in the same English the rest of the panel speaks', refused.error.startsWith('The folder could not be created'), refused.error);
  check('an empty path is refused before anything is touched', compass.ensureFolder('  ').error !== '');
}

console.log('\nWhich settings are in play');
{
  const settings = compass.defaultCompass();
  settings.media = { template: 'GLOBAL', relative: true };
  settings.frame = { template: 'GLOBAL-FRAME', relative: true };
  const project = '/Users/me/Vikings.prproj';
  const global = compass.activePaths(settings, project);
  check('the global pair, when the project has nothing of its own', global.media.template === 'GLOBAL' && global.overridden === false);

  settings.overrides[project] = {
    enabled: true,
    media: { template: 'MINE', relative: true },
    frame: { template: 'MINE-FRAME', relative: true },
  };
  const overridden = compass.activePaths(settings, project);
  check('an override wins for the project it was written for', overridden.media.template === 'MINE', overridden.media.template);
  check('and says that it did', overridden.overridden === true);
  check('both halves come from the override, never one from each', overridden.frame.template === 'MINE-FRAME');
  check(
    'another project is unaffected',
    compass.activePaths(settings, '/Users/me/Other.prproj').media.template === 'GLOBAL',
  );
  settings.overrides[project].enabled = false;
  check('an override switched off falls back to the global pair', compass.activePaths(settings, project).media.template === 'GLOBAL');
  check(
    'a project that was never saved cannot have one',
    compass.activePaths(settings, '').overridden === false,
  );
}

console.log('\nThe plan the service and the preview both read');
{
  const settings = compass.defaultCompass();
  settings.media = { template: 'EXPORT/#YYYY#MM#DD', relative: true };
  settings.frame = { template: 'EXPORT/Frames/#SEQ', relative: true };
  const plan = compass.planCompass(
    settings,
    {
      project: 'Vikings',
      projectFile: '/Users/me/Vikings.prproj',
      production: '',
      productionFolder: '',
      sequence: 'DrakeShip',
      bin: '',
      stillSeconds: 5,
    },
    DOC_MOMENT,
    'darwin',
  );
  check('both paths resolve at once', plan.media === '/Users/me/EXPORT/20220520/' && plan.frame === '/Users/me/EXPORT/Frames/DrakeShip/', `${plan.media} | ${plan.frame}`);
  check('with no error and nothing missing', plan.error === '' && plan.missing.length === 0, plan.error);
  const unsaved = compass.planCompass(
    settings,
    { project: '', projectFile: '', production: '', productionFolder: '', sequence: 'A', bin: '', stillSeconds: 0 },
    DOC_MOMENT,
    'darwin',
  );
  check('and one reason, not two, when neither can resolve', unsaved.error !== '' && unsaved.media === '', unsaved.error);
}

console.log('\nWhat a saved settings file is read back as');
{
  const base = compass.defaultCompass();
  const restored = compass.compassFrom(
    { enabled: true, media: { template: 'A' }, overrides: { '/p.prproj': { media: { template: 'B' } } } },
    base,
  );
  check('a half-written path keeps the default for the half that is missing', restored.media.relative === base.media.relative);
  check('and takes the half that is there', restored.media.template === 'A');
  check('an override with no enabled flag is on, since writing one is the act of enabling it', restored.overrides['/p.prproj'].enabled === true);
  check('nonsense in the file lands on the defaults', compass.compassFrom(null, base).media.template === base.media.template);
  check('the two keys are the ones read out of the real preferences file',
    compass.compassKey('media') === 'MZ.Prefs.Export.Media.Path' && compass.compassKey('frame') === 'Monitor.ExportFrame.CurrentPath',
  );
  check('and the exported constants agree with them',
    compass.EXPORT_MEDIA_KEY === compass.compassKey('media') && compass.EXPORT_FRAME_KEY === compass.compassKey('frame'),
  );
  const paste = compass.pasteFrom({ stillSeconds: 9999, name: '   ', createdFolders: ['a', 'b'] }, compass.defaultPaste());
  check('a paste duration out of range is pulled back in', paste.stillSeconds === 600, String(paste.stillSeconds));
  check('a blank name falls back to the default', paste.name === compass.defaultPaste().name, paste.name);
  check('the folders already made are carried across', paste.createdFolders.join(',') === 'a,b');
}

const fresh = () => createHost({ hostScript, documentsRoot: join(stage, 'Documents') });

console.log('\nWhat the host says about what is open');
{
  const { world, call } = fresh();
  world.projectName = 'Vikings.prproj';
  world.projectPath = '/Users/me/Vikings.prproj';
  const answer = call({ op: 'projectContext' });
  check('the request is answered', answer.ok, JSON.stringify(answer));
  check('the project name loses its extension, which is what #PRJ means', answer.data.project === 'Vikings', answer.data.project);
  check('the project file comes through whole', answer.data.projectFile === '/Users/me/Vikings.prproj');
  check('the active sequence is named', answer.data.sequence === 'Mock Sequence', answer.data.sequence);
  check('a project outside a Production says so with an empty name', answer.data.production === '', answer.data.production);
  check(
    'the still duration is read in seconds, not the frame count sitting next to it',
    answer.data.stillSeconds === 5,
    String(answer.data.stillSeconds),
  );
  check('a sequence at the root of the project is in no bin', answer.data.bin === '', answer.data.bin);
}

{
  const { world, call } = fresh();
  world.addBin('Episodios', [world.current.projectItem]);
  world.production = { name: 'Season One', path: '/Volumes/Team/Season One' };
  const answer = call({ op: 'projectContext' });
  check('a sequence inside a bin reports the bin', answer.data.bin === 'Episodios', answer.data.bin);
  check('a project in a Production names it', answer.data.production === 'Season One', answer.data.production);
  check('and gives its folder, which is what a relative path hangs off', answer.data.productionFolder === '/Volumes/Team/Season One');
}

{
  const { world, call } = fresh();
  world.properties.delete('BE.Prefs.StillImages.DurationInSeconds');
  // 125 frames at the rate Premiere counts stills in, which is its own preference and not the
  // open sequence's: the mock sequence runs at 30 and the answer is still five seconds.
  check(
    'with only the frame count left, it is converted at the still rate',
    call({ op: 'projectContext' }).data.stillSeconds === 5,
    String(call({ op: 'projectContext' }).data.stillSeconds),
  );
  world.properties.delete('BE.Prefs.StillImages.DefaultFramerate');
  check(
    'and with no rate either, the open sequence\u2019s own is the last resort',
    call({ op: 'projectContext' }).data.stillSeconds === 4.167,
    String(call({ op: 'projectContext' }).data.stillSeconds),
  );
  world.properties.delete('BE.Prefs.StillImages.Duration');
  check(
    'with none of the three it answers zero rather than inventing a duration',
    call({ op: 'projectContext' }).data.stillSeconds === 0,
    String(call({ op: 'projectContext' }).data.stillSeconds),
  );
}

console.log('\nWriting the export paths, and reading them straight back');
{
  const { world, call } = fresh();
  const answer = call({ op: 'compassApply', media: '/Users/me/EXPORT/', frame: '/Users/me/FRAMES/' });
  check('the request is answered', answer.ok, JSON.stringify(answer));
  check('both paths were attempted', answer.data.writes.length === 2, JSON.stringify(answer.data.writes));
  const [media, frame] = answer.data.writes;
  check('the media path names the key it used', media.key === 'MZ.Prefs.Export.Media.Path', media.key);
  check('the frame path names its own', frame.key === 'Monitor.ExportFrame.CurrentPath', frame.key);
  check('a value that came back unchanged counts as taken', media.ok === true && frame.ok === true, JSON.stringify(answer.data.writes));
  check('and what came back is reported, not what was asked for', media.readBack === '/Users/me/EXPORT/', media.readBack);
  check('Premiere really holds it now', world.properties.get('MZ.Prefs.Export.Media.Path') === '/Users/me/EXPORT/');
  check('an empty path is not written at all', call({ op: 'compassApply', media: '', frame: '' }).data.writes.length === 0);
}

{
  // The keys are undocumented, so the case that matters is the build that takes the write and keeps
  // its own value. Nothing about the call itself gives that away; only the read back does.
  const { world, call } = fresh();
  world.readOnlyProperties.add('MZ.Prefs.Export.Media.Path');
  const answer = call({ op: 'compassApply', media: '/Users/me/EXPORT/', frame: '/Users/me/FRAMES/' });
  const [media, frame] = answer.data.writes;
  check('a write Premiere ignored is not claimed as a success', media.ok === false, JSON.stringify(media));
  check('and the value it kept instead is reported', media.readBack === '/Users/mock/Movies/Render/', media.readBack);
  check('the other path is judged on its own', frame.ok === true, JSON.stringify(frame));
}

{
  const { world, call } = fresh();
  world.properties.delete('Monitor.ExportFrame.CurrentPath');
  world.readOnlyProperties.add('Monitor.ExportFrame.CurrentPath');
  const [frame] = call({ op: 'compassApply', media: '', frame: '/Users/me/FRAMES/' }).data.writes;
  check('a key that does not exist afterwards is a refusal, not an empty success', frame.ok === false, JSON.stringify(frame));
  check('with nothing to report as the value it kept', frame.readBack === '', frame.readBack);
}

{
  // Premiere is not consistent about the separator it insists on: the same machine stores the frame
  // path with one in 26.0 and without one in 25.0.
  const { world, call } = fresh();
  world.properties.set('Monitor.ExportFrame.CurrentPath', '/Users/me/FRAMES');
  world.readOnlyProperties.add('Monitor.ExportFrame.CurrentPath');
  const [frame] = call({ op: 'compassApply', media: '', frame: '/Users/me/FRAMES/' }).data.writes;
  check('a value that differs only by the trailing separator still counts as taken', frame.ok === true, JSON.stringify(frame));
}

console.log('\nThe Media Encoder fallback');
{
  const { world, call } = fresh();
  const queued = call({ op: 'compassExport', path: '/Users/me/EXPORT/', fileName: 'DrakeShip', preset: '/presets/h264.epr' });
  check('the sequence is queued', queued.ok && queued.data.job === 'job-1', JSON.stringify(queued));
  check('at the resolved path, joined to the file name', world.encodeCalls.at(-1).output === '/Users/me/EXPORT/DrakeShip', world.encodeCalls.at(-1).output);
  check('with the chosen preset', world.encodeCalls.at(-1).preset === '/presets/h264.epr');
  check('for the whole sequence rather than the work area', world.encodeCalls.at(-1).workArea === 0, String(world.encodeCalls.at(-1).workArea));
  check('and the queue is started', world.encodeCalls.at(-1).start === 1, String(world.encodeCalls.at(-1).start));
  check('Media Encoder is launched first, since a queue with nothing listening goes nowhere', world.encoderLaunches > 0);

  const noPreset = call({ op: 'compassExport', path: '/Users/me/EXPORT/', fileName: 'A', preset: '' });
  check('without a preset it refuses and says which setting is missing', !noPreset.ok && noPreset.error.includes('.epr'), noPreset.error);
  check('and nothing was queued', world.encodeCalls.length === 1, String(world.encodeCalls.length));
}

{
  const { world, call } = fresh();
  world.encodeJob = 0;
  const refused = call({ op: 'compassExport', path: '/E/', fileName: 'A', preset: '/p.epr' });
  check('a queue Media Encoder would not take is reported as a failure', !refused.ok, JSON.stringify(refused));
}

{
  const { context: hostContext, call } = fresh();
  delete hostContext.app.encoder;
  const missing = call({ op: 'compassExport', path: '/E/', fileName: 'A', preset: '/p.epr' });
  check('a Premiere with no encoder API says so instead of throwing something unreadable', !missing.ok && missing.error.includes('app.encoder'), missing.error);
}

console.log('\nExporting twice to the same folder');
// The resolved name is the sequence and the hour and minute, so two exports a few seconds apart
// resolve to the same one. Media Encoder appends the preset's extension itself, so what is about to
// be overwritten is not even at the path this was handed.
{
  const { world, call } = fresh();
  const folder = join(stage, 'twice');
  mkdirSync(folder, { recursive: true });
  const path = `${folder}/`;
  call({ op: 'compassExport', path, fileName: 'DrakeShip_1530', preset: '/p.epr' });
  check('the first export is queued under the name it was given', world.encodeCalls.at(-1).output === `${path}DrakeShip_1530`, world.encodeCalls.at(-1).output);

  writeFileSync(join(folder, 'DrakeShip_1530.mp4'), 'the first export');
  call({ op: 'compassExport', path, fileName: 'DrakeShip_1530', preset: '/p.epr' });
  check(
    'the second is moved off it, because the extension Media Encoder adds is not knowable here',
    world.encodeCalls.at(-1).output === `${path}DrakeShip_1530-2`,
    world.encodeCalls.at(-1).output,
  );
  check('and the first export is still on disk', existsSync(join(folder, 'DrakeShip_1530.mp4')));

  writeFileSync(join(folder, 'DrakeShip_1530-2.mov'), 'the second export');
  call({ op: 'compassExport', path, fileName: 'DrakeShip_1530', preset: '/p.epr' });
  check('and a third steps past both of them', world.encodeCalls.at(-1).output === `${path}DrakeShip_1530-3`, world.encodeCalls.at(-1).output);

  writeFileSync(join(folder, 'DrakeShip_1531'), 'an export with no extension at all');
  call({ op: 'compassExport', path, fileName: 'DrakeShip_1531', preset: '/p.epr' });
  check('an extensionless file already there counts too', world.encodeCalls.at(-1).output === `${path}DrakeShip_1531-2`, world.encodeCalls.at(-1).output);

  call({ op: 'compassExport', path, fileName: 'Untouched', preset: '/p.epr' });
  check('a name nothing is using is left exactly as it was', world.encodeCalls.at(-1).output === `${path}Untouched`, world.encodeCalls.at(-1).output);

  const nowhere = call({ op: 'compassExport', path: `${folder}/not-made/`, fileName: 'A', preset: '/p.epr' });
  check('and a folder that does not exist yet is not a collision', nowhere.ok && world.encodeCalls.at(-1).output === `${folder}/not-made/A`, world.encodeCalls.at(-1).output);
}

rmSync(stage, { recursive: true, force: true });
finish('compass');
