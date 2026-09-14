// Detects which in-game radio station ETS2/ATS is playing and what song is on.
//
// The SDK doesn't expose the radio, so: the stations come from the game's
// live_streams.sii; the game's TCP connections (netstat) are matched against
// the stations' resolved addresses; the song comes from the stream's ICY
// metadata ("StreamTitle"), fetched by us on a short side connection.
import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

const GAMES = {
  ets2: { exe: 'eurotrucks2.exe', docs: 'Euro Truck Simulator 2' },
  ats: { exe: 'amtrucks.exe', docs: 'American Truck Simulator' },
};

export function createRadio(onChange) {
  let game = 'ets2';
  let stations = [];
  const byAddress = new Map(); // "ip:port" -> station[]
  let current = null;          // { name, genre, country, url, song }
  let lastSongFetch = 0;
  let resolving = false;

  async function loadStations() {
    const file = path.join(os.homedir(), 'Documents', GAMES[game].docs, 'live_streams.sii');
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      stations = [];
      return;
    }
    stations = [];
    for (const m of text.matchAll(/stream_data\[\d*\]:\s*"([^"]*)"/g)) {
      const [url, name, genre, country] = m[1].split('|');
      try {
        const u = new URL(url);
        stations.push({ url, name, genre, country, host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) });
      } catch {
        // skip malformed entries
      }
    }
    resolving = true;
    byAddress.clear();
    const hosts = [...new Set(stations.map(s => s.host))];
    let i = 0;
    await Promise.all(Array.from({ length: 16 }, async () => {
      while (i < hosts.length) {
        const host = hosts[i++];
        let addrs = [];
        try {
          addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, family: 4 });
        } catch {
          continue;
        }
        for (const st of stations.filter(s => s.host === host)) {
          for (const a of addrs) {
            const key = `${a.address}:${st.port}`;
            if (!byAddress.has(key)) byAddress.set(key, []);
            byAddress.get(key).push(st);
          }
        }
      }
    }));
    resolving = false;
    console.log(`radio: ${stations.length} stations, ${byAddress.size} addresses`);
  }

  function gameConnections() {
    return new Promise(resolve => {
      execFile('tasklist', ['/FI', `IMAGENAME eq ${GAMES[game].exe}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
        const m = !err && /"[^"]+","(\d+)"/.exec(out);
        if (!m) return resolve(null); // game not running
        const pid = m[1];
        execFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, maxBuffer: 8 << 20 }, (err2, ns) => {
          if (err2) return resolve([]);
          const remotes = [];
          for (const line of ns.split(/\r?\n/)) {
            const p = line.trim().split(/\s+/);
            if (p.length >= 5 && p[0] === 'TCP' && p[3] === 'ESTABLISHED' && p[4] === pid) remotes.push(p[2]);
          }
          resolve(remotes);
        });
      });
    });
  }

  async function poll() {
    if (resolving) return;
    const remotes = await gameConnections();
    let station = null;
    if (remotes) {
      for (const r of remotes) {
        const hit = byAddress.get(r);
        if (hit) {
          // Several stations can share a server; keep the current one if it's among them.
          station = hit.find(s => current && s.url === current.url) ?? hit[0];
          break;
        }
      }
    }
    const prevUrl = current?.url ?? null;
    if (!station) {
      if (current !== null) {
        current = null;
        onChange();
      }
      return;
    }
    if (station.url !== prevUrl) {
      current = { name: station.name, genre: station.genre, country: station.country, url: station.url, song: '' };
      lastSongFetch = 0;
      onChange();
    }
    if (Date.now() - lastSongFetch > 20_000) {
      lastSongFetch = Date.now();
      const song = await fetchStreamTitle(station.url).catch(() => '');
      if (current && current.url === station.url && song !== current.song) {
        current.song = song;
        onChange();
      }
    }
  }

  loadStations();
  setInterval(() => poll().catch(e => console.warn('radio:', e.message)), 5000);

  return {
    state: () => current && { name: current.name, genre: current.genre, country: current.country, song: current.song },
    setGame(g) {
      if (g !== game && GAMES[g]) {
        game = g;
        current = null;
        loadStations();
      }
    },
  };
}

/** Reads one ICY metadata block ("StreamTitle='Artist - Song';") from a stream. */
export function fetchStreamTitle(url, redirects = 2) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const timer = setTimeout(() => done(new Error('timeout')), 8000);
    let finished = false;
    let sock;
    const done = (err, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { sock?.destroy(); } catch { /* ignore */ }
      err ? reject(err) : resolve(val);
    };
    const onHeaders = (statusLine, headers, rest, stream) => {
      const code = Number((/\s(\d{3})/.exec(statusLine) || [])[1] || 0);
      if (code >= 300 && code < 400 && headers.location && redirects > 0) {
        // hand the promise over to the redirected request
        finished = true;
        clearTimeout(timer);
        try { sock?.destroy(); } catch { /* ignore */ }
        fetchStreamTitle(new URL(headers.location, url).toString(), redirects - 1).then(resolve, reject);
        return;
      }
      const metaint = Number(headers['icy-metaint']);
      if (!metaint) return done(null, '');
      let buf = rest;
      const onData = chunk => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length < metaint + 1) return;
        const len = buf[metaint] * 16;
        if (buf.length < metaint + 1 + len) return;
        const meta = buf.subarray(metaint + 1, metaint + 1 + len).toString('utf8');
        const m = /StreamTitle='(.*?)';/.exec(meta);
        const title = m ? m[1].trim() : '';
        // ad-break markers and empty separators aren't song titles
        done(null, /^(adbreak|advert|ad_|commercial)|^[\s\-–|]*$/i.test(title) ? '' : title);
      };
      stream.on('data', onData);
      if (rest.length) onData(Buffer.alloc(0));
    };

    // Raw sockets (plain or TLS) instead of Node's HTTP client: Shoutcast v1
    // answers "ICY 200 OK", which Node's HTTP parser rejects.
    const secure = u.protocol === 'https:';
    const opts = { host: u.hostname, port: Number(u.port) || (secure ? 443 : 80) };
    sock = secure ? tls.connect({ ...opts, servername: u.hostname }) : net.createConnection(opts);
    let head = Buffer.alloc(0);
    let gotHeaders = false;
    sock.on(secure ? 'secureConnect' : 'connect', () => {
      sock.write(`GET ${u.pathname || '/'}${u.search} HTTP/1.0\r\nHost: ${u.host}\r\nIcy-MetaData: 1\r\nUser-Agent: ets2nav\r\n\r\n`);
    });
    sock.on('data', chunk => {
      if (gotHeaders) return;
      head = Buffer.concat([head, chunk]);
      let end = head.indexOf('\r\n\r\n'), sepLen = 4;
      if (end < 0 && (end = head.indexOf('\n\n')) >= 0) sepLen = 2; // some servers use bare LFs
      if (end < 0) {
        if (head.length > 16384) done(new Error('headers too long'));
        return;
      }
      gotHeaders = true;
      const lines = head.subarray(0, end).toString('latin1').split(/\r?\n/);
      const headers = {};
      for (const l of lines.slice(1)) {
        const i = l.indexOf(':');
        if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
      }
      onHeaders(lines[0], headers, head.subarray(end + sepLen), sock);
    });
    sock.on('error', e => done(e));
  });
}
