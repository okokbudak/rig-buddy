// Is there a newer Rig Buddy on GitHub? The agent asks the GitHub API for the latest published release (at most every
// 6 hours, a failed try again after 30 minutes) and tells RigBuddy.exe (tray) and the apps (GET /update). The PC is the
// one that asks because the tablet in the truck often has no internet. Switch off in the tray menu ("Check for updates").
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
  return { version, url, name: j.name ?? `Rig Buddy ${version}`, publishedAt: j.published_at ?? null };
}

/** { latest, url, name, publishedAt, current, newer }; latest is null while nothing is known (offline, checking is off). */
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
    current,
    newer: latest && current ? isNewer(latest.version, current) : false,
  };
}
