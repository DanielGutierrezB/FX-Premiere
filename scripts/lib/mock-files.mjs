// ExtendScript's File and Folder, and the preset library fixture they read. Separate from the
// timeline mock because nothing here knows what a clip is: this is the half of the host environment
// that is a disk.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Every file the host script opens, so a test can prove a parse did not happen. */
export const fileReads = [];

export class FileStub {
  constructor(path) {
    this.path = String(path);
    this.encoding = 'UTF-8';
    this.buffer = null;
  }
  get name() {
    return basename(this.path);
  }
  get fsName() {
    return this.path;
  }
  get exists() {
    return existsSync(this.path) && statSync(this.path).isFile();
  }
  get length() {
    return this.exists ? statSync(this.path).size : 0;
  }
  get modified() {
    return this.exists ? statSync(this.path).mtime : null;
  }
  open() {
    if (!this.exists) {
      return false;
    }
    fileReads.push(this.path);
    this.buffer = readFileSync(this.path, 'utf8');
    return true;
  }
  read() {
    return this.buffer ?? '';
  }
  close() {
    this.buffer = null;
    return true;
  }
}

export class FolderStub {
  constructor(path) {
    this.path = String(path);
  }
  get name() {
    return basename(this.path);
  }
  get fsName() {
    return this.path;
  }
  get exists() {
    return existsSync(this.path) && statSync(this.path).isDirectory();
  }
  getFiles(pattern) {
    if (!this.exists) {
      return [];
    }
    const matcher = pattern ? new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`, 'i') : null;
    return readdirSync(this.path)
      .filter((name) => !matcher || matcher.test(name))
      .map((name) => {
        const full = join(this.path, name);
        return statSync(full).isDirectory() ? new FolderStub(full) : new FileStub(full);
      });
  }
  getFolders() {
    return this.getFiles().filter((entry) => entry instanceof FolderStub);
  }
  /** ExtendScript makes the missing parents with it, and answers false rather than throwing. */
  create() {
    try {
      mkdirSync(this.path, { recursive: true });
      return this.exists;
    } catch {
      return false;
    }
  }
}

export const PRESET_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<PremiereData Version="3">
	<Tree ObjectRef="1"/>
	<Tree ObjectID="1" ClassID="177f2841" Version="1">
		<RootBin ObjectRef="2"/>
	</Tree>
	<BinTreeItem ObjectID="2" ClassID="5e0f46fa" Version="4">
		<TreeItemBase Version="4"><Name>Root</Name></TreeItemBase>
		<Items Version="1"><Item Index="0" ObjectRef="3"/></Items>
	</BinTreeItem>
	<BinTreeItem ObjectID="3" ClassID="5e0f46fa" Version="4">
		<TreeItemBase Version="4"><Name>Presets</Name></TreeItemBase>
		<Items Version="1"><Item Index="0" ObjectRef="10"/><Item Index="1" ObjectRef="4"/></Items>
	</BinTreeItem>
	<BinTreeItem ObjectID="4" ClassID="5e0f46fa" Version="4">
		<TreeItemBase Version="4"><Name>My Folder</Name></TreeItemBase>
		<Items Version="1"><Item Index="0" ObjectRef="20"/></Items>
	</BinTreeItem>
	<TreeItem ObjectID="10" ClassID="025f59ac" Version="3">
		<TreeItemBase Version="4">
			<Data ObjectRef="11"/>
			<Name>Zoom In Test</Name>
		</TreeItemBase>
	</TreeItem>
	<FilterPresetItem ObjectID="11" ClassID="e56c9ba0" Version="2">
		<FilterPresets Version="1"><FilterPreset Index="0" ObjectRef="12"/></FilterPresets>
	</FilterPresetItem>
	<FilterPreset ObjectID="12" ClassID="ee52a7d2" Version="3">
		<MediaType>228cda18-3625-4d2d-951e-348879e4ed93</MediaType>
		<Type>1</Type>
		<AnchorInPoint>1000000000</AnchorInPoint>
		<AnchorOutPoint>255016000000</AnchorOutPoint>
		<FilterMatchName>AE.ADBE Motion</FilterMatchName>
		<Component ObjectRef="13"/>
	</FilterPreset>
	<VideoFilterComponent ObjectID="13" ClassID="d10da199" Version="9">
		<VideoFilterType>2</VideoFilterType>
		<Component Version="7">
			<DisplayName>Motion</DisplayName>
			<Params Version="1">
				<Param Index="0" ObjectRef="14"/>
				<Param Index="1" ObjectRef="15"/>
			</Params>
			<InstanceName></InstanceName>
		</Component>
		<MatchName>AE.ADBE Motion</MatchName>
	</VideoFilterComponent>
	<PointComponentParam ObjectID="14" ClassID="ca81d347" Version="3">
		<Keyframes></Keyframes>
		<IsTimeVarying>false</IsTimeVarying>
		<StartKeyframe>-91445760000000000,0.25:0.75,0,0,0,0,0,0,5,4,0,0,0,0</StartKeyframe>
		<Name>Position</Name>
	</PointComponentParam>
	<VideoComponentParam ObjectID="15" ClassID="fe47129e" Version="9">
		<Keyframes>1000000000,100.,0,0,0,0,0,0;255016000000,150.,5,0,0,0,0,0;</Keyframes>
		<IsTimeVarying>true</IsTimeVarying>
		<StartKeyframe>-91445760000000000,100.,0,0,0,0,0,0</StartKeyframe>
		<Name>Scale</Name>
	</VideoComponentParam>
	<TreeItem ObjectID="20" ClassID="025f59ac" Version="3">
		<TreeItemBase Version="4">
			<Data ObjectRef="21"/>
			<Name>Soft Blur</Name>
		</TreeItemBase>
	</TreeItem>
	<FilterPresetItem ObjectID="21" ClassID="e56c9ba0" Version="2">
		<FilterPresets Version="1"><FilterPreset Index="0" ObjectRef="22"/></FilterPresets>
	</FilterPresetItem>
	<FilterPreset ObjectID="22" ClassID="ee52a7d2" Version="3">
		<MediaType>228cda18-3625-4d2d-951e-348879e4ed93</MediaType>
		<Type>0</Type>
		<AnchorInPoint>0</AnchorInPoint>
		<AnchorOutPoint>254016000000</AnchorOutPoint>
		<FilterMatchName>AE.ADBE Gaussian Blur 2</FilterMatchName>
		<Component ObjectRef="23"/>
	</FilterPreset>
	<VideoFilterComponent ObjectID="23" ClassID="d10da199" Version="9">
		<Component Version="7">
			<DisplayName>Gaussian Blur</DisplayName>
			<Params Version="1">
				<Param Index="0" ObjectRef="24"/>
				<Param Index="1" ObjectRef="25"/>
			</Params>
		</Component>
		<MatchName>AE.ADBE Gaussian Blur 2</MatchName>
	</VideoFilterComponent>
	<VideoComponentParam ObjectID="24" ClassID="fe47129e" Version="9">
		<Keyframes></Keyframes>
		<IsTimeVarying>false</IsTimeVarying>
		<StartKeyframe>-91445760000000000,25.5,0,0,0,0,0,0</StartKeyframe>
		<Name>Blurriness</Name>
	</VideoComponentParam>
	<VideoComponentParam ObjectID="25" ClassID="cc12343e" Version="10">
		<Keyframes></Keyframes>
		<IsTimeVarying>false</IsTimeVarying>
		<StartKeyframe>-91445760000000000,true,0,0,0,0,0,0</StartKeyframe>
		<Name>Repeat Edge Pixels</Name>
	</VideoComponentParam>
</PremiereData>
`;

export const writePresetFixture = (directory) => {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'fixture.prfpset');
  writeFileSync(file, PRESET_FIXTURE, 'utf8');
  return file;
};

/**
 * The library as Premiere leaves it after a save. Saving does not edit the file in place: Premiere
 * holds the library in memory and writes the whole of it out again, numbering the objects as it
 * goes, so every ObjectID moves and one preset can end up under the id another had. `without` names
 * the presets deleted in Premiere before that save.
 */
export const rewritePresetFixture = (file, { shift = 10, without = [] } = {}) => {
  let text = existsSync(file) ? readFileSync(file, 'utf8') : PRESET_FIXTURE;
  for (const name of without) {
    const block = new RegExp(`\t<TreeItem ObjectID="(\\d+)"[\\s\\S]*?<Name>${name}</Name>[\\s\\S]*?</TreeItem>\n`);
    const match = block.exec(text);
    if (!match) {
      throw new Error(`The fixture has no preset called ${name} to delete`);
    }
    text = text.replace(match[0], '').replace(new RegExp(`<Item Index="\\d+" ObjectRef="${match[1]}"/>`), '');
  }
  text = text.replace(/(ObjectID|ObjectRef)="(\d+)"/g, (_all, attribute, id) => `${attribute}="${Number(id) + shift}"`);
  writeFileSync(file, text, 'utf8');
  // The host keeps its parsed copy of a library until the file's size or save date moves, and two
  // rewrites in the same millisecond would otherwise read as the same library.
  const when = new Date(Date.now() + 1000);
  utimesSync(file, when, when);
  return file;
};
