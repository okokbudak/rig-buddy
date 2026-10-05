// Formula language of Rig Buddy Studio: small, safe, no eval.
//
//   truck.speed.kph * 10
//   clamp(truck.fuel.value / max(truck.fuel.capacity, 1) * 100, 0, 100)
//   truck.electric.enabled && !truck.engine.enabled ? 1 : 0
//
// Identifiers are telemetry property paths (dots allowed); `get(path)` supplies
// their value. Numbers, 'strings', true/false/null, + - * / % **, comparisons,
// && || !, ?:, and the functions in FUNCS. Booleans count as 1/0 in arithmetic.

export class FormulaError extends Error {
  constructor(message, pos) {
    super(pos == null ? message : `${message} (at ${pos + 1})`);
    this.pos = pos;
  }
}

const num = v => (typeof v === 'number' ? v : typeof v === 'boolean' ? +v : v == null ? 0 : Number(v));

const FUNCS = {
  abs: Math.abs,
  round: (x, d = 0) => {
    const k = 10 ** num(d);
    return Math.round(num(x) * k) / k;
  },
  floor: Math.floor,
  ceil: Math.ceil,
  sqrt: Math.sqrt,
  pow: Math.pow,
  min: (...a) => Math.min(...a.map(num)),
  max: (...a) => Math.max(...a.map(num)),
  clamp: (x, lo, hi) => Math.min(Math.max(num(x), num(lo)), num(hi)),
  /** map(x, inLo, inHi, outLo, outHi): linear, clamped to the output range. */
  map: (x, a, b, c, d) => {
    x = num(x); a = num(a); b = num(b); c = num(c); d = num(d);
    if (a === b) return c;
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return c + t * (d - c);
  },
  if: (c, a, b) => (c ? a : b),
  int: x => Math.trunc(num(x)),
  /** format(x, decimals): fixed-point text, for Nextion text fields. */
  format: (x, d = 0) => num(x).toFixed(num(d)),
  pad: (x, n, ch = '0') => String(x).padStart(num(n), String(ch)),
  upper: s => String(s).toUpperCase(),
  lower: s => String(s).toLowerCase(),
};
export const FUNCTION_NAMES = Object.keys(FUNCS);

// --- tokens ---------------------------------------------------------------------------

const PUNCT = ['**', '&&', '||', '==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', '(', ')', ','];

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      out.push({ t: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) s += src[j++];
      if (j >= src.length) throw new FormulaError('unterminated text', i);
      out.push({ t: 'str', v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*/.exec(src.slice(i));
      out.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const p = PUNCT.find(x => src.startsWith(x, i));
    if (!p) throw new FormulaError(`unexpected "${c}"`, i);
    out.push({ t: 'p', v: p, pos: i });
    i += p.length;
  }
  out.push({ t: 'end', pos: src.length });
  return out;
}

// --- parser (precedence climbing) -> closures ---------------------------------------------

const BINARY = {
  '||': [1, (a, b) => a() || b()],
  '&&': [2, (a, b) => a() && b()],
  '==': [3, (a, b) => looseEq(a(), b())],
  '!=': [3, (a, b) => !looseEq(a(), b())],
  '<': [4, (a, b) => num(a()) < num(b())],
  '<=': [4, (a, b) => num(a()) <= num(b())],
  '>': [4, (a, b) => num(a()) > num(b())],
  '>=': [4, (a, b) => num(a()) >= num(b())],
  '+': [5, (a, b) => { const x = a(), y = b(); return typeof x === 'string' || typeof y === 'string' ? `${x}${y}` : num(x) + num(y); }],
  '-': [5, (a, b) => num(a()) - num(b())],
  '*': [6, (a, b) => num(a()) * num(b())],
  '/': [6, (a, b) => num(a()) / num(b())],
  '%': [6, (a, b) => num(a()) % num(b())],
  '**': [8, (a, b) => num(a()) ** num(b()), true], // right-associative
};

const looseEq = (a, b) => (typeof a === 'string' || typeof b === 'string' ? String(a) === String(b) : num(a) === num(b));

/**
 * Compiles `src` to `(get) => value`. `get(path)` returns a telemetry value.
 * Throws FormulaError for syntax errors and unknown functions.
 */
export function compile(src) {
  const toks = tokenize(String(src));
  let k = 0;
  const peek = () => toks[k];
  const next = () => toks[k++];
  const isP = v => peek().t === 'p' && peek().v === v;
  const expect = v => {
    if (!isP(v)) throw new FormulaError(`expected "${v}"`, peek().pos);
    k++;
  };

  function ternary() {
    const cond = binary(1);
    if (!isP('?')) return cond;
    next();
    const a = ternary();
    expect(':');
    const b = ternary();
    return ctx => (cond(ctx) ? a(ctx) : b(ctx));
  }

  function binary(minPrec) {
    let left = unary();
    for (;;) {
      const tk = peek();
      const op = tk.t === 'p' ? BINARY[tk.v] : null;
      if (!op || op[0] < minPrec) return left;
      next();
      const right = binary(op[2] ? op[0] : op[0] + 1);
      const l = left, f = op[1];
      left = ctx => f(() => l(ctx), () => right(ctx));
    }
  }

  function unary() {
    if (isP('-')) { next(); const e = unary(); return ctx => -num(e(ctx)); }
    if (isP('+')) { next(); const e = unary(); return ctx => num(e(ctx)); }
    if (isP('!')) { next(); const e = unary(); return ctx => !e(ctx); }
    return primary();
  }

  function primary() {
    const tk = next();
    if (tk.t === 'num' || tk.t === 'str') return () => tk.v;
    if (tk.t === 'p' && tk.v === '(') {
      const e = ternary();
      expect(')');
      return e;
    }
    if (tk.t === 'id') {
      if (isP('(')) {
        next();
        const fn = Object.hasOwn(FUNCS, tk.v) ? FUNCS[tk.v] : null;
        if (!fn) throw new FormulaError(`unknown function ${tk.v}`, tk.pos);
        const args = [];
        if (!isP(')')) {
          do args.push(ternary()); while (isP(',') && next());
        }
        expect(')');
        return ctx => fn(...args.map(a => a(ctx)));
      }
      if (tk.v === 'true') return () => true;
      if (tk.v === 'false') return () => false;
      if (tk.v === 'null') return () => null;
      return ctx => ctx(tk.v);
    }
    throw new FormulaError(tk.t === 'end' ? 'formula ends too early' : `unexpected "${tk.v}"`, tk.pos);
  }

  const root = ternary();
  if (peek().t !== 'end') throw new FormulaError(`unexpected "${peek().v}"`, peek().pos);
  return root;
}

/** Walks `path` ("truck.speed.kph") in a plain object; own properties only. */
export function lookup(obj, path) {
  let v = obj;
  for (const part of path.split('.')) {
    if (v == null || typeof v !== 'object' || !Object.hasOwn(v, part)) return undefined;
    v = v[part];
  }
  return v;
}
