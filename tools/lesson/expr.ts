/**
 * A small, safe maths expression reader for lesson graphs, e.g. "sin(x - t)" or
 * "2x^2 + 3x - 1". It only understands numbers, x, t, pi, e, + - * / ^, brackets
 * and a fixed list of functions, so text from Claude is never run as code.
 */
export type Fn = (x: number, t: number) => number;

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const VARS = new Set(['x', 't']);
export const MAX_EXPR_CHARS = 200;

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new Error(`bad number at "${src.slice(i, i + 6)}"`);
      out.push({ k: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-z]/i.test(c)) {
      const m = /^[a-z][a-z0-9]*/i.exec(src.slice(i))!;
      let word = m[0].toLowerCase();
      // "xt" or "pix" style run-ons are split only when the whole word is unknown
      if (!Object.hasOwn(FUNCS, word) && !Object.hasOwn(CONSTS, word) && !VARS.has(word)) {
        const known = ['pi', 'x', 't', 'e'].find((p) => word.startsWith(p));
        if (!known) throw new Error(`unknown name "${m[0]}"`);
        word = known;
      }
      out.push({ k: 'id', v: word });
      i += word.length;
    } else if ('+-*/^(),'.includes(c)) {
      out.push({ k: 'op', v: c });
      i++;
    } else if (c === '·' || c === '×') {
      out.push({ k: 'op', v: '*' });
      i++;
    } else {
      throw new Error(`unexpected "${c}"`);
    }
  }
  return out;
}

/** Turns an expression into a function of x and t. Throws a readable error if it is not valid. */
export function compile(src: string): Fn {
  if (typeof src !== 'string' || !src.trim()) throw new Error('empty expression');
  if (src.length > MAX_EXPR_CHARS) throw new Error('expression too long');
  // allow "y = ..." / "f(x) = ..."
  const body = src.replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=/i, '');
  const toks = tokenize(body);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected "${v}"`);
    p++;
  };
  // Can the next token start a factor? Used for implicit multiplication like "2x" or "3(x+1)".
  const startsFactor = () => peek() && (peek().k === 'num' || peek().k === 'id' || (peek().k === 'op' && peek().v === '('));

  function expr(): Fn {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      const a = left;
      const b = term();
      left = op === '+' ? (x, t) => a(x, t) + b(x, t) : (x, t) => a(x, t) - b(x, t);
    }
    return left;
  }
  function term(): Fn {
    let left = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = toks[p++].v;
        const a = left;
        const b = unary();
        left = op === '*' ? (x, t) => a(x, t) * b(x, t) : (x, t) => a(x, t) / b(x, t);
      } else if (startsFactor()) {
        const a = left;
        const b = power();
        left = (x, t) => a(x, t) * b(x, t);
      } else return left;
    }
  }
  function unary(): Fn {
    if (isOp('-')) {
      p++;
      const a = unary();
      return (x, t) => -a(x, t);
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  }
  function power(): Fn {
    const base = atom();
    if (isOp('^')) {
      p++;
      const ex = unary(); // right-associative, allows 2^-x
      return (x, t) => Math.pow(base(x, t), ex(x, t));
    }
    return base;
  }
  function atom(): Fn {
    const tok = toks[p++];
    if (!tok) throw new Error('expression ends too early');
    if (tok.k === 'num') return () => tok.v;
    if (tok.k === 'op' && tok.v === '(') {
      const inner = expr();
      expect(')');
      return inner;
    }
    if (tok.k === 'id') {
      if (tok.v === 'x') return (x) => x;
      if (tok.v === 't') return (_x, t) => t;
      if (Object.hasOwn(CONSTS, tok.v)) {
        const v = CONSTS[tok.v];
        return () => v;
      }
      const f = Object.hasOwn(FUNCS, tok.v) ? FUNCS[tok.v] : undefined;
      if (f) {
        expect('(');
        const args = [expr()];
        while (isOp(',')) {
          p++;
          args.push(expr());
        }
        expect(')');
        return (x, t) => f(...args.map((a) => a(x, t)));
      }
    }
    throw new Error(`unexpected "${tok.v}"`);
  }

  const fn = expr();
  if (p < toks.length) throw new Error(`unexpected "${toks[p].v}"`);
  return fn;
}
