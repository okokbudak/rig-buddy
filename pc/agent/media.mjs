// Relays the RigBuddy.exe media service (127.0.0.1:62844) to the app.
import net from 'node:net';

const PORT = 62844;
const MAX_ART = 12;

export function createMedia(onChange) {
  let state = null;          // last {"type":"media"} payload
  const art = new Map();     // key -> { mime, data: Buffer }
  let sock = null;

  function connect() {
    sock = net.createConnection({ host: '127.0.0.1', port: PORT });
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === 'media') {
          state = msg.data;
          onChange();
        } else if (msg.type === 'art') {
          art.set(msg.key, { mime: msg.mime, data: Buffer.from(msg.data, 'base64') });
          while (art.size > MAX_ART) art.delete(art.keys().next().value);
        }
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      sock = null;
      if (state !== null) {
        state = null;
        onChange();
      }
      setTimeout(connect, 2000);
    });
  }
  connect();

  return {
    state: () => state,
    art: key => art.get(key),
    command(cmd) {
      if (!sock) return false;
      sock.write(JSON.stringify(cmd) + '\n');
      return true;
    },
  };
}
