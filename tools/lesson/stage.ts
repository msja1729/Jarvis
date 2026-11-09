/**
 * Maths stage: an animated, interactive coordinate plane for visual-first
 * explanations (geometry before algebra). Claude describes objects (graphs,
 * vectors, points, tangents, areas, Riemann sums...) using named parameters,
 * and a list of actions (draw, slide a parameter, apply a matrix to the whole
 * plane, zoom...). The student can then drag points, move sliders, zoom and pan.
 *
 * Everything here is plain data checked against fixed lists; expressions go
 * through the safe maths reader in expr.ts.
 */
import { compile, PARAM_NAME } from './expr.js';

export const OBJECT_KINDS = ['function', 'parametric', 'vector', 'point', 'line', 'segment', 'tangent', 'area', 'riemann', 'circle', 'polygon', 'label'] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];
export const ACTION_KINDS = ['create', 'set', 'matrix', 'highlight', 'fade', 'show', 'zoom', 'wait'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const STAGE_LIMITS = { objects: 30, params: 6, actions: 24, points: 24 } as const;

/** A number, or an expression using the stage's parameters (e.g. "a", "a^2", "2cos(theta)"). */
export type Val = number | string;
export type Pair = [Val, Val];

export interface Param {
  name: string;
  min: number;
  max: number;
  value: number;
  step: number;
  /** LaTeX label for the slider, e.g. "\\theta". */
  label?: string;
}

export interface StageObject {
  id: string;
  kind: ObjectKind;
  color?: string;
  /** function: y = f(x); tangent/area/riemann: id of the function they belong to. */
  expr?: string;
  of?: string;
  /** parametric: x(t), y(t) for t in range. */
  xt?: string;
  yt?: string;
  range?: [number, number];
  at?: Pair;
  from?: Pair;
  to?: Pair;
  center?: Pair;
  r?: Val;
  /** tangent: x where it touches; area/riemann: from a to b, n rectangles. */
  a?: Val;
  b?: Val;
  n?: Val;
  points?: Pair[];
  /** LaTeX label drawn next to the object (or the text of a label object). */
  tex?: string;
  /** point: which parameters dragging it changes. */
  drag?: { x?: string; y?: string };
  dashed?: boolean;
  fill?: boolean;
}

export interface Action {
  do: ActionKind;
  ids?: string[];
  param?: string;
  to?: number;
  m?: [[number, number], [number, number]];
  x?: [number, number];
  y?: [number, number];
  seconds?: number;
}

export interface Stage {
  x: [number, number];
  y: [number, number];
  grid: boolean;
  /** Show the basis vectors i-hat and j-hat (for linear algebra). */
  basis: boolean;
  params: Param[];
  objects: StageObject[];
  actions: Action[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const range = (v: unknown): [number, number] | undefined => {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const a = num(v[0]);
  const b = num(v[1]);
  return a !== undefined && b !== undefined && a !== b ? [Math.min(a, b), Math.max(a, b)] : undefined;
};

/** Checks a value: a number, or an expression of the parameters (no x). */
function val(v: unknown, names: string[], what: string, warn: (m: string) => void): Val | undefined {
  const n = num(v);
  if (n !== undefined) return n;
  if (typeof v !== 'string' || !v.trim()) return undefined;
  try {
    compile(v, names);
    return v.trim().slice(0, 200);
  } catch (err) {
    warn(`${what} "${v}": ${(err as Error).message}`);
    return undefined;
  }
}

function pair(v: unknown, names: string[], what: string, warn: (m: string) => void): Pair | undefined {
  const arr = Array.isArray(v) ? v : isObj(v) ? [v.x, v.y] : null;
  if (!arr || arr.length !== 2) return undefined;
  const a = val(arr[0], names, what, warn);
  const b = val(arr[1], names, what, warn);
  return a !== undefined && b !== undefined ? [a, b] : undefined;
}

function expr(v: unknown, names: string[], what: string, warn: (m: string) => void): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  try {
    compile(v, names);
    return v.trim().slice(0, 200);
  } catch (err) {
    warn(`${what} "${v}": ${(err as Error).message}`);
    return undefined;
  }
}

export function normalizeParams(v: unknown): Param[] {
  const out: Param[] = [];
  for (const p of (Array.isArray(v) ? v : []).slice(0, STAGE_LIMITS.params)) {
    if (!isObj(p)) continue;
    const name = typeof p.name === 'string' ? p.name.trim().toLowerCase() : '';
    if (!PARAM_NAME.test(name) || ['x', 't', 'e', 'pi', 'tau'].includes(name) || out.some((q) => q.name === name)) continue;
    const min = num(p.min) ?? -5;
    const max = num(p.max) ?? 5;
    if (!(max > min)) continue;
    const value = Math.min(max, Math.max(min, num(p.value) ?? min));
    const step = num(p.step) && num(p.step)! > 0 ? num(p.step)! : (max - min) / 100;
    out.push({ name, min, max, value, step, label: str(p.label, 40) });
  }
  return out;
}

export function normalizeActions(v: unknown, names: string[], warn: (m: string) => void): Action[] {
  const out: Action[] = [];
  for (const a of (Array.isArray(v) ? v : []).slice(0, STAGE_LIMITS.actions)) {
    if (!isObj(a)) continue;
    const kind = (ACTION_KINDS as readonly string[]).includes(a.do as string) ? (a.do as ActionKind) : undefined;
    if (!kind) {
      warn(`unknown stage action "${String(a.do)}"`);
      continue;
    }
    const act: Action = { do: kind };
    const seconds = num(a.seconds);
    if (seconds !== undefined) act.seconds = Math.min(20, Math.max(0, seconds));
    if (Array.isArray(a.ids)) act.ids = a.ids.filter((i): i is string => typeof i === 'string').map((i) => i.slice(0, 40)).slice(0, 30);
    else if (typeof a.id === 'string') act.ids = [a.id.slice(0, 40)];
    if (kind === 'set') {
      const p = typeof a.param === 'string' ? a.param.trim().toLowerCase() : '';
      const to = num(a.to);
      if (!p || to === undefined) {
        warn('set needs param and to');
        continue;
      }
      if (names.length && !names.includes(p)) warn(`set: no parameter "${p}" on this stage`);
      act.param = p;
      act.to = to;
    }
    if (kind === 'matrix') {
      const m = a.m ?? a.matrix;
      const flat = Array.isArray(m) ? m.flat().map(num) : [];
      if (flat.length !== 4 || flat.some((x) => x === undefined)) {
        warn('matrix needs m: [[a, b], [c, d]]');
        continue;
      }
      const [p, q, r, s] = flat as number[];
      act.m = [
        [p, q],
        [r, s],
      ];
    }
    if (kind === 'zoom') {
      act.x = range(a.x);
      act.y = range(a.y);
      if (!act.x && !act.y) continue;
    }
    if ((kind === 'create' || kind === 'highlight' || kind === 'fade' || kind === 'show') && !act.ids?.length) continue;
    out.push(act);
  }
  return out;
}

export function normalizeStage(v: Record<string, unknown>, warn: (m: string) => void): Stage | null {
  const x = range(v.x) ?? [-6, 6];
  const y = range(v.y) ?? [-4, 4];
  const params = normalizeParams(v.params);
  const names = params.map((p) => p.name);
  const objects: StageObject[] = [];
  const ids = new Set<string>();
  for (const o of (Array.isArray(v.objects) ? v.objects : []).slice(0, STAGE_LIMITS.objects)) {
    if (!isObj(o)) continue;
    const kind = (OBJECT_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as ObjectKind) : undefined;
    if (!kind) {
      warn(`unknown stage object "${String(o.kind)}"`);
      continue;
    }
    const id = (typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `${kind}${objects.length + 1}`).slice(0, 40);
    if (ids.has(id)) continue;
    const obj: StageObject = { id, kind };
    if (typeof o.color === 'string') obj.color = o.color.trim().toLowerCase().slice(0, 20);
    obj.tex = str(o.tex ?? o.label, 120);
    if (o.dashed === true) obj.dashed = true;
    if (o.fill === true) obj.fill = true;
    const W = (k: string) => `${kind} ${id} ${k}`;
    let ok = true;
    switch (kind) {
      case 'function':
        obj.expr = expr(o.expr, names, W('expr'), warn);
        ok = Boolean(obj.expr);
        break;
      case 'parametric':
        obj.xt = expr(o.xt ?? o.x, names, W('x(t)'), warn);
        obj.yt = expr(o.yt ?? o.y, names, W('y(t)'), warn);
        obj.range = range(o.range ?? o.t) ?? [0, 2 * Math.PI];
        ok = Boolean(obj.xt && obj.yt);
        break;
      case 'vector':
        obj.from = pair(o.from, names, W('from'), warn);
        obj.to = pair(o.to ?? o.at, names, W('to'), warn);
        ok = Boolean(obj.to);
        break;
      case 'point':
      case 'label':
        obj.at = pair(o.at, names, W('at'), warn);
        ok = Boolean(obj.at) && (kind === 'point' || Boolean(obj.tex));
        if (kind === 'point' && isObj(o.drag)) {
          const dx = typeof o.drag.x === 'string' && names.includes(o.drag.x.toLowerCase()) ? o.drag.x.toLowerCase() : undefined;
          const dy = typeof o.drag.y === 'string' && names.includes(o.drag.y.toLowerCase()) ? o.drag.y.toLowerCase() : undefined;
          if (dx || dy) obj.drag = { x: dx, y: dy };
        }
        break;
      case 'line':
      case 'segment':
        obj.from = pair(o.from, names, W('from'), warn);
        obj.to = pair(o.to, names, W('to'), warn);
        ok = Boolean(obj.from && obj.to);
        break;
      case 'tangent':
      case 'area':
      case 'riemann':
        obj.of = typeof o.of === 'string' ? o.of.slice(0, 40) : undefined;
        ok = Boolean(obj.of && objects.some((q) => q.id === obj.of && q.kind === 'function'));
        if (!ok) warn(`${kind} ${id}: "of" must be the id of a function defined before it`);
        obj.a = val(o.a ?? o.at ?? o.from, names, W('a'), warn) ?? 0;
        if (kind !== 'tangent') obj.b = val(o.b ?? o.to, names, W('b'), warn) ?? 1;
        if (kind === 'riemann') obj.n = val(o.n, names, W('n'), warn) ?? 8;
        break;
      case 'circle':
        obj.center = pair(o.center ?? o.at, names, W('center'), warn) ?? [0, 0];
        obj.r = val(o.r, names, W('r'), warn) ?? 1;
        break;
      case 'polygon':
        obj.points = (Array.isArray(o.points) ? o.points : [])
          .slice(0, STAGE_LIMITS.points)
          .map((p) => pair(p, names, W('point'), warn))
          .filter((p): p is Pair => p !== undefined);
        ok = obj.points.length >= 2;
        break;
    }
    if (!ok) continue;
    ids.add(id);
    objects.push(obj);
  }
  if (!objects.length && !v.basis) {
    warn('stage needs objects');
    return null;
  }
  return { x, y, grid: v.grid !== false, basis: v.basis === true, params, objects, actions: normalizeActions(v.actions, names, warn) };
}
