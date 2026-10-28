// The agent's music player bridge (pc/agent/media.mjs) against a fake RigBuddy.exe control port.
import assert from 'node:assert/strict';
import net from 'node:net';

const seen = [];
let playing = true;
const server = net.createServer(socket => {
  let buf = '';
  socket.on('data', d => {
    buf += d;
    if (!buf.includes('\n')) return;
    const cmd = buf.split('\n')[0].trim();
    buf = '';
    seen.push(cmd);
    if (cmd === 'media playpause') playing = !playing;
    if (cmd === 'media boom') return socket.end('error: the player did not take the command\n');
    const state = { active: true, app: 'Spotify', title: 'Song', artist: 'Artist', status: playing ? 'playing' : 'paused', position: 12.5, duration: 200 };
    socket.end(cmd.startsWith('media ') && cmd !== 'media' ? 'ok\n' : `${JSON.stringify(state)}\n`);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.RIGBUDDY_CONTROL_PORT = String(server.address().port);

const { mediaState, mediaCommand, MEDIA_ACTIONS } = await import('../pc/agent/media.mjs');

let s = await mediaState();
assert.equal(s.active, true);
assert.equal(s.title, 'Song');
assert.equal(s.status, 'playing');

s = await mediaCommand('playpause');
assert.deepEqual(seen.slice(-2), ['media playpause', 'media'], 'the command, then the state');
assert.equal(s.status, 'paused');

assert.equal(await mediaCommand('format-c'), null, 'only known actions');
assert.equal(await mediaCommand('../../x'), null);
assert.ok(MEDIA_ACTIONS.has('next') && MEDIA_ACTIONS.has('repeat'));
assert.ok(!seen.some(c => c.includes('format') || c.includes('..')), 'unknown actions never reach the PC program');

server.close();
// nobody listening: not a crash, just "nothing plays"
process.env.RIGBUDDY_CONTROL_PORT = '1';
const other = await import('../pc/agent/media.mjs?again');
assert.deepEqual(await other.mediaState(), { active: false });
console.log('media: all tests passed');
