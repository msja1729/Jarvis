/**
 * Lesson window: plays a lesson step by step. Each step's narration is spoken
 * (natural voice, or the OS voice) while its visuals appear and animate.
 * Everything here draws from plain data checked by tools/lesson/spec.ts;
 * no text from Claude is ever inserted as HTML except through Mermaid (strict
 * mode, sanitised) and KaTeX (trust off), which produce markup themselves.
 */
import mermaid from 'mermaid';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import { Narrator, NarratorApi } from './narrator.js';
import { StageView } from './stage.js';
import { compile, Fn } from '../../tools/lesson/expr.js';
import type { Block, Change, Lesson, Part, Shape } from '../../tools/lesson/spec.js';

const PART_NAMES: Record<Part, string> = { problem: 'The problem', intuition: 'The intuition', solution: 'The solution', recap: 'Recap' };
const PART_NUM: Record<Part, number> = { problem: 1, intuition: 2, solution: 3, recap: 4 };

interface LessonApi extends NarratorApi {
  onTtsStopAll(cb: () => void): void;
  onLesson(cb: (p: { lesson: Lesson; side: 'left' | 'right' | 'full' }) => void): void;
  onLessonPlaced(cb: (side: 'left' | 'right' | 'full') => void): void;
  lessonClose(): void;
  lessonLayout(want: 'full' | 'side'): void;
  lessonReady(): void;
}
const j = (window as unknown as { jarvis: LessonApi }).jarvis;
const narrator = new Narrator(j);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SVG = 'http://www.w3.org/2000/svg';
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: Element): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- colours (validated dark categorical palette) ---------- */
const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
const NAMED: Record<string, string> = {
  blue: '#3987e5',
  orange: '#d95926',
  green: '#199e70',
  yellow: '#c98500',
  pink: '#d55181',
  violet: '#9085e9',
  red: '#e66767',
  gray: '#8d8d8d',
  white: '#f0efec',
};
const SURFACE = '#1b1b1b';
const col = (c: string | undefined, fallback = NAMED.blue) => (c ? (NAMED[c] ?? (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback)) : fallback);

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  themeVariables: {
    darkMode: true,
    background: SURFACE,
    fontSize: '15px',
    primaryColor: '#1f3350',
    primaryTextColor: '#f0efec',
    primaryBorderColor: '#3987e5',
    secondaryColor: '#3a2618',
    secondaryBorderColor: '#d95926',
    tertiaryColor: '#15342a',
    tertiaryBorderColor: '#199e70',
    lineColor: '#9a9a96',
    textColor: '#f0efec',
    mainBkg: '#1f3350',
    nodeBorder: '#3987e5',
    clusterBkg: '#202020',
    clusterBorder: '#3a3a3a',
    edgeLabelBackground: '#1b1b1b',
    actorBkg: '#1f3350',
    actorBorder: '#3987e5',
    actorTextColor: '#f0efec',
    signalColor: '#c9c8c2',
    signalTextColor: '#f0efec',
    noteBkgColor: '#2a2440',
    noteTextColor: '#f0efec',
    noteBorderColor: '#9085e9',
  },
});

/* ---------- state ---------- */
let lesson: Lesson | null = null;
/** Set when a step's animation already scrolled the page to an earlier stage. */
let scrolledByPlay = false;
/** Each distinct source gets a number, in the order it first appears: [1], [2]... */
let sources = new Map<string, number>();
function numberSources() {
  sources = new Map();
  for (const st of lesson?.steps ?? []) for (const b of st.show) if (b.source && !sources.has(b.source)) sources.set(b.source, sources.size + 1);
}
let idx = -1;
let playing = false;
let done = false;
let token = 0; // bumps whenever playback jumps, so stale callbacks do nothing
let mermaidSeq = 0;
const loops = new Set<number>(); // running animation frames (plots, scenes)
const scenes = new Map<string, SceneState>();
const stages = new Map<string, StageView>();

/** Renders inline LaTeX; anything KaTeX cannot handle is shown as plain text instead of breaking the picture. */
function texSafe(src: string, into: HTMLElement) {
  try {
    katex.render(src, into, katexOpts(false));
  } catch {
    into.textContent = src;
  }
}

/** KaTeX settings: never trusted, plus colour commands so a symbol can share its picture's colour, e.g. \blue{x}. */
function katexOpts(displayMode: boolean) {
  const macros: Record<string, string> = {};
  // hex without '#': inside a macro, '#3' would mean "argument 3"
  for (const [name, hex] of Object.entries(NAMED)) macros[`\\${name}`] = `\\textcolor{${hex.slice(1)}}{#1}`;
  return { displayMode, throwOnError: false, trust: false, strict: 'ignore' as const, macros };
}
const page = $('page');
const board = $('board');

function stopLoops() {
  for (const id of loops) cancelAnimationFrame(id);
  loops.clear();
  for (const s of scenes.values()) s.stopAll();
  stages.clear();
}

/* ---------- inline text: **bold**, *italic*, `code`, $math$ ---------- */
function inline(text: string, into: HTMLElement) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\$[^$]+\$)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) el('strong', '', into).textContent = part.slice(2, -2);
    else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) el('code', '', into).textContent = part.slice(1, -1);
    else if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const span = el('span', '', into);
      try {
        katex.render(part.slice(1, -1), span, katexOpts(false));
      } catch {
        span.textContent = part;
      }
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) el('em', '', into).textContent = part.slice(1, -1);
    else into.appendChild(document.createTextNode(part));
  }
}

/* ---------- tooltip ---------- */
const tip = $('tip');
function hover(target: Element, text: string) {
  target.addEventListener('mousemove', (e) => {
    const m = e as MouseEvent;
    tip.textContent = text;
    tip.classList.remove('hidden');
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, m.clientX + 14)}px`;
    tip.style.top = `${m.clientY + 14}px`;
  });
  target.addEventListener('mouseleave', () => tip.classList.add('hidden'));
}

/* ---------- nice axis ticks ---------- */
function ticks(min: number, max: number, count = 6): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}
const fmt = (v: number) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1) : String(Math.round(v * 1000) / 1000));

/** Draws a path on: the stroke is hidden and then revealed over `ms`. */
function drawOn(path: SVGGeometryElement, ms: number, animate: boolean) {
  if (!animate) return;
  let len = 0;
  try {
    len = path.getTotalLength();
  } catch {
    return;
  }
  if (!len) return;
  path.style.strokeDasharray = `${len}`;
  path.style.strokeDashoffset = `${len}`;
  path.style.transition = `stroke-dashoffset ${ms}ms ease-in-out`;
  requestAnimationFrame(() => requestAnimationFrame(() => (path.style.strokeDashoffset = '0')));
  setTimeout(() => {
    path.style.strokeDasharray = '';
    path.style.transition = '';
  }, ms + 100);
}

function legend(names: string[], colors: string[], into: HTMLElement) {
  if (names.length < 2) return;
  const lg = el('div', 'legend', into);
  names.forEach((n, i) => {
    const s = el('span', '', lg);
    el('i', '', s).style.background = colors[i];
    s.appendChild(document.createTextNode(n));
  });
}

/* ---------- charts ---------- */
function chart(b: Block, card: HTMLElement, animate: boolean) {
  const W = 720;
  const H = 360;
  const series = b.series ?? [];
  const direct = b.chart === 'line' && series.length > 1 && series.length <= 4;
  const m = { l: 56, r: direct ? 86 : 24, t: 16, b: 46 };
  const colors = series.map((_, i) => PALETTE[i % PALETTE.length]);
  legend(series.map((s) => s.name), colors, card);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': b.title ?? 'chart' }, card);
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;

  if (b.chart === 'pie') {
    const s = series[0];
    const vals = (s.values ?? []).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
    const total = vals.reduce((a, v) => a + v, 0) || 1;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 24;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
      const d = vals.length === 1 ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0` : `M ${cx} ${cy} L ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)} Z`;
      const label = b.labels?.[i] ?? `Part ${i + 1}`;
      const wedge = svgEl('path', { d, fill: PALETTE[i % PALETTE.length], stroke: SURFACE, 'stroke-width': 2, class: animate ? 'pop' : '' }, svg);
      hover(wedge, `${label}: ${fmt(v)} (${Math.round((v / total) * 100)}%)`);
      if (animate) setTimeout(() => wedge.classList.add('on'), 120 + i * 160);
      const mid = (a0 + a1) / 2;
      if (v / total > 0.06) {
        const t = svgEl('text', { x: cx + (r + 16) * Math.cos(mid), y: cy + (r + 16) * Math.sin(mid) + 4, 'text-anchor': Math.cos(mid) >= 0 ? 'start' : 'end', class: 'lbl' }, svg);
        t.textContent = `${label} ${Math.round((v / total) * 100)}%`;
      }
      a0 = a1;
    });
    return;
  }

  // x positions: categories (labels / value index) or numbers (points)
  const numeric = series.some((s) => s.points?.length);
  const cats = b.labels ?? Array.from({ length: Math.max(...series.map((s) => s.values?.length ?? 0)) }, (_, i) => String(i + 1));
  const ys: number[] = [];
  const xs: number[] = [];
  for (const s of series) {
    s.values?.forEach((v) => Number.isFinite(v) && ys.push(v));
    s.points?.forEach(([x, y]) => (xs.push(x), ys.push(y)));
  }
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  if (b.chart === 'bar') {
    y0 = Math.min(0, y0);
    y1 = Math.max(0, y1);
  }
  if (y0 === y1) (y0 -= 1), (y1 += 1);
  const pad = (y1 - y0) * 0.08;
  if (b.chart !== 'bar' || y0 < 0) y0 -= pad;
  y1 += pad;
  const x0 = numeric ? Math.min(...xs) : 0;
  const x1 = numeric ? Math.max(...xs) : Math.max(1, cats.length - 1);
  const band = pw / Math.max(1, cats.length);
  const X = (v: number) => (numeric ? m.l + ((v - x0) / (x1 - x0 || 1)) * pw : b.chart === 'bar' ? m.l + band * (v + 0.5) : m.l + (cats.length > 1 ? (v / (cats.length - 1)) * pw : pw / 2));
  const Y = (v: number) => m.t + (1 - (v - y0) / (y1 - y0)) * ph;

  for (const t of ticks(y0, y1)) {
    svgEl('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'zero' : 'grid' }, svg);
    svgEl('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, svg).textContent = fmt(t);
  }
  svgEl('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'axis' }, svg);
  if (numeric) {
    for (const t of ticks(x0, x1)) svgEl('text', { x: X(t), y: H - m.b + 18, 'text-anchor': 'middle' }, svg).textContent = fmt(t);
  } else {
    const every = Math.ceil(cats.length / 12);
    cats.forEach((c, i) => i % every === 0 && (svgEl('text', { x: X(i), y: H - m.b + 18, 'text-anchor': 'middle' }, svg).textContent = c));
  }
  if (b.xLabel) svgEl('text', { x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle', class: 'lbl' }, svg).textContent = b.xLabel;
  if (b.yLabel) svgEl('text', { x: 14, y: m.t + ph / 2, 'text-anchor': 'middle', class: 'lbl', transform: `rotate(-90 14 ${m.t + ph / 2})` }, svg).textContent = b.yLabel;

  if (b.chart === 'bar') {
    const groups = series.length;
    const gap = 2;
    const bw = Math.max(4, Math.min(48, (band * 0.72) / groups));
    series.forEach((s, si) => {
      (s.values ?? []).forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        const x = X(i) - (bw * groups) / 2 + si * bw + gap / 2;
        const top = Y(Math.max(0, v));
        const bottom = Y(Math.min(0, v));
        const h = Math.max(1, bottom - top);
        const r = Math.min(4, bw / 2, h);
        // rounded data end, square at the baseline
        const d =
          v >= 0
            ? `M ${x} ${bottom} V ${top + r} Q ${x} ${top} ${x + r} ${top} H ${x + bw - gap - r} Q ${x + bw - gap} ${top} ${x + bw - gap} ${top + r} V ${bottom} Z`
            : `M ${x} ${top} V ${bottom - r} Q ${x} ${bottom} ${x + r} ${bottom} H ${x + bw - gap - r} Q ${x + bw - gap} ${bottom} ${x + bw - gap} ${bottom - r} V ${top} Z`;
        const bar = svgEl('path', { d, fill: colors[si], class: 'mark grow' }, svg);
        hover(bar, `${s.name} · ${cats[i] ?? i + 1}: ${fmt(v)}`);
        if (animate) {
          bar.style.transformOrigin = v >= 0 ? 'bottom' : 'top';
          bar.style.transform = 'scaleY(0)';
          setTimeout(() => (bar.style.transform = 'scaleY(1)'), 100 + i * 70 + si * 40);
        }
      });
    });
    return;
  }

  series.forEach((s, si) => {
    const pts: [number, number][] = s.points?.length ? s.points : (s.values ?? []).map((v, i) => [i, v] as [number, number]).filter(([, v]) => Number.isFinite(v));
    if (b.chart === 'line') {
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${X(x)} ${Y(y)}`).join(' ');
      const path = svgEl('path', { d, fill: 'none', stroke: colors[si], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      drawOn(path, 1300, animate);
      if (series.length <= 4 && series.length > 1 && pts.length) {
        const [lx, ly] = pts[pts.length - 1];
        svgEl('text', { x: X(lx) + 6, y: Y(ly) + 4, class: 'lbl' }, svg).textContent = s.name;
      }
    }
    if (b.chart === 'scatter' || pts.length <= 30) {
      pts.forEach(([x, y], i) => {
        const dot = svgEl('circle', { cx: X(x), cy: Y(y), r: b.chart === 'scatter' ? 5 : 4, fill: colors[si], stroke: SURFACE, 'stroke-width': 2, class: animate ? 'pop' : '' }, svg);
        hover(dot, `${s.name}: ${numeric ? `${fmt(x)}, ` : `${cats[x] ?? x}: `}${fmt(y)}`);
        if (animate) setTimeout(() => dot.classList.add('on'), (b.chart === 'line' ? 1100 : 150) + i * 25);
      });
    }
  });
}

/* ---------- function plots (optionally animated over t) ---------- */
function plot(b: Block, card: HTMLElement, animate: boolean, alive: () => boolean) {
  const W = 720;
  const H = 400;
  const m = { l: 48, r: 20, t: 14, b: 34 };
  const fns = (b.fns ?? []).map((f) => ({ ...f, fn: compile(f.expr) as Fn }));
  const colors = fns.map((_, i) => PALETTE[i % PALETTE.length]);
  legend(fns.map((f) => f.label ?? `y = ${f.expr}`), colors, card);
  const [x0, x1] = b.x ?? [-10, 10];
  const t0 = b.t?.[0] ?? 0;
  const N = 500;
  // y range: given, or from the samples (ignoring the extreme 2% so tan(x) does not flatten everything)
  let y0: number;
  let y1: number;
  if (b.y) [y0, y1] = b.y;
  else {
    const vals: number[] = [];
    const tSamples = b.t ? [b.t[0], (b.t[0] + b.t[1]) / 2, b.t[1]] : [t0];
    for (const f of fns)
      for (const t of tSamples)
        for (let i = 0; i <= 200; i++) {
          const v = f.fn(x0 + ((x1 - x0) * i) / 200, t);
          if (Number.isFinite(v)) vals.push(v);
        }
    for (const p of b.points ?? []) vals.push(p.y);
    vals.sort((a, c) => a - c);
    y0 = vals.length ? vals[Math.floor(vals.length * 0.02)] : -1;
    y1 = vals.length ? vals[Math.ceil(vals.length * 0.98) - 1] : 1;
    if (y0 === y1) (y0 -= 1), (y1 += 1);
    const pad = (y1 - y0) * 0.1;
    y0 -= pad;
    y1 += pad;
  }
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const X = (v: number) => m.l + ((v - x0) / (x1 - x0)) * pw;
  const Y = (v: number) => m.t + (1 - (v - y0) / (y1 - y0)) * ph;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': b.title ?? 'graph' }, card);
  for (const t of ticks(x0, x1, 10)) {
    svgEl('line', { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, class: t === 0 ? 'zero' : 'grid' }, svg);
    svgEl('text', { x: X(t), y: H - m.b + 18, 'text-anchor': 'middle' }, svg).textContent = fmt(t);
  }
  for (const t of ticks(y0, y1, 7)) {
    svgEl('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'zero' : 'grid' }, svg);
    svgEl('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }, svg).textContent = fmt(t);
  }
  if (b.xLabel) svgEl('text', { x: W - m.r, y: H - 4, 'text-anchor': 'end', class: 'lbl' }, svg).textContent = b.xLabel;
  if (b.yLabel) svgEl('text', { x: m.l + 6, y: m.t + 12, class: 'lbl' }, svg).textContent = b.yLabel;
  const clip = `c${Math.random().toString(36).slice(2)}`;
  svgEl('rect', { x: m.l, y: m.t, width: pw, height: ph }, svgEl('clipPath', { id: clip }, svg));
  const paths = fns.map((_, i) => svgEl('path', { fill: 'none', stroke: colors[i], 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'clip-path': `url(#${clip})` }, svg));
  const pathFor = (fn: Fn, t: number) => {
    let d = '';
    let pen = false;
    let prev = NaN;
    for (let i = 0; i <= N; i++) {
      const x = x0 + ((x1 - x0) * i) / N;
      const y = fn(x, t);
      // lift the pen at gaps and at jumps (like tan(x) crossing an asymptote)
      if (!Number.isFinite(y) || (Number.isFinite(prev) && Math.abs(y - prev) > (y1 - y0) * 2)) {
        pen = false;
        prev = y;
        continue;
      }
      const py = Math.max(m.t - 4000, Math.min(H + 4000, Y(y)));
      d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)} ${py.toFixed(1)}`;
      pen = true;
      prev = y;
    }
    return d;
  };
  const drawAt = (t: number) => fns.forEach((f, i) => paths[i].setAttribute('d', pathFor(f.fn, t)));
  drawAt(t0);
  paths.forEach((p, i) => drawOn(p, 1400, animate && i >= 0));
  (b.points ?? []).forEach((p, i) => {
    const g = svgEl('g', { class: animate ? 'pop' : '' }, svg);
    svgEl('circle', { cx: X(p.x), cy: Y(p.y), r: 5, fill: NAMED.white, stroke: SURFACE, 'stroke-width': 2 }, g);
    if (p.label) svgEl('text', { x: X(p.x) + 9, y: Y(p.y) - 9, class: 'lbl' }, g).textContent = p.label;
    hover(g, `${p.label ? `${p.label}: ` : ''}(${fmt(p.x)}, ${fmt(p.y)})`);
    if (animate) setTimeout(() => g.classList.add('on'), 1200 + i * 200);
  });
  if (b.t) {
    const [ta, tb] = b.t;
    const readout = el('div', 'readout', card);
    const ms = (b.seconds ?? 4) * 1000;
    const startAt = performance.now() + (animate ? 1400 : 0);
    const frame = (now: number) => {
      if (!alive() || !card.isConnected) return;
      if (now >= startAt) {
        const k = ((now - startAt) % ms) / ms;
        const t = ta + (tb - ta) * k;
        drawAt(t);
        readout.textContent = `t = ${t.toFixed(2)}`;
      }
      const id = requestAnimationFrame(frame);
      loops.add(id);
    };
    loops.add(requestAnimationFrame(frame));
  }
}

/* ---------- scenes (shapes) and their animations ---------- */
type Live = { g: SVGGElement; s: Shape; body: SVGElement | null; label: SVGTextElement | null };
class SceneState {
  shapes = new Map<string, Live>();
  private anims: number[] = [];
  constructor(readonly svg: SVGSVGElement) {}
  stopAll() {
    for (const a of this.anims) cancelAnimationFrame(a);
    this.anims = [];
  }
  track(id: number) {
    this.anims.push(id);
  }
}

const NUMERIC = ['x', 'y', 'w', 'h', 'r', 'x2', 'y2', 'opacity', 'rotate'] as const;

function paint(l: Live) {
  const s = l.s;
  const stroke = col(s.color);
  const fill = s.fill ? col(s.fill) : stroke;
  const b = l.body;
  const cx = s.shape === 'rect' ? (s.x ?? 0) + (s.w ?? 120) / 2 : s.x ?? 0;
  const cy = s.shape === 'rect' ? (s.y ?? 0) + (s.h ?? 60) / 2 : s.y ?? 0;
  if (b) {
    switch (s.shape) {
      case 'rect':
        b.setAttribute('x', String(s.x ?? 0));
        b.setAttribute('y', String(s.y ?? 0));
        b.setAttribute('width', String(Math.max(0, s.w ?? 120)));
        b.setAttribute('height', String(Math.max(0, s.h ?? 60)));
        b.setAttribute('rx', '12');
        break;
      case 'circle':
        b.setAttribute('cx', String(s.x ?? 0));
        b.setAttribute('cy', String(s.y ?? 0));
        b.setAttribute('r', String(Math.max(0, s.r ?? 30)));
        break;
      case 'line':
      case 'arrow':
        b.setAttribute('x1', String(s.x ?? 0));
        b.setAttribute('y1', String(s.y ?? 0));
        b.setAttribute('x2', String(s.x2 ?? (s.x ?? 0) + 100));
        b.setAttribute('y2', String(s.y2 ?? s.y ?? 0));
        break;
      case 'path':
        if (s.d) b.setAttribute('d', s.d);
        break;
    }
    b.setAttribute('stroke', stroke);
    if (s.shape === 'rect' || s.shape === 'circle') {
      b.setAttribute('fill', fill);
      b.setAttribute('fill-opacity', s.fill ? '0.85' : '0.18');
    } else if (s.shape === 'path') {
      b.setAttribute('fill', s.fill ? fill : 'none');
      b.setAttribute('fill-opacity', '0.3');
    }
  }
  if (l.label) {
    const lx = s.shape === 'text' ? s.x ?? 0 : s.shape === 'line' || s.shape === 'arrow' ? ((s.x ?? 0) + (s.x2 ?? 0)) / 2 : cx;
    const ly = s.shape === 'text' ? s.y ?? 0 : s.shape === 'line' || s.shape === 'arrow' ? ((s.y ?? 0) + (s.y2 ?? 0)) / 2 - 10 : cy;
    l.label.setAttribute('x', String(lx));
    l.label.setAttribute('y', String(ly));
    l.label.setAttribute('font-size', String(s.size ?? (s.shape === 'text' ? 22 : 18)));
    if (s.shape === 'text' && s.color) l.label.setAttribute('fill', col(s.color));
    l.label.textContent = s.text ?? '';
  }
  l.g.setAttribute('opacity', String(s.opacity ?? 1));
  l.g.setAttribute('transform', s.rotate ? `rotate(${s.rotate} ${cx} ${cy})` : '');
}

function scene(b: Block, card: HTMLElement, animate: boolean) {
  const svg = svgEl('svg', { viewBox: `0 0 ${b.w} ${b.h}`, class: 'scene', role: 'img', 'aria-label': b.title ?? 'animation' }, card);
  const defs = svgEl('defs', {}, svg);
  const st = new SceneState(svg);
  scenes.set(b.id ?? 'scene', st);
  const markers = new Map<string, string>();
  const markerFor = (c: string) => {
    if (!markers.has(c)) {
      const id = `a${Math.random().toString(36).slice(2)}`;
      const mk = svgEl('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      svgEl('path', { d: 'M0 0 L10 5 L0 10 z', fill: c }, mk);
      markers.set(c, id);
    }
    return markers.get(c)!;
  };
  (b.shapes ?? []).forEach((s, i) => {
    const outer = svgEl('g', {}, svg); // the pop-in animation lives here, so it never overrides the shape's rotation
    const g = svgEl('g', { 'data-id': s.id ?? '' }, outer);
    let body: SVGElement | null = null;
    const tag = { rect: 'rect', circle: 'circle', line: 'line', arrow: 'line', path: 'path', text: null }[s.shape] as 'rect' | 'circle' | 'line' | 'path' | null;
    if (tag) {
      body = svgEl(tag, { class: 'shape', 'stroke-width': s.shape === 'line' || s.shape === 'arrow' || s.shape === 'path' ? 2.5 : 2, 'stroke-linecap': 'round' }, g);
      if (s.shape === 'arrow') body.setAttribute('marker-end', `url(#${markerFor(col(s.color))})`);
    }
    const label = s.text || s.shape === 'text' ? svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, g) : null;
    const live: Live = { g, s: { ...s }, body, label };
    paint(live);
    if (s.id) st.shapes.set(s.id, live);
    if (s.text && s.shape !== 'text') hover(g, s.text);
    if (animate) {
      if (body && (s.shape === 'line' || s.shape === 'arrow' || s.shape === 'path')) {
        outer.style.opacity = '0';
        setTimeout(() => {
          outer.style.opacity = '';
          drawOn(body as unknown as SVGGeometryElement, 700, true);
        }, 150 + i * 120);
      } else {
        outer.classList.add('pop');
        setTimeout(() => outer.classList.add('on'), 150 + i * 120);
      }
    }
  });
}

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

/** Moves/changes scene shapes. Instant when replaying earlier steps (unless it repeats forever). */
function runAnimate(b: Block, animate: boolean, alive: () => boolean) {
  const st = scenes.get(b.target ?? 'scene') ?? [...scenes.values()].at(-1);
  if (!st) return;
  const jobs = (b.changes ?? [])
    .map((c: Change) => {
      const l = st.shapes.get(c.id);
      if (!l) return null;
      const from: Record<string, number> = {};
      const to: Record<string, number> = {};
      for (const k of NUMERIC) {
        if (c[k] === undefined) continue;
        from[k] = (l.s[k] as number | undefined) ?? (k === 'opacity' ? 1 : 0);
        to[k] = c[k] as number;
      }
      return { l, c, from, to };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const setAt = (k: number) => {
    for (const jb of jobs) {
      for (const key of Object.keys(jb.to)) (jb.l.s as unknown as Record<string, number>)[key] = jb.from[key] + (jb.to[key] - jb.from[key]) * k;
      paint(jb.l);
    }
  };
  const finishStyle = () => {
    for (const jb of jobs) {
      if (jb.c.color) jb.l.s.color = jb.c.color;
      if (jb.c.fill) jb.l.s.fill = jb.c.fill;
      if (jb.c.text) jb.l.s.text = jb.c.text;
      paint(jb.l);
    }
  };
  const repeat = b.repeat ?? 'none';
  if (!animate && repeat === 'none') {
    setAt(1);
    finishStyle();
    return;
  }
  finishStyle(); // colours change with a CSS transition while things move
  const ms = (b.seconds ?? 1.5) * 1000;
  const start = performance.now() + (animate ? 500 : 0);
  const frame = (now: number) => {
    if (!alive() || !st.svg.isConnected) return;
    const raw = Math.max(0, (now - start) / ms);
    let k: number;
    if (repeat === 'none') k = Math.min(1, raw);
    else if (repeat === 'loop') k = raw % 1;
    else k = Math.floor(raw) % 2 === 0 ? raw % 1 : 1 - (raw % 1);
    setAt(ease(k));
    if (repeat !== 'none' || raw < 1) st.track(requestAnimationFrame(frame));
  };
  st.track(requestAnimationFrame(frame));
}

/* ---------- diagrams are drawn ahead of time, so a step never waits for them ---------- */
const diagrams = new Map<string, Promise<string>>();
function diagramSvg(code: string): Promise<string> {
  let p = diagrams.get(code);
  if (!p) {
    const id = `mmd${++mermaidSeq}`;
    p = mermaid.render(id, code).then(
      (r) => r.svg,
      (err) => {
        document.getElementById(`d${id}`)?.remove(); // Mermaid leaves an error box behind
        throw err;
      },
    );
    diagrams.set(code, p);
  }
  return p;
}

/* ---------- blocks ---------- */
async function renderBlock(b: Block, animate: boolean, sayMs: number, alive: () => boolean): Promise<void> {
  if (b.type === 'animate') return runAnimate(b, animate, alive);
  if (b.type === 'play') {
    // more animation on a stage shown earlier (e.g. now slide the parameter, now bend the plane)
    const view = stages.get(b.target ?? 'stage') ?? [...stages.values()].at(-1);
    void view?.play(b.actions ?? [], animate, sayMs);
    if (animate && view) {
      // bring that stage back into view so the student sees it move
      view.root.closest('.blk')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrolledByPlay = true;
    }
    return;
  }
  const box = el('section', 'blk', page);
  if (b.id) box.dataset.id = b.id;
  if (animate) box.classList.add('in');
  const titled = (cls = 'card') => {
    box.className = `${box.className} ${cls}`;
    if (b.title) el('div', 'cap', box).textContent = b.title;
    return box;
  };
  switch (b.type) {
    case 'heading':
      box.className = `blk h${animate ? ' in' : ''}`;
      inline(b.text ?? '', box);
      break;
    case 'text': {
      const p = el('p', 'p', titled(b.title ? 'card' : ''));
      inline(b.text ?? '', p);
      break;
    }
    case 'note': {
      box.className = `${box.className} card note ${b.tone ?? 'tip'}`;
      el('span', 'tag', box).textContent = { tip: 'Tip', warn: 'Watch out', example: 'Example', key: 'Key idea' }[b.tone ?? 'tip'];
      const p = el('p', 'p', el('div', '', box));
      if (b.title) {
        el('strong', '', p).textContent = `${b.title}. `;
      }
      inline(b.text ?? '', p);
      break;
    }
    case 'bullets': {
      const ul = el('ul', 'bul', titled(b.title ? 'card' : ''));
      const items = b.items ?? [];
      // reveal one by one across the narration, like someone writing them up
      const gap = animate ? Math.min(1800, Math.max(450, (sayMs * 0.8) / Math.max(1, items.length))) : 0;
      items.forEach((it, i) => {
        const li = el('li', '', ul);
        inline(it, li);
        if (animate) setTimeout(() => alive() && li.classList.add('on'), 250 + i * gap);
        else li.classList.add('on');
      });
      break;
    }
    case 'math': {
      const m = el('div', 'math', titled());
      const steps = animate && b.texSteps ? b.texSteps : [b.tex ?? ''];
      const show = (tex: string, into: HTMLElement) => {
        try {
          katex.render(tex, into, katexOpts(true));
        } catch {
          into.textContent = tex;
        }
      };
      if (steps.length === 1) {
        show(steps[0], m);
        break;
      }
      // the equation changes step by step across the narration
      m.classList.add('morph');
      const layers = steps.map((tex) => {
        const layer = el('div', 'eq', m);
        show(tex, layer);
        return layer;
      });
      layers[0].classList.add('on');
      const gap = Math.max(1100, (sayMs * 0.85) / steps.length);
      layers.slice(1).forEach((layer, i) =>
        setTimeout(() => {
          if (!alive()) return;
          layers[i].classList.replace('on', 'off');
          layer.classList.add('on');
        }, gap * (i + 1)),
      );
      break;
    }
    case 'stage': {
      const card = titled('card viz stagecard');
      // objects that a later step creates start hidden
      const hidden = new Set<string>();
      const creates = (acts: Block['actions']) => (acts ?? []).filter((a) => a.do === 'create').forEach((a) => a.ids?.forEach((id) => hidden.add(id)));
      creates(b.stage!.actions);
      for (const st of lesson?.steps ?? []) for (const x of st.show) if (x.type === 'play' && x.target === b.id) creates(x.actions);
      const view = new StageView(card, b.stage!, { color: (name, i) => col(name, PALETTE[i % PALETTE.length]), tex: (src, into) => texSafe(src, into), alive }, hidden);
      stages.set(b.id ?? 'stage', view);
      void view.play(b.stage!.actions, animate, sayMs);
      break;
    }
    case 'diagram': {
      const wrap = el('div', 'diagram', titled());
      try {
        wrap.innerHTML = await diagramSvg(b.code ?? ''); // sanitised by Mermaid (securityLevel: strict)
        animateDiagram(wrap, animate, sayMs);
      } catch (err) {
        el('div', 'err', wrap).textContent = `This diagram could not be drawn.\n${String((err as Error)?.message ?? err).split('\n')[0]}`;
      }
      break;
    }
    case 'chart':
      chart(b, titled('card viz'), animate);
      break;
    case 'plot':
      plot(b, titled('card viz'), animate, alive);
      break;
    case 'scene':
      scene(b, titled('card viz'), animate);
      break;
    case 'quote': {
      box.className = `${box.className} card quote`;
      const q = el('blockquote', '', box);
      inline(b.text ?? '', q);
      if (b.title) el('div', 'cap', box).textContent = b.title;
      break;
    }
    case 'code':
      code(b, titled('card codeblk'), animate);
      break;
    case 'snip': {
      const fig = titled('card snip');
      const shot = el('div', 'shot', fig);
      const img = el('img', '', shot);
      img.alt = b.text ?? 'Part of your screen';
      img.src = b.image ?? ''; // made by Jarvis from its own screenshot (a data: URL)
      if (b.hl) {
        const hl = el('div', `hlbox${animate ? ' in' : ''}`, shot);
        hl.style.left = `${b.hl.x * 100}%`;
        hl.style.top = `${b.hl.y * 100}%`;
        hl.style.width = `${b.hl.w * 100}%`;
        hl.style.height = `${b.hl.h * 100}%`;
      }
      if (b.text) inline(b.text, el('div', 'snipcap', fig));
      break;
    }
    case 'table': {
      const t = el('table', 'tbl', titled());
      const [head, ...rows] = b.rows ?? [];
      const tr = el('tr', '', el('thead', '', t));
      for (const h of head) inline(h, el('th', '', tr));
      const tb = el('tbody', '', t);
      rows.forEach((r, i) => {
        const row = el('tr', '', tb);
        for (const c of r) inline(c, el('td', '', row));
        if (animate) {
          row.style.opacity = '0';
          setTimeout(() => (row.style.opacity = '1'), 200 + i * 220);
        }
      });
      break;
    }
  }
  if (b.source) {
    const n = sources.get(b.source);
    const cite = el('div', 'cite', box);
    el('span', 'n', cite).textContent = n ? String(n) : '•';
    cite.appendChild(document.createTextNode(b.source));
    cite.title = 'Where this comes from';
  }
}

/** Code with line numbers, colours (highlight.js) and the important lines marked. */
function code(b: Block, card: HTMLElement, animate: boolean) {
  const src = b.code ?? '';
  const lines = src.split('\n');
  const first = b.line ?? 1;
  let html: string;
  try {
    // highlight.js escapes the code itself; its output is only <span class="hljs-..."> markup
    html = b.lang && hljs.getLanguage(b.lang) ? hljs.highlight(src, { language: b.lang, ignoreIllegals: true }).value : hljs.highlightAuto(src).value;
  } catch {
    html = '';
  }
  const wrap = el('div', 'codewrap', card);
  const gutter = el('div', 'gutter', wrap);
  gutter.textContent = lines.map((_, i) => String(first + i)).join('\n');
  const pre = el('pre', '', wrap);
  for (const m of b.marks ?? []) {
    const k = m - first;
    if (k < 0 || k >= lines.length) continue;
    const bar = el('div', `mark-line${animate ? ' in' : ''}`, pre);
    bar.style.top = `calc(${k} * var(--lh) + 12px)`;
  }
  const codeEl = el('code', 'hljs', pre);
  if (html) codeEl.innerHTML = html;
  else codeEl.textContent = src;
}

/** Mermaid diagrams: nodes pop in one after another, then the connecting lines draw on. */
function animateDiagram(wrap: HTMLElement, animate: boolean, sayMs: number) {
  if (!animate) return;
  const svg = wrap.querySelector('svg');
  if (!svg) return;
  const nodes = [...svg.querySelectorAll<SVGGElement>('g.node, g.actor, .actor-top, g.mindmap-node, g.stateGroup, g.task, g.section, g.label-container, g.classGroup, g.entity')];
  const edges = [...svg.querySelectorAll<SVGPathElement>('path.flowchart-link, .edgePaths path, path.transition, path.relation, line.messageLine0, line.messageLine1, path.messageLine0, path.messageLine1, path.edge')];
  const labels = [...svg.querySelectorAll<SVGGElement>('g.edgeLabel, text.messageText')];
  if (!nodes.length && !edges.length) {
    svg.style.opacity = '0';
    svg.style.transition = 'opacity .6s';
    requestAnimationFrame(() => (svg.style.opacity = '1'));
    return;
  }
  const step = Math.min(500, Math.max(160, (sayMs * 0.6) / Math.max(1, nodes.length)));
  nodes.forEach((n, i) => {
    n.classList.add('reveal');
    setTimeout(() => n.classList.add('on'), 120 + i * step);
  });
  const after = 120 + nodes.length * step;
  for (const l of labels) {
    l.style.opacity = '0';
    l.style.transition = 'opacity .5s';
    setTimeout(() => (l.style.opacity = '1'), after + 500);
  }
  edges.forEach((e, i) => {
    e.style.opacity = '0';
    setTimeout(() => {
      e.style.opacity = '';
      drawOn(e as unknown as SVGGeometryElement, 650, true);
    }, after + i * 90);
  });
}

/* ---------- playback ---------- */
const body = document.body;

function setFocus(id: string | undefined) {
  page.querySelectorAll('.focus').forEach((e) => e.classList.remove('focus'));
  if (!id) return;
  const target = page.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  const blk = target?.closest<HTMLElement>('.blk') ?? null;
  blk?.classList.add('focus');
  blk?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateChrome() {
  if (!lesson) return;
  $('count').textContent = `${Math.max(0, idx) + 1} / ${lesson.steps.length}`;
  const bar = $('progress');
  if (bar.querySelectorAll('i').length !== lesson.steps.length) {
    // one group per part (problem, intuition, solution, recap), sized by its number of steps
    bar.textContent = '';
    let group: HTMLElement | null = null;
    let segs: HTMLElement | null = null;
    lesson.steps.forEach((st, i) => {
      const key = st.part ?? 'all';
      if (!group || group.dataset.part !== key) {
        group = el('div', `pgroup p-${key}`, bar);
        group.dataset.part = key;
        if (st.part) el('span', 'plabel', group).textContent = PART_NAMES[st.part];
        segs = el('div', 'psegs', group);
      }
      group.style.flex = String(Number(group.style.flex || 0) + 1);
      const seg = el('i', '', segs!);
      seg.title = st.part ? `${PART_NAMES[st.part]} · step ${i + 1}` : `Step ${i + 1}`;
      seg.addEventListener('click', () => void goTo(i, true));
    });
  }
  bar.querySelectorAll('i').forEach((c, i) => {
    c.classList.toggle('seen', i < idx);
    c.classList.toggle('now', i === idx);
  });
  const part = lesson.steps[Math.max(0, idx)].part;
  const now = bar.querySelectorAll('i')[Math.max(0, idx)];
  bar.querySelectorAll<HTMLElement>('.pgroup').forEach((g) => g.classList.toggle('current', g.contains(now)));
  $('kicker').textContent = part ? `Part ${PART_NUM[part]} of 4 · ${PART_NAMES[part]}` : 'Jarvis is explaining';
  body.classList.toggle('paused', !playing);
  body.classList.toggle('done', done);
}

/** Estimated narration length, used to pace bullet and diagram reveals until the real length is known. */
const sayMs = (text: string) => Math.max(1500, (text.split(/\s+/).filter(Boolean).length / 2.6) * 1000);
/** Pause between steps, like a teacher taking a breath. */
const BREATH_MS = 250;
/** How many steps ahead the voice and diagrams are prepared. */
const AHEAD = 3;

function prepareAhead(from: number) {
  if (!lesson) return;
  narrator.keepOnly(from, from + AHEAD);
  for (let k = from; k < Math.min(lesson.steps.length, from + AHEAD + 1); k++) {
    narrator.prefetch(k, lesson.steps[k].say);
    for (const b of lesson.steps[k].show) if (b.type === 'diagram' && b.code) diagramSvg(b.code).catch(() => undefined);
  }
}

async function showStep(i: number, animate: boolean, my: number, voiceMs: number | null = null) {
  const st = lesson!.steps[i];
  const alive = () => my === token;
  if (st.clear) {
    stopLoops();
    scenes.clear();
    page.textContent = '';
  }
  const ms = voiceMs ?? sayMs(st.say);
  // a numbered heading where each part begins (only in lessons that use the four parts)
  const prevPart = i > 0 && !st.clear ? lesson!.steps[i - 1].part : undefined;
  if (st.part && st.part !== prevPart) {
    const div = el('div', `blk partbar p-${st.part}${animate ? ' in' : ''}`, page);
    el('span', 'pnum', div).textContent = String(PART_NUM[st.part]);
    el('span', 'pname', div).textContent = PART_NAMES[st.part];
  }
  const before = page.children.length;
  for (const b of st.show) {
    if (!alive()) return;
    await renderBlock(b, animate, ms, alive);
  }
  if (st.part) for (const c of [...page.children].slice(before)) (c as HTMLElement).dataset.part = st.part;
  if (i === lesson!.steps.length - 1 && sources.size) {
    page.querySelector('.refs')?.remove();
    const refs = el('section', `blk card refs${animate ? ' in' : ''}`, page);
    el('div', 'cap', refs).textContent = 'References';
    const ol = el('ol', '', refs);
    for (const [s, n] of sources) {
      const li = el('li', '', ol);
      el('span', 'n', li).textContent = String(n);
      li.appendChild(document.createTextNode(s));
    }
  }
  setFocus(st.focus);
}

/** Jump to step i: rebuild the page up to it (instantly) and play it, voice and visuals together. */
async function goTo(i: number, play: boolean) {
  if (!lesson) return;
  i = Math.max(0, Math.min(lesson.steps.length - 1, i));
  const my = ++token;
  narrator.stop();
  const contiguous = i === idx + 1 && !done;
  idx = i;
  done = false;
  playing = play;
  updateChrome();
  prepareAhead(i);
  const st = lesson.steps[i];
  $('caption').textContent = st.say;
  if (!contiguous) {
    stopLoops();
    scenes.clear();
    page.textContent = '';
    let start = 0;
    for (let k = i; k >= 0; k--)
      if (lesson.steps[k].clear) {
        start = k;
        break;
      }
    for (let k = start; k < i; k++) {
      await showStep(k, false, my);
      if (my !== token) return;
    }
  }
  // Wait until this step's voice can start at once (normally it is already made), so nothing runs ahead of it.
  let voiceMs: number | null = null;
  if (play && st.say) {
    body.classList.add('waiting');
    voiceMs = (await narrator.ready(i, st.say)).ms;
    body.classList.remove('waiting');
    if (my !== token) return;
  }
  // draw the visuals (diagrams are already rendered) and start speaking in the same moment
  await showStep(i, true, my, voiceMs);
  if (my !== token) return;
  const last = page.lastElementChild as HTMLElement | null;
  if (scrolledByPlay) scrolledByPlay = false;
  else if (last && !st.focus) board.scrollTo({ top: Math.max(0, last.offsetTop + last.offsetHeight - board.clientHeight + 120), behavior: 'smooth' });
  if (play) speakStep(my);
}

function speakStep(my: number) {
  if (!lesson || my !== token) return;
  const st = lesson.steps[idx];
  const next = () => {
    if (my !== token || !playing) return;
    if (idx < lesson!.steps.length - 1) setTimeout(() => my === token && playing && void goTo(idx + 1, true), BREATH_MS);
    else {
      done = true;
      playing = false;
      updateChrome();
    }
  };
  if (st.say) narrator.play(idx, st.say, next);
  else setTimeout(next, 2500); // a step with only visuals: give them a moment
}

function pause() {
  playing = false;
  token++;
  narrator.stop();
  updateChrome();
}

function resume() {
  if (!lesson) return;
  if (done) {
    void goTo(0, true);
    return;
  }
  playing = true;
  updateChrome();
  speakStep(++token); // say the current step again from the start (already prepared, so instant)
}

/* ---------- controls ---------- */
$('play').addEventListener('click', () => (playing ? pause() : resume()));
const step = (d: number) => {
  if (lesson && idx + d >= 0 && idx + d < lesson.steps.length) void goTo(idx + d, true);
};
$('next').addEventListener('click', () => step(1));
$('prev').addEventListener('click', () => step(-1));
$('close').addEventListener('click', () => close());
$('cc').addEventListener('click', () => toggleCaptions());
$('layout').addEventListener('click', () => j.lessonLayout(body.classList.contains('full') ? 'side' : 'full'));
function toggleCaptions() {
  body.classList.toggle('nocc');
  $('cc').classList.toggle('on', !body.classList.contains('nocc'));
}
function close() {
  token++;
  narrator.reset();
  stopLoops();
  j.lessonClose();
}
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    playing ? pause() : resume();
  } else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'Escape') close();
  else if (e.key.toLowerCase() === 'c') toggleCaptions();
  else if (e.key.toLowerCase() === 'f') j.lessonLayout(body.classList.contains('full') ? 'side' : 'full');
});
// Push-to-talk stops all speech: pause here too, so the user can ask a question.
j.onTtsStopAll(() => {
  if (playing) pause();
});

j.onLessonPlaced((side) => body.classList.toggle('full', side === 'full'));
j.onLesson(({ lesson: incoming, side }) => {
  body.classList.toggle('full', side === 'full');
  if (incoming.append && lesson) {
    const first = lesson.steps.length;
    lesson.steps.push(...incoming.steps);
    numberSources();
    updateChrome();
    if (done || !playing) void goTo(first, true); // finished or paused: carry on with the new part
    return;
  }
  token++;
  narrator.reset();
  stopLoops();
  scenes.clear();
  page.textContent = '';
  diagrams.clear();
  lesson = incoming;
  numberSources();
  idx = -1;
  done = false;
  $('title').textContent = lesson.title;
  document.title = lesson.title;
  $('progress').textContent = '';
  void goTo(0, true);
});
j.lessonReady();
