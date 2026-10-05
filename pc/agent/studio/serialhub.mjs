// Client of RigBuddy.exe's serial hub (pc/host/SerialHub.cs, 127.0.0.1:62847):
// the PC app owns the COM ports (.NET has serial support built in; Node would
// need a native addon), this module just says what to open and what to send.
// Protocol: one JSON object per line, both directions.
//   -> {op:"ports"}                         <- {ev:"ports", ports:[{name, desc}]}
//   -> {op:"open", id, port, baud}          <- {ev:"state", id, state:"open"|"closed"|"error", msg}
//   -> {op:"write", id, b64}                (bytes to send)
//   -> {op:"close", id}
//   -> {op:"probe", reqId, port, baud}      <- {ev:"probe", reqId, ok, reply, msg}
//   <- {ev:"rx", id, text}                  (one line the device sent)
import net from 'node:net';
import { EventEmitter } from 'node:events';

const PORT = Number(process.env.RIGBUDDY_SERIAL_PORT || 62847);

export function createHub() {
  const events = new EventEmitter();
  const waiting = new Map(); // reqId -> resolve
  let socket = null;
  let connected = false;
  let reqSeq = 0;

  function connect() {
    const s = net.createConnection({ host: '127.0.0.1', port: PORT });
    let buf = '';
    s.setNoDelay(true);
    s.on('connect', () => {
      socket = s;
      connected = true;
      events.emit('connected');
    });
    s.on('data', chunk => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          handle(JSON.parse(line));
        } catch (e) {
          console.warn('serial hub: bad line:', e.message);
        }
      }
    });
    s.on('error', () => {});
    s.on('close', () => {
      const was = connected;
      connected = false;
      socket = null;
      for (const resolve of waiting.values()) resolve({ error: 'RigBuddy.exe serial hub not reachable' });
      waiting.clear();
      if (was) events.emit('disconnected');
      setTimeout(connect, 2000).unref();
    });
  }

  function handle(m) {
    if (m.reqId != null && waiting.has(m.reqId)) {
      waiting.get(m.reqId)(m);
      waiting.delete(m.reqId);
      return;
    }
    events.emit(m.ev, m);
  }

  const send = obj => {
    if (!socket) return false;
    socket.write(JSON.stringify(obj) + '\n');
    return true;
  };

  function request(obj, timeoutMs = 8000) {
    return new Promise(resolve => {
      const reqId = ++reqSeq;
      const timer = setTimeout(() => {
        waiting.delete(reqId);
        resolve({ error: 'no answer from RigBuddy.exe' });
      }, timeoutMs);
      waiting.set(reqId, m => {
        clearTimeout(timer);
        resolve(m);
      });
      if (!send({ ...obj, reqId })) {
        clearTimeout(timer);
        waiting.delete(reqId);
        resolve({ error: 'RigBuddy.exe serial hub not reachable' });
      }
    });
  }

  connect();
  return {
    events,
    get connected() { return connected; },
    open: (id, port, baud) => send({ op: 'open', id, port, baud }),
    close: id => send({ op: 'close', id }),
    write: (id, data) => send({ op: 'write', id, b64: Buffer.from(data).toString('base64') }),
    ports: () => request({ op: 'ports' }),
    probe: (port, baud) => request({ op: 'probe', port, baud }, 12000),
  };
}
