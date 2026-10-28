// The PC's music player for the app: what plays and play / pause / next / previous / shuffle / repeat. RigBuddy.exe does
// it through Windows' media sessions (pc/host/MediaControl.cs: Spotify, YouTube in a browser, Apple Music, VLC, ...);
// this asks it over its loopback control port (127.0.0.1:62845, one line in, one line out).
import net from 'node:net';

const CONTROL_PORT = Number(process.env.RIGBUDDY_CONTROL_PORT || 62845);
export const MEDIA_ACTIONS = new Set(['playpause', 'play', 'pause', 'next', 'previous', 'shuffle', 'repeat', 'mute', 'volume']);

function ask(line) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port: CONTROL_PORT });
    let buf = '';
    const done = value => {
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 4000);
    socket.on('connect', () => socket.write(`${line}\n`));
    socket.on('data', d => {
      buf += d;
      if (buf.includes('\n')) done(buf.split('\n')[0]);
    });
    socket.on('error', () => done(null));
  });
}

/** {active: false} (nothing plays, or the PC program cannot be asked) or the player and the track: see MediaControl.cs. */
export async function mediaState() {
  const line = await ask('media');
  try {
    const state = JSON.parse(line);
    return state && typeof state === 'object' ? state : { active: false };
  } catch {
    return { active: false };
  }
}

/**
 * Sends a command (one of MEDIA_ACTIONS) and returns the new state; null for an action that does not exist or a volume
 * that is not a whole number from 0 to 100. "volume" is the player's own volume (or the PC's when the player has none).
 */
export async function mediaCommand(action, value) {
  if (!MEDIA_ACTIONS.has(action)) return null;
  if (action === 'volume') {
    if (!Number.isInteger(value) || value < 0 || value > 100) return null;
    await ask(`media volume ${value}`);
  } else {
    await ask(`media ${action}`);
  }
  await new Promise(r => setTimeout(r, 150)); // the player needs a moment to show the new state
  return mediaState();
}
