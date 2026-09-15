// Builds a demo Steam folder with a copy of your newest ETS2 save in which the
// personal parts are replaced by made-up values (profile name, company name,
// money, experience), for screenshots. The agent reads it when started with
// STEAM_PATH=<out>. Job offers, garages and cities stay as in your save.
//
// usage: node dev/demo/make-demo-save.mjs [out dir, default local/demo/steam]
import fs from 'node:fs';
import path from 'node:path';
import { findLatestSave } from '../../pc/agent/save.mjs';
import { readSii } from '../../pc/agent/sii.mjs';

export const DEMO_PROFILE = {
  name: 'Alex Demo',
  company: 'Northwind Haulage',
  brand: 'scania',
  money: 1284500,
  experience: 486200,
  distanceKm: 184230,
};

const root = path.resolve(import.meta.dirname, '../..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'local/demo/steam'));
const found = findLatestSave('ets2');
if (!found) throw new Error('no ETS2 save found');

let game = readSii(found.file);
const set = (key, value) => {
  const re = new RegExp(`(^\\s*${key}:\\s*)\\S+`, 'm');
  if (!re.test(game)) console.warn(`not in the save: ${key}`);
  game = game.replace(re, `$1${value}`);
};
set('money_account', DEMO_PROFILE.money);
set('experience_points', DEMO_PROFILE.experience);

// the company's own garages and headquarters -> other cities
const DEMO_CITIES = ['hamburg', 'berlin', 'rotterdam', 'lyon', 'milano', 'wien', 'praha', 'warszawa'];
const owned = [];
for (const block of game.split(/^(?=garage : garage\.)/m).slice(1)) {
  const body = block.slice(0, block.search(/^\}/m));
  if (/^\s*status: [1-9]/m.test(body)) owned.push(/^garage : garage\.(\w+)/.exec(body)[1]);
}
const hq = /^\s*hq_city: (\w+)/m.exec(game)?.[1];
const cities = [...new Set([hq, ...owned].filter(Boolean))];
const rename = new Map(cities.map((c, i) => [c, DEMO_CITIES[i % DEMO_CITIES.length]]));
for (const [from, to] of rename) {
  // swap names both ways so an unowned garage in the target city keeps a valid id
  game = game.replace(new RegExp(`^garage : garage\\.(${from}|${to}) \\{`, 'gm'), (_, c) => `garage : garage.${c === from ? to : from} {`);
}
if (hq) game = game.replace(/^(\s*hq_city: )\w+/m, `$1${rename.get(hq)}`);
console.log(`garages/HQ: ${[...rename].map(([a, b]) => `${a}->${b}`).join(', ')}`);

const profileDir = path.join(out, 'userdata/0/227300/remote/profiles', Buffer.from(DEMO_PROFILE.name).toString('hex'));
const saveDir = path.join(profileDir, 'save/autosave');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(saveDir, { recursive: true });
fs.writeFileSync(path.join(saveDir, 'game.sii'), game);
fs.writeFileSync(path.join(profileDir, 'profile.sii'), `SiiNunit
{
user_profile : _nameless.demo {
 profile_name: "${DEMO_PROFILE.name}"
 company_name: "${DEMO_PROFILE.company}"
 brand: ${DEMO_PROFILE.brand}
 cached_distance: ${DEMO_PROFILE.distanceKm}
}
}
`);
console.log(`demo save: ${saveDir}`);
