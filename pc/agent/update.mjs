// Is there a newer Rig Buddy on GitHub? The agent asks the GitHub API for the latest published release (at most every
// 6 hours, a failed try again after 30 minutes) and tells RigBuddy.exe (tray) and the apps (GET /update). The PC is the
// one that asks because the tablet in the truck often has no internet. Switch off in the tray menu ("Check for updates").
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'okokbudak/rig-buddy';
const FRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;

let latest = null; // { version, url, name, publishedAt } of the last good answer
let checkedAt = 0;
let nextAt = 0;
let pending = null;

/** "0.6.3" > "0.6.2.0": numeric parts, missing parts count as 0. Anything unreadable is not newer. */
export function isNewer(a, b) {
  const parts = v => String(v ?? '').replace(/^v/i, '').split('.').map(n => Number.parseInt(n, 10));
  const x = parts(a), y = parts(b);
  if (x.some(Number.isNaN) || y.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

async function fetchLatest() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'RigBuddy-update-check', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const j = await res.json();
  const version = String(j.tag_name ?? '').replace(/^v/i, '');
  if (!/^\d+(\.\d+)*$/.test(version)) throw new Error('unexpected tag');
  // only a page on this repository is ever offered to open
  const url = typeof j.html_url === 'string' && j.html_url.startsWith(`https://github.com/${REPO}/`) ? j.html_url : `https://github.com/${REPO}/releases/latest`;
  return {
    version, url, name: j.name ?? `Rig Buddy ${version}`, publishedAt: j.published_at ?? null,
    setup: setupAsset(j.assets), apk: setupAsset(j.assets, 'RigBuddy.apk'),
  };
}

/**
 * A file of a release: the PC installer for RigBuddy.exe's "Download and install", or the app's APK, which the agent
 * fetches for the tablets (apkFile). { url, sha256, size }, or null. Only a file of this repository's releases, and only
 * with the SHA-256 GitHub computed for it (the `digest` of the asset): the download is checked against it before
 * anything is installed.
 */
export function setupAsset(assets, name = 'RigBuddy-Setup.exe') {
  const a = Array.isArray(assets) ? assets.find(x => x?.name === name) : null;
  const url = a?.browser_download_url;
  const digest = typeof a?.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(a.digest)?.[1] : null;
  if (typeof url !== 'string' || !url.startsWith(`https://github.com/${REPO}/releases/download/`) || !digest) return null;
  return { url, sha256: digest.toLowerCase(), size: Number.isSafeInteger(a.size) ? a.size : null };
}

let apkPending = null;

/**
 * The latest release's APK on this PC, for the apps (GET /update/apk): fetched from GitHub once into <dir>/update,
 * checked against GitHub's SHA-256, older ones removed. Resolves to { file, version, sha256, size }; rejects when the
 * release has no APK with a checksum or the download fails.
 */
export async function apkFile(dir, fetchImpl = fetch) {
  await updateInfo();
  const a = latest?.apk;
  if (!a) throw new Error('no APK with a checksum in the latest release');
  const folder = path.join(dir, 'update');
  const file = path.join(folder, `RigBuddy-${latest.version}.apk`);
  const result = { file, version: latest.version, sha256: a.sha256, size: a.size };
  if (fs.existsSync(file) && sha256Of(file) === a.sha256) return result;
  apkPending ??= (async () => {
    fs.mkdirSync(folder, { recursive: true });
    const res = await fetchImpl(a.url, { headers: { 'User-Agent': 'RigBuddy-update' }, signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    const got = crypto.createHash('sha256').update(body).digest('hex');
    if (got !== a.sha256) throw new Error('the APK does not match the checksum GitHub published');
    fs.writeFileSync(`${file}.part`, body);
    fs.renameSync(`${file}.part`, file);
    for (const f of fs.readdirSync(folder)) if (f !== path.basename(file)) fs.rmSync(path.join(folder, f), { force: true });
  })().finally(() => { apkPending = null; });
  await apkPending;
  return result;
}

function sha256Of(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** { latest, url, name, publishedAt, setup, apk, current, newer }; latest is null while nothing is known (offline, checking is off). */
export async function updateInfo() {
  const current = process.env.RIGBUDDY_VERSION || null;
  if (process.env.RIGBUDDY_UPDATE_CHECK === '0') return { latest: null, current, newer: false, disabled: true };
  if (Date.now() >= nextAt) {
    pending ??= fetchLatest()
      .then(r => { latest = r; checkedAt = Date.now(); nextAt = checkedAt + FRESH_MS; })
      .catch(e => { console.warn(`update check: ${e.message}`); nextAt = Date.now() + RETRY_MS; })
      .finally(() => { pending = null; });
    await pending;
  }
  return {
    latest: latest?.version ?? null,
    url: latest?.url ?? null,
    name: latest?.name ?? null,
    publishedAt: latest?.publishedAt ?? null,
    setup: latest?.setup ?? null,
    // the app downloads its update from this PC (GET /update/apk), not from GitHub: the tablet in the truck is often offline
    apk: latest?.apk ? { sha256: latest.apk.sha256, size: latest.apk.size } : null,
    current,
    newer: latest && current ? isNewer(latest.version, current) : false,
  };
}
