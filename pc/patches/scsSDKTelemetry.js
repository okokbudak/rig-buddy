'use strict';
// Drop-in replacement for trucksim-telemetry's native addon
// (build/Release/scsSDKTelemetry.node). Instead of mapping the game's shared
// memory directly, it keeps the latest buffer streamed by RigBuddy.exe (pc/host)
// over TCP (frame = int32le length + bytes; length 0 = no telemetry).
//
// getBuffer() stays synchronous, as the library expects.

const net = require('node:net');

const HOST = '127.0.0.1';
const PORT = Number(process.env.TELEMETRY_BRIDGE_PORT || 62841);
const RECONNECT_MS = 1000;
const STALE_MS = 2000;

let latest = null;
let latestAt = 0;
let started = false;

function connect() {
  const socket = net.createConnection({ host: HOST, port: PORT });
  let pending = Buffer.alloc(0);

  socket.on('data', chunk => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 4) {
      const len = pending.readInt32LE(0);
      if (pending.length < 4 + len) break;
      latest = len === 0 ? null : Buffer.from(pending.subarray(4, 4 + len));
      latestAt = Date.now();
      pending = pending.subarray(4 + len);
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    latest = null;
    setTimeout(connect, RECONNECT_MS);
  });
}

function getBuffer(_mmfName) {
  if (!started) {
    started = true;
    connect();
  }
  if (latest == null || Date.now() - latestAt > STALE_MS) {
    throw new Error('no telemetry from TelemetryBridge');
  }
  return latest;
}

module.exports = { getBuffer };
