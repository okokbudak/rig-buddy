// Bridges foobar2000's Beefweb component (http://127.0.0.1:8880 by default) so
// the app can browse playlists and pick a track, with its own UI instead of
// Beefweb's web page. Optional: if foobar2000/Beefweb isn't running, every
// call here just fails quietly and the app's library section stays hidden.
//
// Beefweb API used (see hyperblast.org/beefweb/api):
//   GET  /api/player?columns=%title%,%artist%,%album%   now playing + transport state
//   GET  /api/playlists                                  playlist list
//   GET  /api/playlists/:id/items/:offset:count?columns=...  tracks in a playlist
//   GET  /api/artwork/:playlistId/:index                 embedded album art (may 404)
//   POST /api/player/play/:playlistId/:index             play a specific track
//   POST /api/player/pause/toggle | /next | /previous | /stop
//   POST /api/player {"position": <seconds>}             seek

const BASE = process.env.BEEFWEB_URL || 'http://127.0.0.1:8880';
const COLUMNS = '%title%,%artist%,%album%,%length%';
const POLL_MS = 1000;

async function api(path, opts) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(3000), ...opts });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`beefweb ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.arrayBuffer();
}

function post(path, body) {
  return api(path, body === undefined ? { method: 'POST' } : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createLibrary(onChange) {
  let last = { available: false };
  let lastJson = '';

  function normalize(data) {
    const p = data.player;
    const item = p.activeItem;
    const [title, artist, album, length] = item.columns.length ? item.columns : ['', '', '', ''];
    return {
      available: true,
      playbackState: p.playbackState, // "playing" | "paused" | "stopped"
      volume: p.volume,
      playlistId: item.playlistId || null,
      index: item.playlistId ? item.index : -1,
      positionMs: Math.round((item.position || 0) * 1000),
      durationMs: Math.round((item.duration || 0) * 1000),
      title, artist, album, length,
    };
  }

  async function poll() {
    try {
      const data = await api(`/api/player?columns=${encodeURIComponent(COLUMNS)}`);
      last = normalize(data);
    } catch {
      last = { available: false };
    }
    // position ticks constantly; only announce real changes, like media.mjs does
    const cmp = { ...last, positionMs: undefined };
    const json = JSON.stringify(cmp);
    if (json !== lastJson) {
      lastJson = json;
      onChange();
    }
  }
  poll();
  setInterval(poll, POLL_MS);

  return {
    state: () => last,

    async playlists() {
      const data = await api('/api/playlists');
      return data.playlists.map(p => ({ id: p.id, title: p.title, current: p.isCurrent, count: p.itemCount }));
    },

    async items(playlistId, offset, count) {
      const path = `/api/playlists/${encodeURIComponent(playlistId)}/items/${offset}:${count}` +
        `?columns=${encodeURIComponent(COLUMNS)}`;
      const data = await api(path);
      return {
        offset: data.playlistItems.offset,
        total: data.playlistItems.totalCount,
        items: data.playlistItems.items.map((it, i) => {
          const [title, artist, album, length] = it.columns;
          return { index: offset + i, title, artist, album, length };
        }),
      };
    },

    /** Album art bytes for a track, or null if it has none. */
    async art(playlistId, index) {
      try {
        const r = await fetch(`${BASE}/api/artwork/${encodeURIComponent(playlistId)}/${index}`, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) return null;
        return { mime: r.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await r.arrayBuffer()) };
      } catch {
        return null;
      }
    },

    async command(cmd) {
      switch (cmd.cmd) {
        case 'play': return post(`/api/player/play/${encodeURIComponent(cmd.playlistId)}/${cmd.index}`);
        case 'toggle': return post('/api/player/pause/toggle');
        case 'pause': return post('/api/player/pause');
        case 'resume': return post('/api/player/play');
        case 'stop': return post('/api/player/stop');
        case 'next': return post('/api/player/next');
        case 'prev': return post('/api/player/previous');
        case 'seek': return post('/api/player', { position: (cmd.positionMs || 0) / 1000 });
        default: throw new Error('bad command');
      }
    },
  };
}
