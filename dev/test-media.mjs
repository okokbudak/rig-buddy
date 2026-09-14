// Prints what the bridge's media service reports (127.0.0.1:62844).
import net from 'node:net';
const s = net.createConnection({ host: '127.0.0.1', port: 62844 });
let buf = '';
s.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    const m = JSON.parse(line);
    if (m.type === 'art') console.log('art', m.key, m.mime, m.data.length, 'b64 chars');
    else console.log(JSON.stringify(m.data, null, 1).slice(0, 1500));
  }
});
s.on('error', e => console.log('error', e.message));
setTimeout(() => process.exit(0), 3000);
