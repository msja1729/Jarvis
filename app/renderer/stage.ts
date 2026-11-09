/**
 * Maths stage view: draws an interactive coordinate plane and plays smooth,
 * continuous animations on it in the visual-first style: draw a curve on,
 * slide a parameter and watch everything that depends on it move, bend the
 * whole grid with a matrix, zoom in. Afterwards the student can drag points,
 * move sliders, zoom (click then scroll) and pan.
 *
 * Input is checked data from tools/lesson/stage.ts; expressions use the safe
 * maths reader. Labels are KaTeX (trust off).
 */
import { compile, Fn, Vars } from '../../tools/lesson/expr.js';
import type { Action, Pair, Stage, StageObject, Val } from '../../tools/lesson/stage.js';

type M2 = [[number, number], [number, number]];
const I2: M2 = [
  [1, 0],
  [0, 1],
];
const W = 800;
const SVG = 'http://www.w3.org/2000/svg';

export interface StageEnv {
  color(name: string | undefined, index: number): string;
  tex(src: string, into: HTMLElement): void;
  /** False once the lesson moved on (stop animating). */
  alive(): boolean;
}

/** Smooth start and end, like a hand moving something (smootherstep). */
const smooth = (k: number) => {
  const t = Math.min(1, Math.max(0, k));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const mul = (a: M2, b: M2): M2 => [
  [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
  [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
];
const isIdentity = (m: M2) => Math.abs(m[0][0] - 1) + Math.abs(m[0][1]) + Math.abs(m[1][0]) + Math.abs(m[1][1] - 1) < 1e-6;

function niceStep(span: number, target = 12): number {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => span / s <= target) ?? raw;
}
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

interface Live {
  o: StageObject;
  color: string;
  g: SVGGElement;
  path: SVGPathElement;
  extra: SVGPathElement;
  hit?: SVGCircleElement;
  label?: HTMLDivElement;
  progress: number;
  opacity: number;
  glow: number;
}

export class StageView {
  readonly root: HTMLElement;
  private svg: SVGSVGElement;
  private H: number;
  private view: { x0: number; x1: number; y0: number; y1: number };
  private readonly home: { x0: number; x1: number; y0: number; y1: number };
  private M: M2 = I2;
  vars: Vars = {};
  private fns = new Map<string, Fn>();
  private live = new Map<string, Live>();
  private gridG: SVGGElement;
  private bgG: SVGGElement;
  private axisG: SVGGElement;
  private ticksG: SVGGElement;
  private objG: SVGGElement;
  private overlay: HTMLDivElement;
  private sliders = new Map<string, { input: HTMLInputElement; out: HTMLElement }>();
  private queue: Promise<void> = Promise.resolve();
  private raf = 0;
  private dirty = false;
  private history: Action[] = [];
  /** Set by Replay: animate even though the lesson has moved on. */
  private free = false;
  private live_ = () => this.free || this.env.alive();

  constructor(
    card: HTMLElement,
    private readonly stage: Stage,
    private readonly env: StageEnv,
    /** Objects that appear later through a create action (start hidden). */
    hiddenAtStart: Set<string>,
  ) {
    // equal scale on both axes, like real graph paper
    const xs = stage.x[1] - stage.x[0];
    let ys = stage.y[1] - stage.y[0];
    this.H = Math.round((W * ys) / xs);
    if (this.H > 560 || this.H < 300) {
      this.H = Math.min(560, Math.max(300, this.H));
      ys = (xs * this.H) / W;
    }
    const cy = (stage.y[0] + stage.y[1]) / 2;
    this.home = { x0: stage.x[0], x1: stage.x[1], y0: cy - ys / 2, y1: cy + ys / 2 };
    this.view = { ...this.home };
    for (const p of stage.params) this.vars[p.name] = p.value;

    this.root = document.createElement('div');
    this.root.className = 'stage';
    card.appendChild(this.root);
    const frame = document.createElement('div');
    frame.className = 'stage-frame';
    this.root.appendChild(frame);
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${W} ${this.H}`);
    this.svg.setAttribute('role', 'img');
    frame.appendChild(this.svg);
    const g = (cls: string) => {
      const e = document.createElementNS(SVG, 'g');
      e.setAttribute('class', cls);
      this.svg.appendChild(e);
      return e;
    };
    this.bgG = g('st-bg');
    this.gridG = g('st-grid');
    this.axisG = g('st-axis');
    this.ticksG = g('st-ticks');
    this.objG = g('st-obj');
    this.overlay = document.createElement('div');
    this.overlay.className = 'stage-labels';
    frame.appendChild(this.overlay);

    const names = stage.params.map((p) => p.name);
    const objects: StageObject[] = [...stage.objects];
    if (stage.basis) {
      objects.unshift(
        { id: 'ihat', kind: 'vector', to: [1, 0], color: 'green', tex: '\\hat{\\imath}' },
        { id: 'jhat', kind: 'vector', to: [0, 1], color: 'red', tex: '\\hat{\\jmath}' },
      );
    }
    objects.forEach((o, i) => {
      if (o.kind === 'function' && o.expr) this.fns.set(o.id, compile(o.expr, names));
      const gEl = document.createElementNS(SVG, 'g');
      this.objG.appendChild(gEl);
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('pathLength', '1');
      const extra = document.createElementNS(SVG, 'path');
      gEl.append(extra, path);
      const color = env.color(o.color, i);
      const lv: Live = { o, color, g: gEl, path, extra, progress: hiddenAtStart.has(o.id) ? 0 : 1, opacity: 1, glow: 0 };
      if (o.tex) {
        lv.label = document.createElement('div');
        lv.label.className = 'st-label';
        lv.label.style.color = color;
        env.tex(o.tex, lv.label);
        this.overlay.appendChild(lv.label);
      }
      if (o.kind === 'point' && o.drag) {
        lv.hit = document.createElementNS(SVG, 'circle');
        lv.hit.setAttribute('r', '16');
        lv.hit.setAttribute('class', 'st-hit');
        gEl.appendChild(lv.hit);
        this.dragPoint(lv);
      }
      this.live.set(o.id, lv);
    });

    this.buildControls();
    this.interact();
    this.render();
  }

  /* ---------- evaluation ---------- */

  private val(v: Val | undefined, fallback = 0): number {
    if (v === undefined) return fallback;
    if (typeof v === 'number') return v;
    try {
      const r = compile(v, Object.keys(this.vars))(0, 0, this.vars);
      return Number.isFinite(r) ? r : fallback;
    } catch {
      return fallback;
    }
  }
  private pt(p: Pair | undefined, fallback: [number, number] = [0, 0]): [number, number] {
    return p ? [this.val(p[0], fallback[0]), this.val(p[1], fallback[1])] : fallback;
  }
  /** World point → screen (after the current matrix). */
  private S(x: number, y: number): [number, number] {
    const tx = this.M[0][0] * x + this.M[0][1] * y;
    const ty = this.M[1][0] * x + this.M[1][1] * y;
    const v = this.view;
    return [((tx - v.x0) / (v.x1 - v.x0)) * W, (1 - (ty - v.y0) / (v.y1 - v.y0)) * this.H];
  }
  /** Screen → world (undoing the matrix). Null if the matrix squashes the plane flat. */
  private world(sx: number, sy: number): [number, number] | null {
    const v = this.view;
    const tx = v.x0 + (sx / W) * (v.x1 - v.x0);
    const ty = v.y0 + (1 - sy / this.H) * (v.y1 - v.y0);
    const [[a, b], [c, d]] = this.M;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-9) return null;
    return [(d * tx - b * ty) / det, (-c * tx + a * ty) / det];
  }
  /** World-space box that covers the screen (for sampling curves and grid lines). */
  private worldBox(): { x0: number; x1: number; y0: number; y1: number } {
    const corners = [
      [0, 0],
      [W, 0],
      [0, this.H],
      [W, this.H],
    ].map(([x, y]) => this.world(x, y));
    if (corners.some((c) => !c)) {
      const s = Math.max(this.view.x1 - this.view.x0, this.view.y1 - this.view.y0) * 3;
      return { x0: -s, x1: s, y0: -s, y1: s };
    }
    const xs = corners.map((c) => c![0]);
    const ys = corners.map((c) => c![1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }

  /* ---------- drawing ---------- */

  private request() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => {
      this.dirty = false;
      this.render();
    });
  }

  render() {
    const v = this.view;
    const box = this.worldBox();
    const span = Math.max(v.x1 - v.x0, v.y1 - v.y0);
    const step = niceStep(span);
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      const [a, b] = this.S(x1, y1);
      const [c, d] = this.S(x2, y2);
      return `M${a.toFixed(1)} ${b.toFixed(1)}L${c.toFixed(1)} ${d.toFixed(1)}`;
    };
    // faint fixed grid behind, so a transformation is visible against it
    let bg = '';
    if (this.stage.grid && !isIdentity(this.M)) {
      for (let x = Math.ceil(v.x0 / step) * step; x <= v.x1; x += step) bg += `M${(((x - v.x0) / (v.x1 - v.x0)) * W).toFixed(1)} 0V${this.H}`;
      for (let y = Math.ceil(v.y0 / step) * step; y <= v.y1; y += step) bg += `M0 ${((1 - (y - v.y0) / (v.y1 - v.y0)) * this.H).toFixed(1)}H${W}`;
    }
    this.setPath(this.bgG, 'bg', bg);
    // the grid that moves with the plane
    let grid = '';
    let minor = '';
    if (this.stage.grid) {
      const lim = 400;
      let n = 0;
      for (let x = Math.ceil(box.x0 / step) * step; x <= box.x1 && n < lim; x += step, n++) {
        const l = line(x, box.y0, x, box.y1);
        if (Math.abs(x) > step / 2) grid += l;
        minor += line(x + step / 2, box.y0, x + step / 2, box.y1);
      }
      for (let y = Math.ceil(box.y0 / step) * step; y <= box.y1 && n < lim * 2; y += step, n++) {
        const l = line(box.x0, y, box.x1, y);
        if (Math.abs(y) > step / 2) grid += l;
        minor += line(box.x0, y + step / 2, box.x1, y + step / 2);
      }
    }
    this.setPath(this.gridG, 'minor', minor);
    this.setPath(this.gridG, 'major', grid);
    this.setPath(this.axisG, 'axes', line(box.x0, 0, box.x1, 0) + line(0, box.y0, 0, box.y1));
    // numbers on the axes (only while the plane is not transformed)
    this.ticksG.textContent = '';
    if (isIdentity(this.M)) {
      const [ox, oy] = this.S(0, 0);
      const ty = Math.min(this.H - 6, Math.max(14, oy + 16));
      const tx = Math.min(W - 6, Math.max(26, ox - 6));
      for (let x = Math.ceil(v.x0 / step) * step; x <= v.x1; x += step) {
        if (Math.abs(x) < step / 2) continue;
        const t = document.createElementNS(SVG, 'text');
        t.setAttribute('x', String(this.S(x, 0)[0]));
        t.setAttribute('y', String(ty));
        t.setAttribute('text-anchor', 'middle');
        t.textContent = fmt(x);
        this.ticksG.appendChild(t);
      }
      for (let y = Math.ceil(v.y0 / step) * step; y <= v.y1; y += step) {
        if (Math.abs(y) < step / 2) continue;
        const t = document.createElementNS(SVG, 'text');
        t.setAttribute('x', String(tx));
        t.setAttribute('y', String(this.S(0, y)[1] + 4));
        t.setAttribute('text-anchor', 'end');
        t.textContent = fmt(y);
        this.ticksG.appendChild(t);
      }
    }
    for (const lv of this.live.values()) this.drawObject(lv, box);
  }

  private setPath(g: SVGGElement, cls: string, d: string) {
    let p = g.querySelector<SVGPathElement>(`path.${cls}`);
    if (!p) {
      p = document.createElementNS(SVG, 'path');
      p.setAttribute('class', cls);
      g.appendChild(p);
    }
    p.setAttribute('d', d);
  }

  private curve(f: (s: number) => [number, number] | null, s0: number, s1: number, n: number): string {
    let d = '';
    let pen = false;
    let prev: [number, number] | null = null;
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const p = f(s);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        pen = false;
        prev = null;
        continue;
      }
      const [sx, sy] = this.S(p[0], p[1]);
      // lift the pen at jumps (e.g. tan crossing an asymptote)
      if (prev && Math.abs(sy - prev[1]) > this.H * 1.5) pen = false;
      const cy = Math.max(-5000, Math.min(5000, sy));
      d += `${pen ? 'L' : 'M'}${sx.toFixed(1)} ${cy.toFixed(1)}`;
      pen = true;
      prev = [sx, sy];
    }
    return d;
  }

  private fnOf(id: string | undefined): ((x: number) => number) | null {
    const f = id ? this.fns.get(id) : undefined;
    return f ? (x: number) => f(x, 0, this.vars) : null;
  }

  private drawObject(lv: Live, box: { x0: number; x1: number; y0: number; y1: number }) {
    const o = lv.o;
    let d = '';
    let fill = '';
    let labelAt: [number, number] | null = null;
    let closed = false;
    switch (o.kind) {
      case 'function': {
        const f = this.fnOf(o.id);
        if (f) d = this.curve((x) => [x, f(x)], box.x0, box.x1, 480);
        if (f) {
          const lx = box.x0 + (box.x1 - box.x0) * 0.82;
          labelAt = [lx, f(lx)];
        }
        break;
      }
      case 'parametric': {
        const names = Object.keys(this.vars);
        try {
          const fx = compile(o.xt!, names);
          const fy = compile(o.yt!, names);
          const [t0, t1] = o.range ?? [0, 2 * Math.PI];
          d = this.curve((t) => [fx(0, t, this.vars), fy(0, t, this.vars)], t0, t1, 400);
          labelAt = [fx(0, t1, this.vars), fy(0, t1, this.vars)];
        } catch {
          /* checked before; ignore */
        }
        break;
      }
      case 'vector': {
        const [x0, y0] = this.pt(o.from);
        const [x1, y1] = this.pt(o.to);
        const [a, b] = this.S(x0, y0);
        const [c, e] = this.S(x1, y1);
        const len = Math.hypot(c - a, e - b);
        if (len > 1) {
          const ux = (c - a) / len;
          const uy = (e - b) / len;
          const head = Math.min(16, len * 0.4);
          const bx = c - ux * head;
          const by = e - uy * head;
          d = `M${a} ${b}L${bx} ${by}`;
          fill = `M${c} ${e}L${bx - uy * head * 0.45} ${by + ux * head * 0.45}L${bx + uy * head * 0.45} ${by - ux * head * 0.45}Z`;
        }
        labelAt = [x1, y1];
        break;
      }
      case 'point': {
        const [x, y] = this.pt(o.at);
        const [sx, sy] = this.S(x, y);
        fill = `M${sx - 6} ${sy}a6 6 0 1 0 12 0a6 6 0 1 0 -12 0`;
        lv.hit?.setAttribute('cx', String(sx));
        lv.hit?.setAttribute('cy', String(sy));
        labelAt = [x, y];
        break;
      }
      case 'line':
      case 'segment': {
        let [x0, y0] = this.pt(o.from);
        let [x1, y1] = this.pt(o.to);
        if (o.kind === 'line') {
          const dx = x1 - x0;
          const dy = y1 - y0;
          const big = (box.x1 - box.x0 + box.y1 - box.y0) * 2;
          const n = Math.hypot(dx, dy) || 1;
          [x0, y0, x1, y1] = [x0 - (dx / n) * big, y0 - (dy / n) * big, x1 + (dx / n) * big, y1 + (dy / n) * big];
        }
        const [a, b] = this.S(x0, y0);
        const [c, e] = this.S(x1, y1);
        d = `M${a} ${b}L${c} ${e}`;
        labelAt = this.pt(o.to);
        break;
      }
      case 'tangent': {
        const f = this.fnOf(o.of);
        if (!f) break;
        const a = this.val(o.a);
        const y = f(a);
        const h = 1e-4 * Math.max(1, Math.abs(a));
        const slope = (f(a + h) - f(a - h)) / (2 * h);
        if (!Number.isFinite(y) || !Number.isFinite(slope)) break;
        const r = (box.x1 - box.x0) * 0.22;
        const k = r / Math.sqrt(1 + slope * slope);
        const [p, q] = this.S(a - k, y - slope * k);
        const [s, t] = this.S(a + k, y + slope * k);
        d = `M${p} ${q}L${s} ${t}`;
        const [cx, cy] = this.S(a, y);
        fill = `M${cx - 5} ${cy}a5 5 0 1 0 10 0a5 5 0 1 0 -10 0`;
        labelAt = [a + k, y + slope * k];
        break;
      }
      case 'area': {
        const f = this.fnOf(o.of);
        if (!f) break;
        const a = this.val(o.a);
        const b = this.val(o.b, 1);
        const n = 160;
        const pts: string[] = [];
        const [sa, s0] = this.S(a, 0);
        pts.push(`M${sa} ${s0}`);
        for (let i = 0; i <= n; i++) {
          const x = a + ((b - a) * i) / n;
          const y = f(x);
          const [sx, sy] = this.S(x, Number.isFinite(y) ? y : 0);
          pts.push(`L${sx} ${sy}`);
        }
        const [sb, s1] = this.S(b, 0);
        pts.push(`L${sb} ${s1}Z`);
        fill = pts.join('');
        closed = true;
        labelAt = [(a + b) / 2, f((a + b) / 2) / 2];
        break;
      }
      case 'riemann': {
        const f = this.fnOf(o.of);
        if (!f) break;
        const a = this.val(o.a);
        const b = this.val(o.b, 1);
        const n = Math.max(1, Math.min(200, Math.round(this.val(o.n, 8))));
        const w = (b - a) / n;
        const shown = Math.ceil(lv.progress * n);
        for (let i = 0; i < shown; i++) {
          const x = a + w * i;
          const y = f(x + w / 2);
          if (!Number.isFinite(y)) continue;
          const c = [this.S(x, 0), this.S(x, y), this.S(x + w, y), this.S(x + w, 0)];
          fill += `M${c[0][0]} ${c[0][1]}L${c[1][0]} ${c[1][1]}L${c[2][0]} ${c[2][1]}L${c[3][0]} ${c[3][1]}Z`;
        }
        closed = true;
        break;
      }
      case 'circle': {
        const [cx, cy] = this.pt(o.center);
        const r = this.val(o.r, 1);
        d = this.curve((s) => [cx + r * Math.cos(s), cy + r * Math.sin(s)], 0, 2 * Math.PI, 160);
        labelAt = [cx + r * 0.72, cy + r * 0.72];
        break;
      }
      case 'polygon': {
        const pts = (o.points ?? []).map((p) => this.pt(p)).map(([x, y]) => this.S(x, y));
        d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('') + 'Z';
        if (o.fill) fill = d;
        closed = Boolean(o.fill);
        const c = (o.points ?? []).map((p) => this.pt(p));
        labelAt = [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length];
        break;
      }
      case 'label':
        labelAt = this.pt(o.at);
        break;
    }
    // stroke, drawn on as progress goes 0 → 1
    lv.path.setAttribute('d', d);
    lv.path.setAttribute('fill', 'none');
    lv.path.setAttribute('stroke', lv.color);
    lv.path.setAttribute('stroke-width', String((o.kind === 'function' || o.kind === 'parametric' ? 3 : 2.6) + lv.glow * 2));
    lv.path.setAttribute('stroke-linecap', 'round');
    lv.path.setAttribute('stroke-linejoin', 'round');
    const dash = o.dashed ? '0.012 0.01' : '1';
    lv.path.setAttribute('stroke-dasharray', o.dashed ? dash : '1 1');
    lv.path.setAttribute('stroke-dashoffset', o.dashed ? '0' : String(1 - lv.progress));
    if (o.dashed) lv.path.style.opacity = String(lv.progress);
    // filled parts (arrow heads, dots, areas) fade in
    lv.extra.setAttribute('d', fill);
    lv.extra.setAttribute('fill', lv.color);
    lv.extra.setAttribute('fill-opacity', String((closed ? 0.32 : 1) * (o.kind === 'riemann' ? 1 : lv.progress)));
    lv.extra.setAttribute('stroke', closed ? lv.color : 'none');
    lv.extra.setAttribute('stroke-opacity', String(0.8 * lv.progress));
    lv.g.style.opacity = String(lv.opacity);
    lv.g.style.filter = lv.glow > 0 ? `drop-shadow(0 0 ${6 + lv.glow * 10}px ${lv.color})` : '';
    if (lv.label) {
      if (labelAt && Number.isFinite(labelAt[0]) && Number.isFinite(labelAt[1])) {
        const [lx, ly] = this.S(labelAt[0], labelAt[1]);
        lv.label.style.left = `${(lx / W) * 100}%`;
        lv.label.style.top = `${(ly / this.H) * 100}%`;
        lv.label.style.opacity = String(lv.progress * lv.opacity);
        lv.label.style.display = lx < -40 || lx > W + 40 || ly < -40 || ly > this.H + 40 ? 'none' : '';
      } else lv.label.style.display = 'none';
    }
  }

  /* ---------- sliders and interaction ---------- */

  private buildControls() {
    const bar = document.createElement('div');
    bar.className = 'stage-controls';
    this.root.appendChild(bar);
    for (const p of this.stage.params) {
      const row = document.createElement('label');
      row.className = 'st-slider';
      const name = document.createElement('span');
      name.className = 'st-name';
      this.env.tex(p.label ?? p.name, name);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(p.min);
      input.max = String(p.max);
      input.step = String(p.step);
      input.value = String(p.value);
      const out = document.createElement('output');
      out.textContent = String(p.value);
      input.addEventListener('input', () => {
        this.vars[p.name] = Number(input.value);
        out.textContent = this.shown(p.name);
        this.request();
      });
      row.append(name, input, out);
      bar.appendChild(row);
      this.sliders.set(p.name, { input, out });
    }
    const tools = document.createElement('div');
    tools.className = 'st-tools';
    const hint = document.createElement('span');
    hint.className = 'st-hint';
    const draggable = this.stage.objects.some((o) => o.drag);
    hint.textContent = `${draggable ? 'Drag the points · ' : ''}${this.stage.params.length ? 'move the sliders · ' : ''}click, then scroll to zoom · drag to pan`;
    const replay = document.createElement('button');
    replay.className = 'chip';
    replay.textContent = 'Replay';
    replay.addEventListener('click', () => this.replay());
    const reset = document.createElement('button');
    reset.className = 'chip';
    reset.textContent = 'Reset view';
    reset.addEventListener('click', () => {
      this.view = { ...this.home };
      this.request();
    });
    tools.append(hint, reset, replay);
    this.root.appendChild(tools);
  }

  private syncSlider(name: string) {
    const s = this.sliders.get(name);
    if (!s) return;
    s.input.value = String(this.vars[name]);
    s.out.textContent = this.shown(name);
  }

  /** A parameter's value rounded to its slider step (n = 24, not 23.961). */
  private shown(name: string): string {
    const p = this.stage.params.find((q) => q.name === name);
    const v = this.vars[name];
    if (!p) return fmt(v);
    const decimals = p.step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(p.step)));
    return (Math.round(v / p.step) * p.step).toFixed(decimals);
  }

  private toScreen(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.svg.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * this.H];
  }

  private dragPoint(lv: Live) {
    const hit = lv.hit!;
    hit.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      try {
        hit.setPointerCapture(e.pointerId);
      } catch {
        /* moves are followed on the window anyway */
      }
      this.root.classList.add('dragging');
      const move = (ev: PointerEvent) => {
        const w = this.world(...this.toScreen(ev));
        if (!w) return;
        const set = (name: string | undefined, v: number) => {
          if (!name) return;
          const p = this.stage.params.find((q) => q.name === name);
          if (!p) return;
          const snapped = Math.round(v / p.step) * p.step;
          this.vars[name] = Math.min(p.max, Math.max(p.min, snapped));
          this.syncSlider(name);
        };
        set(lv.o.drag?.x, w[0]);
        set(lv.o.drag?.y, w[1]);
        this.request();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.root.classList.remove('dragging');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  private interact() {
    let pan: { x: number; y: number; view: StageView['view'] } | null = null;
    this.svg.addEventListener('pointerdown', (e) => {
      this.root.classList.add('active'); // scrolling now zooms the stage instead of the page
      const [x, y] = this.toScreen(e);
      pan = { x, y, view: { ...this.view } };
      try {
        this.svg.setPointerCapture(e.pointerId);
      } catch {
        /* panning still works while the pointer stays over the stage */
      }
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!pan) return;
      const [x, y] = this.toScreen(e);
      const dx = ((x - pan.x) / W) * (pan.view.x1 - pan.view.x0);
      const dy = ((y - pan.y) / this.H) * (pan.view.y1 - pan.view.y0);
      this.view = { x0: pan.view.x0 - dx, x1: pan.view.x1 - dx, y0: pan.view.y0 + dy, y1: pan.view.y1 + dy };
      this.request();
    });
    this.svg.addEventListener('pointerup', () => (pan = null));
    this.root.addEventListener('pointerleave', () => this.root.classList.remove('active'));
    this.svg.addEventListener(
      'wheel',
      (e) => {
        if (!this.root.classList.contains('active')) return;
        e.preventDefault();
        const [sx, sy] = this.toScreen(e);
        const v = this.view;
        const cx = v.x0 + (sx / W) * (v.x1 - v.x0);
        const cy = v.y0 + (1 - sy / this.H) * (v.y1 - v.y0);
        const k = Math.exp(e.deltaY * 0.0015);
        this.view = { x0: cx - (cx - v.x0) * k, x1: cx + (v.x1 - cx) * k, y0: cy - (cy - v.y0) * k, y1: cy + (v.y1 - cy) * k };
        this.request();
      },
      { passive: false },
    );
    this.svg.addEventListener('dblclick', () => {
      this.view = { ...this.home };
      this.request();
    });
  }

  /* ---------- animation ---------- */

  /** Runs over `ms` milliseconds, calling step(k) with k going 0 → 1 (eased). */
  private tween(ms: number, step: (k: number) => void, animate: boolean): Promise<void> {
    if (!animate || ms <= 0) {
      step(1);
      this.render();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now: number) => {
        if (!this.live_() || !this.root.isConnected) {
          step(1);
          resolve();
          return;
        }
        const k = Math.min(1, (now - start) / ms);
        step(smooth(k));
        this.render();
        if (k < 1) this.raf = requestAnimationFrame(frame);
        else resolve();
      };
      this.raf = requestAnimationFrame(frame);
    });
  }

  private async act(a: Action, animate: boolean, scale: number): Promise<void> {
    const ms = (s: number | undefined, d: number) => (s ?? d) * 1000 * scale;
    const ids = (a.ids ?? []).filter((id) => this.live.has(id));
    switch (a.do) {
      case 'create': {
        const total = ms(a.seconds, 1.2 + 0.25 * Math.max(0, ids.length - 1));
        const each = ids.length > 1 ? total * 0.6 : total;
        const gap = ids.length > 1 ? (total - each) / (ids.length - 1) : 0;
        await this.tween(
          total,
          (k) => {
            ids.forEach((id, i) => {
              const lv = this.live.get(id)!;
              const local = total ? Math.min(1, Math.max(0, (k * total - i * gap) / each)) : 1;
              lv.progress = Math.max(lv.progress, local);
              lv.opacity = 1;
            });
          },
          animate,
        );
        break;
      }
      case 'show':
        for (const id of ids) Object.assign(this.live.get(id)!, { progress: 1, opacity: 1 });
        this.render();
        break;
      case 'fade': {
        const start = ids.map((id) => this.live.get(id)!.opacity);
        await this.tween(ms(a.seconds, 0.7), (k) => ids.forEach((id, i) => (this.live.get(id)!.opacity = lerp(start[i], 0, k))), animate);
        break;
      }
      case 'highlight': {
        const dur = ms(a.seconds, 1.4);
        await this.tween(dur, (k) => ids.forEach((id) => (this.live.get(id)!.glow = Math.sin(Math.PI * k))), animate);
        ids.forEach((id) => (this.live.get(id)!.glow = 0));
        this.render();
        break;
      }
      case 'set': {
        const name = a.param!;
        if (!(name in this.vars)) break;
        const from = this.vars[name];
        await this.tween(
          ms(a.seconds, 2),
          (k) => {
            this.vars[name] = lerp(from, a.to!, k);
            this.syncSlider(name);
          },
          animate,
        );
        break;
      }
      case 'matrix': {
        // the whole plane moves: grid, vectors, curves (entries interpolate smoothly)
        const from = this.M;
        const to = mul(a.m!, from);
        await this.tween(
          ms(a.seconds, 2.2),
          (k) =>
            (this.M = [
              [lerp(from[0][0], to[0][0], k), lerp(from[0][1], to[0][1], k)],
              [lerp(from[1][0], to[1][0], k), lerp(from[1][1], to[1][1], k)],
            ]),
          animate,
        );
        break;
      }
      case 'zoom': {
        const from = { ...this.view };
        const aspect = this.H / W;
        let x = a.x ?? null;
        let y = a.y ?? null;
        if (x && !y) {
          const cy = (from.y0 + from.y1) / 2;
          const h = (x[1] - x[0]) * aspect;
          y = [cy - h / 2, cy + h / 2];
        } else if (y && !x) {
          const cx = (from.x0 + from.x1) / 2;
          const w = (y[1] - y[0]) / aspect;
          x = [cx - w / 2, cx + w / 2];
        }
        const to = { x0: x![0], x1: x![1], y0: y![0], y1: y![1] };
        await this.tween(ms(a.seconds, 1.6), (k) => (this.view = { x0: lerp(from.x0, to.x0, k), x1: lerp(from.x1, to.x1, k), y0: lerp(from.y0, to.y0, k), y1: lerp(from.y1, to.y1, k) }), animate);
        break;
      }
      case 'wait':
        if (animate) await new Promise((r) => setTimeout(r, ms(a.seconds, 1)));
        break;
    }
  }

  /** Expected length of a list of actions (seconds), used to fit them to the narration. */
  static duration(actions: Action[]): number {
    const d: Record<string, number> = { create: 1.2, show: 0, fade: 0.7, highlight: 1.4, set: 2, matrix: 2.2, zoom: 1.6, wait: 1 };
    return actions.reduce((s, a) => s + (a.seconds ?? d[a.do] ?? 1) + (a.do === 'create' && !a.seconds ? 0.25 * Math.max(0, (a.ids?.length ?? 1) - 1) : 0), 0);
  }

  /**
   * Plays actions one after another (queued behind any still running).
   * When animating, they are sped up if needed to fit in `fitMs` (the narration).
   */
  play(actions: Action[], animate: boolean, fitMs: number | null): Promise<void> {
    this.history.push(...actions);
    const total = StageView.duration(actions) * 1000;
    const scale = animate && fitMs && total > fitMs ? Math.max(0.45, fitMs / total) : 1;
    this.queue = this.queue.then(async () => {
      for (const a of actions) {
        if (animate && !this.live_()) {
          await this.act(a, false, 1); // the lesson moved on: jump to the end state
          continue;
        }
        await this.act(a, animate, scale);
      }
    });
    return this.queue;
  }

  /** Back to the start state, then plays everything again. */
  private replay() {
    cancelAnimationFrame(this.raf);
    const all = this.history;
    this.history = [];
    this.M = I2;
    this.view = { ...this.home };
    for (const p of this.stage.params) {
      this.vars[p.name] = p.value;
      this.syncSlider(p.name);
    }
    const created = new Set(all.filter((a) => a.do === 'create').flatMap((a) => a.ids ?? []));
    for (const lv of this.live.values()) Object.assign(lv, { progress: created.has(lv.o.id) ? 0 : 1, opacity: 1, glow: 0 });
    this.queue = Promise.resolve();
    this.free = true;
    this.render();
    void this.play(all, true, null);
  }
}
