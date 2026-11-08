/**
 * Lesson format: a narrated, step-by-step explanation. Each step is spoken aloud
 * while its visuals appear. Claude's input is checked and cleaned here, so the
 * lesson window only ever receives plain data in a known shape (never code or HTML).
 */
import { compile } from './expr.js';

export const BLOCK_TYPES = ['heading', 'text', 'bullets', 'math', 'diagram', 'chart', 'plot', 'scene', 'animate', 'table', 'note', 'quote', 'code', 'snip'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const PLACEMENTS = ['auto', 'full', 'left', 'right'] as const;
export type Placement = (typeof PLACEMENTS)[number];
export const CHART_KINDS = ['line', 'bar', 'scatter', 'pie'] as const;
export const SHAPES = ['rect', 'circle', 'line', 'arrow', 'text', 'path'] as const;
export const COLOR_NAMES = ['blue', 'orange', 'green', 'yellow', 'pink', 'violet', 'red', 'gray', 'white'] as const;
export const NOTE_TONES = ['tip', 'warn', 'example', 'key'] as const;
/** Every lesson follows these four parts, in order. */
export const PARTS = ['problem', 'intuition', 'solution', 'recap'] as const;
export type Part = (typeof PARTS)[number];

export const LIMITS = {
  steps: 30,
  blocksPerStep: 5,
  say: 700,
  text: 1200,
  items: 10,
  series: 6,
  values: 200,
  fns: 4,
  shapes: 60,
  changes: 30,
  rows: 16,
  cols: 8,
  code: 3000,
  tex: 600,
} as const;

export interface Shape {
  id?: string;
  shape: (typeof SHAPES)[number];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  x2?: number;
  y2?: number;
  d?: string;
  text?: string;
  size?: number;
  color?: string;
  fill?: string;
  opacity?: number;
  rotate?: number;
}

export interface Change {
  id: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  x2?: number;
  y2?: number;
  opacity?: number;
  rotate?: number;
  color?: string;
  fill?: string;
  text?: string;
}

export interface Block {
  type: BlockType;
  id?: string;
  text?: string;
  items?: string[];
  tex?: string;
  code?: string;
  chart?: (typeof CHART_KINDS)[number];
  title?: string;
  labels?: string[];
  series?: { name: string; values?: number[]; points?: [number, number][] }[];
  xLabel?: string;
  yLabel?: string;
  fns?: { expr: string; label?: string }[];
  x?: [number, number];
  y?: [number, number];
  t?: [number, number];
  seconds?: number;
  points?: { x: number; y: number; label?: string }[];
  w?: number;
  h?: number;
  shapes?: Shape[];
  target?: string;
  changes?: Change[];
  repeat?: 'none' | 'loop' | 'bounce';
  rows?: string[][];
  tone?: (typeof NOTE_TONES)[number];
  /** Where this comes from: "p. 3", "src/app.ts:40-58", "your screen". Listed under References. */
  source?: string;
  /** code: language, first line number, and lines to highlight. */
  lang?: string;
  line?: number;
  marks?: number[];
  /** snip: the part of the last screenshot (in its pixels) to show and highlight. */
  rect?: { x: number; y: number; w: number; h: number };
  /** snip: filled in by Jarvis itself (never taken from Claude): the cut-out picture and where to highlight in it (0-1). */
  image?: string;
  hl?: { x: number; y: number; w: number; h: number };
}

export interface Step {
  say: string;
  show: Block[];
  clear?: boolean;
  focus?: string;
  /** Which of the four parts this step belongs to (only in lessons that use them). */
  part?: Part;
}

export interface Lesson {
  title: string;
  placement: Placement;
  append: boolean;
  steps: Step[];
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const range = (v: unknown): [number, number] | undefined => {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const a = num(v[0]);
  const b = num(v[1]);
  return a !== undefined && b !== undefined && a !== b ? [Math.min(a, b), Math.max(a, b)] : undefined;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (allowed.includes(v as T) ? (v as T) : undefined);
const HEX = /^#[0-9a-f]{6}$/i;
const color = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s === 'grey') return 'gray';
  if (s === 'purple') return 'violet';
  if (s === 'magenta') return 'pink';
  if (s === 'aqua' || s === 'teal') return 'green';
  return (COLOR_NAMES as readonly string[]).includes(s) || HEX.test(s) ? s : undefined;
};
/** SVG path data only: commands and numbers, nothing else. */
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function shape(v: unknown): Shape | null {
  if (!isObj(v)) return null;
  const kind = pick(v.shape ?? v.type, SHAPES);
  if (!kind) return null;
  const s: Shape = { shape: kind };
  for (const k of ['x', 'y', 'w', 'h', 'r', 'x2', 'y2', 'size', 'opacity', 'rotate'] as const) {
    const n = num(v[k]);
    if (n !== undefined) s[k] = n;
  }
  s.id = str(v.id, 40);
  s.text = str(v.text ?? v.label, 200);
  s.color = color(v.color);
  s.fill = color(v.fill);
  if (kind === 'path') {
    const d = str(v.d, 4000);
    if (!d || !PATH.test(d)) return null;
    s.d = d;
  }
  return s;
}

function change(v: unknown): Change | null {
  if (!isObj(v)) return null;
  const id = str(v.id, 40);
  if (!id) return null;
  const c: Change = { id };
  for (const k of ['x', 'y', 'w', 'h', 'r', 'x2', 'y2', 'opacity', 'rotate'] as const) {
    const n = num(v[k]);
    if (n !== undefined) c[k] = n;
  }
  c.color = color(v.color);
  c.fill = color(v.fill);
  c.text = str(v.text, 200);
  return c;
}

/** Checks one visual. Returns null (with a warning) when it cannot be shown. */
export function normalizeBlock(v: unknown, warn: (m: string) => void): Block | null {
  if (!isObj(v)) return null;
  const type = pick(v.type, BLOCK_TYPES);
  if (!type) {
    warn(`unknown visual type "${String(v.type)}"`);
    return null;
  }
  const b: Block = { type, id: str(v.id, 40) };
  const title = str(v.title, 120);
  if (title) b.title = title;
  const source = str(v.source ?? v.ref, 160);
  if (source) b.source = source;
  switch (type) {
    case 'heading':
    case 'text':
    case 'note': {
      b.text = str(v.text, LIMITS.text);
      if (!b.text) return warn(`${type} needs text`), null;
      if (type === 'note') b.tone = pick(v.tone, NOTE_TONES) ?? 'tip';
      return b;
    }
    case 'bullets': {
      const items = Array.isArray(v.items) ? v.items.map((i) => str(i, 300)).filter((i): i is string => Boolean(i)) : [];
      if (!items.length) return warn('bullets need items'), null;
      b.items = items.slice(0, LIMITS.items);
      return b;
    }
    case 'math': {
      b.tex = str(v.tex ?? v.text, LIMITS.tex);
      if (!b.tex) return warn('math needs tex'), null;
      return b;
    }
    case 'diagram': {
      b.code = str(v.code ?? v.text, LIMITS.code);
      if (!b.code) return warn('diagram needs Mermaid code'), null;
      return b;
    }
    case 'chart': {
      b.chart = pick(v.chart ?? v.kind, CHART_KINDS) ?? 'line';
      b.labels = Array.isArray(v.labels) ? v.labels.slice(0, LIMITS.values).map((l) => String(l).slice(0, 40)) : undefined;
      b.xLabel = str(v.xLabel, 60);
      b.yLabel = str(v.yLabel, 60);
      const series = Array.isArray(v.series) ? v.series : [];
      b.series = series
        .filter(isObj)
        .slice(0, LIMITS.series)
        .map((s, i) => {
          const values = Array.isArray(s.values) ? s.values.slice(0, LIMITS.values).map((x) => num(x) ?? NaN) : undefined;
          const points = Array.isArray(s.points)
            ? s.points
                .slice(0, LIMITS.values)
                .map((pt) => (Array.isArray(pt) ? [num(pt[0]), num(pt[1])] : isObj(pt) ? [num(pt.x), num(pt.y)] : []))
                .filter((pt): pt is [number, number] => pt.length === 2 && pt[0] !== undefined && pt[1] !== undefined)
            : undefined;
          return { name: str(s.name, 40) ?? `Series ${i + 1}`, values, points };
        })
        .filter((s) => (s.values?.some((x) => Number.isFinite(x)) ?? false) || (s.points?.length ?? 0) > 0);
      if (!b.series.length) return warn('chart needs series with values or points'), null;
      return b;
    }
    case 'plot': {
      const fns = (Array.isArray(v.fns) ? v.fns : typeof v.expr === 'string' ? [{ expr: v.expr }] : [])
        .map((f) => (typeof f === 'string' ? { expr: f } : f))
        .filter(isObj)
        .slice(0, LIMITS.fns);
      b.fns = [];
      for (const f of fns) {
        const expr = str(f.expr, 200);
        if (!expr) continue;
        try {
          compile(expr);
          b.fns.push({ expr, label: str(f.label, 40) });
        } catch (err) {
          warn(`plot "${expr}": ${(err as Error).message}`);
        }
      }
      b.points = Array.isArray(v.points)
        ? v.points
            .slice(0, 40)
            .map((pt) => (Array.isArray(pt) ? { x: num(pt[0]), y: num(pt[1]), label: str(pt[2], 30) } : isObj(pt) ? { x: num(pt.x), y: num(pt.y), label: str(pt.label, 30) } : null))
            .filter((pt): pt is { x: number; y: number; label: string | undefined } => pt !== null && pt.x !== undefined && pt.y !== undefined)
        : undefined;
      if (!b.fns.length && !b.points?.length) return null;
      b.x = range(v.x) ?? [-10, 10];
      b.y = range(v.y);
      b.t = range(v.t);
      b.seconds = Math.min(30, Math.max(1, num(v.seconds) ?? 4));
      b.xLabel = str(v.xLabel, 30);
      b.yLabel = str(v.yLabel, 30);
      return b;
    }
    case 'scene': {
      b.w = Math.min(1600, Math.max(200, num(v.w) ?? 800));
      b.h = Math.min(1200, Math.max(120, num(v.h) ?? 450));
      b.shapes = (Array.isArray(v.shapes) ? v.shapes : []).slice(0, LIMITS.shapes).map(shape).filter((s): s is Shape => s !== null);
      if (!b.shapes.length) return warn('scene needs shapes'), null;
      if (!b.id) b.id = 'scene';
      return b;
    }
    case 'animate': {
      b.target = str(v.target ?? v.scene, 40) ?? 'scene';
      b.changes = (Array.isArray(v.changes) ? v.changes : []).slice(0, LIMITS.changes).map(change).filter((c): c is Change => c !== null);
      if (!b.changes.length) return warn('animate needs changes with shape ids'), null;
      b.seconds = Math.min(30, Math.max(0.2, num(v.seconds) ?? 1.5));
      b.repeat = pick(v.repeat, ['none', 'loop', 'bounce'] as const) ?? 'none';
      return b;
    }
    case 'quote': {
      b.text = str(v.text ?? v.quote, LIMITS.text);
      if (!b.text) return warn('quote needs text'), null;
      return b;
    }
    case 'code': {
      b.code = typeof v.code === 'string' && v.code.trim() ? v.code.replace(/\r\n/g, '\n').replace(/\s+$/, '').slice(0, LIMITS.code) : undefined;
      if (!b.code) return warn('code needs code'), null;
      b.lang = typeof v.lang === 'string' ? v.lang.toLowerCase().replace(/[^a-z0-9+#-]/g, '').slice(0, 20) || undefined : undefined;
      const line = num(v.line);
      if (line !== undefined && line >= 1) b.line = Math.floor(line);
      if (Array.isArray(v.marks)) b.marks = v.marks.map(num).filter((n): n is number => n !== undefined).slice(0, 40);
      return b;
    }
    case 'snip': {
      const x = num(v.x);
      const y = num(v.y);
      const w = num(v.w);
      const h = num(v.h);
      if (x === undefined || y === undefined || !w || !h || w <= 0 || h <= 0) return warn('snip needs x, y, w, h in the screenshot'), null;
      b.rect = { x, y, w, h };
      b.text = str(v.text, 300);
      return b;
    }
    case 'table': {
      const rows = (Array.isArray(v.rows) ? v.rows : [])
        .filter(Array.isArray)
        .slice(0, LIMITS.rows)
        .map((r) => (r as unknown[]).slice(0, LIMITS.cols).map((c) => String(c ?? '').slice(0, 120)));
      if (rows.length < 2) return warn('table needs a header row and at least one row'), null;
      b.rows = rows;
      return b;
    }
  }
}

/** Cleans a whole lesson. Throws if nothing usable is left. */
export function normalizeLesson(input: Record<string, unknown>): { lesson: Lesson; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (m: string) => {
    if (warnings.length < 8) warnings.push(m);
  };
  const raw = Array.isArray(input.steps) ? input.steps : [];
  const steps: Step[] = [];
  // The four parts are for bigger topics; a short explanation may not use them at all.
  const usesParts = raw.some((s) => isObj(s) && pick(s.part, PARTS));
  for (const s of raw.slice(0, LIMITS.steps)) {
    if (!isObj(s)) continue;
    const say = str(s.say ?? s.narration, LIMITS.say) ?? '';
    const shows = Array.isArray(s.show) ? s.show : isObj(s.show) ? [s.show] : [];
    const show = shows
      .slice(0, LIMITS.blocksPerStep)
      .map((b) => normalizeBlock(b, warn))
      .filter((b): b is Block => b !== null);
    if (!say && !show.length) continue;
    // A step without a part continues the previous one; the first step starts with the problem.
    const part = usesParts ? (pick(s.part, PARTS) ?? steps.at(-1)?.part ?? 'problem') : undefined;
    steps.push({ say, show, clear: s.clear === true || undefined, focus: str(s.focus, 40), part });
  }
  if (!steps.length) throw new Error(`The lesson has no usable steps. ${warnings.join('; ')}`.trim());
  return {
    lesson: {
      title: str(input.title, 120) ?? 'Lesson',
      placement: pick(input.placement, PLACEMENTS) ?? 'auto',
      append: input.append === true,
      steps,
    },
    warnings,
  };
}
