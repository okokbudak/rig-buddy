// Finds the newest save of the active profile and turns it into the data the
// app shows: profile/economy summary and the freight-market job offers.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { num, ofType, parseSii, readSii } from './sii.mjs';

const GAMES = {
  ets2: { appId: '227300', docs: 'Euro Truck Simulator 2', map: 'europe', scale: 19, currency: '€' },
  ats: { appId: '270880', docs: 'American Truck Simulator', map: 'usa', scale: 20, currency: '$' },
};
const STEAM = process.env.STEAM_PATH || steamPathFromRegistry() || 'C:/Program Files (x86)/Steam';
// <repo>/data/game, written by pipeline/build-map-data
const DATA = path.join(process.env.ETS2NAV_DATA || path.resolve(import.meta.dirname, '../../data'), 'game');

function steamPathFromRegistry() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
    return /SteamPath\s+REG_SZ\s+(.+)/.exec(out)?.[1].trim();
  } catch {
    return null;
  }
}

// --- static game definitions (from the map parser output) -------------------

const defsCache = {};
export function defs(game) {
  if (defsCache[game]) return defsCache[game];
  const prefix = GAMES[game].map;
  const load = n => JSON.parse(fs.readFileSync(path.join(DATA, `${prefix}-${n}.json`), 'utf8'));
  const d = {
    companies: new Map(load('companies').map(c => [`${c.token}.${c.cityToken}`, c])),
    cities: new Map(load('cities').map(c => [c.token, c])),
    companyDefs: new Map(load('companyDefs').map(c => [c.token, c])),
    cargoes: new Map(load('cargoes').map(c => [c.token, c])),
    countries: new Map(load('countries').map(c => [c.token, c])),
  };
  defsCache[game] = d;
  return d;
}

// --- locating saves -----------------------------------------------------------

function listDirs(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(p, d.name));
  } catch {
    return [];
  }
}

/** Newest game.sii across Steam-Cloud and local profiles: { file, profileDir, mtimeMs }. */
export function findLatestSave(game) {
  const g = GAMES[game];
  const profileRoots = [
    ...listDirs(path.join(STEAM, 'userdata')).map(u => path.join(u, g.appId, 'remote', 'profiles')),
    path.join(os.homedir(), 'Documents', g.docs, 'profiles'),
  ];
  let best = null;
  for (const root of profileRoots) {
    for (const profileDir of listDirs(root)) {
      for (const saveDir of listDirs(path.join(profileDir, 'save'))) {
        const file = path.join(saveDir, 'game.sii');
        let st;
        try {
          st = fs.statSync(file);
        } catch {
          continue;
        }
        if (!best || st.mtimeMs > best.mtimeMs) best = { file, profileDir, mtimeMs: st.mtimeMs };
      }
    }
  }
  return best;
}

// --- extracting what the app needs ---------------------------------------------

const hexNameToString = h => {
  try {
    return Buffer.from(h, 'hex').toString('utf8');
  } catch {
    return h;
  }
};

export function loadSave(game) {
  const found = findLatestSave(game);
  if (!found) return null;
  const blocks = parseSii(readSii(found.file));
  const d = defs(game);
  const economy = ofType(blocks, 'economy')[0]?.props ?? {};
  const gameTime = num(economy.game_time);
  const bank = blocks.get(economy.bank)?.props ?? {};
  const player = blocks.get(economy.player)?.props ?? {};

  let profile = {};
  try {
    const p = parseSii(readSii(path.join(found.profileDir, 'profile.sii')));
    profile = ofType(p, 'user_profile')[0]?.props ?? {};
  } catch {
    // profile.sii unreadable: fall back to the folder name (hex-encoded)
  }

  const garages = ofType(blocks, 'garage')
    .filter(b => num(b.props.status) > 0)
    .map(b => {
      const city = b.id.replace(/^garage\./, '');
      const vehicles = (Array.isArray(b.props.vehicles) ? b.props.vehicles : []).filter(v => v && v !== 'null');
      const drivers = (Array.isArray(b.props.drivers) ? b.props.drivers : []).filter(v => v && v !== 'null');
      return { city, cityName: d.cities.get(city)?.name ?? city, status: num(b.props.status), vehicles: vehicles.length, drivers: drivers.length };
    });

  const jobs = [];
  for (const c of ofType(blocks, 'company')) {
    const m = /^company\.volatile\.(.+)\.([^.]+)$/.exec(c.id);
    if (!m) continue;
    const [, companyToken, cityToken] = m;
    const offers = Array.isArray(c.props.job_offer) ? c.props.job_offer : [];
    for (const offerId of offers) {
      const o = blocks.get(offerId)?.props;
      if (!o || !o.target) continue;
      const expires = num(o.expiration_time);
      if (expires <= gameTime) continue;
      jobs.push(toJob(d, game, companyToken, cityToken, o, gameTime));
    }
  }

  return {
    game,
    file: found.file,
    savedAt: found.mtimeMs,
    gameTime,
    currency: GAMES[game].currency,
    profile: {
      name: profile.profile_name || hexNameToString(path.basename(found.profileDir)),
      company: profile.company_name || '',
      brand: profile.brand || '',
      money: num(bank.money_account),
      loan: (Array.isArray(bank.loans) ? bank.loans : []).length,
      experience: num(economy.experience_points),
      hqCity: player.hq_city ? d.cities.get(player.hq_city)?.name ?? player.hq_city : '',
      visitedCities: Array.isArray(economy.visited_cities) ? economy.visited_cities.length : 0,
      totalCities: d.cities.size,
      trucks: Array.isArray(player.trucks) ? player.trucks.filter(t => t && t !== 'null').length : 0,
      trailers: Array.isArray(player.trailers) ? player.trailers.filter(t => t && t !== 'null').length : 0,
      drivers: garages.reduce((a, g) => a + g.drivers, 0),
      garages,
      distanceKm: num(profile.cached_distance),
    },
    jobs,
  };
}

function toJob(d, game, companyToken, cityToken, o, gameTime) {
  const [targetCompany, targetCity] = String(o.target).split('.');
  const cargoToken = String(o.cargo || '').replace(/^cargo\./, '');
  const cargo = d.cargoes.get(cargoToken);
  const src = d.companies.get(`${companyToken}.${cityToken}`);
  const dst = d.companies.get(`${targetCompany}.${targetCity}`);
  const km = num(o.shortest_distance_km);
  const units = Math.max(1, num(o.units_count, 1));
  const urgency = num(o.urgency);
  const urgencyMult = [1, 1.15, 1.3][urgency] ?? 1;
  const trailerDef = String(o.trailer_definition || '').split('.');
  return {
    id: `${companyToken}.${cityToken}>${o.target}>${cargoToken}>${o.expiration_time}`,
    source: {
      company: d.companyDefs.get(companyToken)?.name ?? companyToken,
      city: d.cities.get(cityToken)?.name ?? cityToken,
      nodeUid: src?.nodeUid ?? null,
      x: src?.x ?? null,
      y: src?.y ?? null,
    },
    destination: {
      company: d.companyDefs.get(targetCompany)?.name ?? targetCompany,
      city: d.cities.get(targetCity)?.name ?? targetCity,
      country: d.countries.get(d.cities.get(targetCity)?.countryToken)?.name ?? '',
      nodeUid: dst?.nodeUid ?? null,
    },
    cargo: prettyCargo(cargo?.name ?? cargoToken),
    cargoMassT: cargo ? Math.round((cargo.mass * units) / 100) / 10 : null,
    adr: cargo?.adrClass ?? 0,
    fragile: (cargo?.fragility ?? 0) > 0.5,
    distanceKm: km,
    urgency,
    expiresInMin: num(o.expiration_time) - gameTime,
    trailer: trailerDef[2] ?? '',
    // Rough: the game also applies skills/cargo bonuses we can't see here.
    estimatedIncome: cargo ? Math.round(cargo.unitRewardPerKm * units * km * urgencyMult) : null,
  };
}

function prettyCargo(name) {
  const s = String(name).replace(/^(cn|cgo)\s+/i, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
