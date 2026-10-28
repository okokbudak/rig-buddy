// The sound mods of Rig Buddy's sound plugin (rigbuddy-sound.dll) for the app: which FMOD sound mods each game has and
// which are on, and switching one on or off. "On" means the mod is in selected.bank.txt, which the plugin watches and
// loads while the game runs (pc/sound-plugin). The folder is <game>\bin\win_x64\plugins\rigbuddy-sound.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const GAMES = {
  ets2: { name: 'Euro Truck Simulator 2', dir: 'Euro Truck Simulator 2', env: 'ETS2_DIR' },
  ats: { name: 'American Truck Simulator', dir: 'American Truck Simulator', env: 'ATS_DIR' },
};

function steamLibraries() {
  let steam = process.env.STEAM_PATH;
  if (!steam) {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
      steam = /SteamPath\s+REG_SZ\s+(.+)/.exec(out)?.[1].trim();
    } catch {
      // no Steam
    }
  }
  steam ||= 'C:/Program Files (x86)/Steam';
  const libs = [steam];
  try {
    const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, '\\'));
  } catch {
    // no library list
  }
  return [...new Set(libs)];
}

function gameDir(id) {
  const g = GAMES[id];
  if (process.env[g.env]) return process.env[g.env];
  for (const lib of steamLibraries()) {
    const dir = path.join(lib, 'steamapps', 'common', g.dir);
    if (fs.existsSync(path.join(dir, 'base.scs'))) return dir;
  }
  return null;
}

function folderOf(id) {
  const dir = gameDir(id);
  if (!dir) return null;
  const folder = path.join(dir, 'bin', 'win_x64', 'plugins', 'rigbuddy-sound');
  return fs.existsSync(folder) ? folder : null;
}

/** Mod names in a plugin folder: every .bank except master.bank (and string banks). */
function banks(folder) {
  return fs.readdirSync(folder)
    .filter(f => /\.bank$/i.test(f))
    .map(f => f.slice(0, -5))
    .filter(n => n.toLowerCase() !== 'master' && !/\.strings$/i.test(n))
    .sort((a, b) => a.localeCompare(b));
}

function selected(folder) {
  try {
    return fs.readFileSync(path.join(folder, 'selected.bank.txt'), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// The volumes of sound_levels.txt (the plugin applies a change within a second): key -> the plugin's default
export const LEVELS = {
  master: 0.5,
  engine: 0.5,
  exhaust: 0.5,
  turbo: 0.5,
  interior: 0.75,
  navigation: 0.75,
  exterior_when_windows_closed: 0.75,
};
const MAX_LEVEL = 1.5;

function readLevelsFile(folder) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folder, 'sound_levels.txt'), 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

function levels(folder) {
  const j = readLevelsFile(folder);
  return Object.fromEntries(Object.entries(LEVELS).map(([k, d]) => [k, typeof j[k] === 'number' ? j[k] : d]));
}

/** { games: [{id, name, mods: [{name, active, guids}], levels: {master, engine, ...}}] }: the games that have the sound plugin's folder. */
export function soundState() {
  const games = [];
  for (const [id, g] of Object.entries(GAMES)) {
    const folder = folderOf(id);
    if (!folder) continue;
    const on = new Set(selected(folder).map(s => s.toLowerCase()));
    games.push({
      id,
      name: g.name,
      levels: levels(folder),
      mods: banks(folder).map(name => ({
        name,
        active: on.has(name.toLowerCase()),
        guids: fs.existsSync(path.join(folder, `${name}.bank.guids`)), // without it the mod loads but plays nothing
        provides: provides(folder, name),
      })),
    });
  }
  return { games };
}

/**
 * What a mod has, read from its .bank.guids (one "{guid} event:/engine/exhaust" line per bank object): how many sounds
 * each volume can act on. interior = cabin sounds (indicator, wipers, windows, ...), navigation = the navigator's
 * voice, engine / exhaust / turbo = that part of the engine, outside = everything heard from outside (engine, effects,
 * horn, retarder, other trucks' engines). A volume whose count is 0 changes nothing with that mod. null: no guids file.
 */
export function provides(folder, name) {
  let text;
  try {
    text = fs.readFileSync(path.join(folder, `${name}.bank.guids`), 'utf8');
  } catch {
    return null;
  }
  const p = { interior: 0, navigation: 0, engine: 0, exhaust: 0, turbo: 0, outside: 0 };
  for (const m of text.matchAll(/event:\/([^\s]+)/g)) {
    const e = m[1].toLowerCase();
    const top = e.split('/')[0];
    if (top === 'interior' || top === 'cabin') p.interior++;
    else if (e.includes('navigation')) p.navigation++;
    else p.outside++;
    if (e === 'engine/engine') p.engine++;
    if (e === 'engine/exhaust') p.exhaust++;
    if (e.includes('turbo')) p.turbo++;
  }
  return p;
}

/** Sets one volume (0 to 1.5) in sound_levels.txt, keeping the other keys of the file. Returns the new state, or null. */
export function setSoundLevel(gameId, key, value) {
  if (!GAMES[gameId] || !Object.hasOwn(LEVELS, key) || typeof value !== 'number' || !Number.isFinite(value)) return null;
  const folder = folderOf(gameId);
  if (!folder) return null;
  const j = readLevelsFile(folder);
  j[key] = Math.round(Math.min(MAX_LEVEL, Math.max(0, value)) * 100) / 100;
  if (typeof j.config_version !== 'number') j.config_version = 2; // an older file would be "upgraded" (halved) by the plugin
  fs.writeFileSync(path.join(folder, 'sound_levels.txt'), JSON.stringify(j, null, 4));
  return soundState();
}

/**
 * Switches one mod on or off (it is added to / taken out of selected.bank.txt; the others stay as they are, in order).
 * Returns the new state, or null when the game or the mod is unknown.
 */
export function setSoundMod(gameId, mod, active) {
  if (!GAMES[gameId] || typeof mod !== 'string') return null;
  const folder = folderOf(gameId);
  if (!folder) return null;
  const name = banks(folder).find(n => n.toLowerCase() === mod.toLowerCase()); // only a mod that is really there
  if (!name) return null;
  const rest = selected(folder).filter(s => s.toLowerCase() !== name.toLowerCase());
  if (active) rest.push(name);
  fs.writeFileSync(path.join(folder, 'selected.bank.txt'), rest.join('\n'));
  return soundState();
}
