// Reading ETS2/ATS save files (.sii).
//
// Steam-Cloud saves are "ScsC": AES-256-CBC + zlib around the actual SII. With
// `uset g_save_format "2"` in config.cfg the inner file is plain text
// ("SiiNunit"), which is what we parse here. Key and header layout as
// documented by the community SII_Decrypt tool.
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';

const KEY = Buffer.from('2a5fcb1791d22fb60245b3d8369ed0b2c27371563fbf1f3c9edf6b11825a5d0a', 'hex');

/** Returns the SII text of a save file, decrypting it if needed. */
export function readSii(file) {
  const buf = fs.readFileSync(file);
  const magic = buf.toString('latin1', 0, 4);
  if (magic === 'SiiN') return buf.toString('utf8');
  if (magic !== 'ScsC') throw new Error(`unsupported save format "${magic}" in ${file}`);
  // header: magic(4) hmac(32) iv(16) plainSize(4)
  const iv = buf.subarray(36, 52);
  const body = buf.subarray(56, 56 + Math.floor((buf.length - 56) / 16) * 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
  decipher.setAutoPadding(false);
  const dec = Buffer.concat([decipher.update(body), decipher.final()]);
  const plain = zlib.inflateSync(dec, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  const inner = plain.toString('latin1', 0, 4);
  if (inner === 'BSII') {
    throw new Error('binary save (BSII); set `uset g_save_format "2"` in config.cfg for text saves');
  }
  return plain.toString('utf8');
}

/**
 * Parses SII text into a Map of block id -> { type, id, props }. Arrays
 * (`key[]: v` / `key[3]: v`) become JS arrays; scalars stay strings (quotes
 * stripped). Deliberately minimal: good enough for the fields we read.
 */
export function parseSii(text) {
  const blocks = new Map();
  let cur = null;
  const lines = text.split(/\r?\n/);
  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (cur === null) {
      const m = /^([\w.]+)\s*:\s*([\w.]+)\s*\{$/.exec(line);
      if (m) cur = { type: m[1], id: m[2], props: {} };
      continue;
    }
    if (line === '}') {
      blocks.set(cur.id, cur);
      cur = null;
      continue;
    }
    const m = /^([\w]+)(\[(\d*)\])?\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, isArr, idx, rawVal] = m;
    const val = unquote(rawVal);
    if (isArr) {
      let arr = cur.props[key];
      if (!Array.isArray(arr)) arr = cur.props[key] = [];
      if (idx === '') arr.push(val);
      else arr[Number(idx)] = val;
    } else if (!(key in cur.props) || !Array.isArray(cur.props[key])) {
      // `key: N` announces an array length; keep the array if entries follow.
      cur.props[key] = val;
    }
  }
  return blocks;
}

function unquote(v) {
  if (!(v.length >= 2 && v.startsWith('"') && v.endsWith('"'))) return v;
  const s = v.slice(1, -1);
  // SII escapes non-ASCII UTF-8 bytes as \xNN (e.g. "K\xc3\xb6kbudak").
  if (!s.includes('\\x')) return s;
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === 'x' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 2, i + 4))) {
      bytes.push(parseInt(s.slice(i + 2, i + 4), 16));
      i += 3;
    } else {
      bytes.push(...Buffer.from(s[i], 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Blocks of one unit type. */
export function ofType(blocks, type) {
  const out = [];
  for (const b of blocks.values()) if (b.type === type) out.push(b);
  return out;
}

export function num(v, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
