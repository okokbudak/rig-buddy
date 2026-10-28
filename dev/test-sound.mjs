// The app's sound mods list/switch (pc/agent/sound.mjs) on a fake game folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const game = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-game-'));
const folder = path.join(game, 'bin', 'win_x64', 'plugins', 'rigbuddy-sound');
fs.mkdirSync(folder, { recursive: true });
process.env.ETS2_DIR = game;
process.env.ATS_DIR = path.join(game, 'no-such-game');
for (const f of ['master.bank', 'Alpha.bank', 'Alpha.bank.guids', 'Pipe Mod.bank', 'v8.bank', 'v8.bank.guids', 'x.strings.bank']) {
  fs.writeFileSync(path.join(folder, f), 'x');
}
fs.writeFileSync(path.join(folder, 'selected.bank.txt'), 'Pipe Mod\r\nalpha\n');

const { soundState, setSoundMod } = await import('../pc/agent/sound.mjs');

let s = soundState();
assert.equal(s.games.length, 1, 'only the game that exists, with the plugin folder');
assert.equal(s.games[0].id, 'ets2');
assert.deepEqual(s.games[0].mods.map(m => m.name), ['Alpha', 'Pipe Mod', 'v8'], 'master and string banks are not mods');
assert.deepEqual(s.games[0].mods.map(m => m.active), [true, true, false], 'case-insensitive match, CRLF, a name with a space');
assert.deepEqual(s.games[0].mods.map(m => m.guids), [true, false, true], 'a mod without .bank.guids is marked');

s = setSoundMod('ets2', 'v8', true);
assert.equal(fs.readFileSync(path.join(folder, 'selected.bank.txt'), 'utf8'), 'Pipe Mod\nalpha\nv8', 'added at the end, the others stay in order');
assert.equal(s.games[0].mods.find(m => m.name === 'v8').active, true);

s = setSoundMod('ets2', 'PIPE MOD', false);
assert.equal(fs.readFileSync(path.join(folder, 'selected.bank.txt'), 'utf8'), 'alpha\nv8');
assert.equal(s.games[0].mods.find(m => m.name === 'Pipe Mod').active, false);

assert.equal(setSoundMod('ets2', '../../evil', true), null, 'only a mod that is in the folder');
assert.equal(setSoundMod('ets2', 'master', true), null, 'master.bank is not a mod');
assert.equal(setSoundMod('ats', 'v8', true), null, 'unknown game / not installed');
assert.equal(setSoundMod('nope', 'v8', true), null);
assert.equal(fs.readFileSync(path.join(folder, 'selected.bank.txt'), 'utf8'), 'alpha\nv8', 'refused requests change nothing');

fs.rmSync(game, { recursive: true, force: true });
console.log('sound: all tests passed');
