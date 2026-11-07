/**
 * Glass whiteboard: a transparent canvas over a glass panel. Jarvis's elements
 * (animated one by one) and the user's pen/eraser strokes share one ordered list,
 * so erasing (by the user or by Claude) wipes exactly the ink drawn before it.
 */
import { BOARD_HEIGHT, BOARD_WIDTH, COLOR_HEX, Color, Element, erasedBy } from '../../tools/whiteboard/scene.js';

type Tool = 'pen' | 'eraser';

interface Stroke {
  mode: Tool;
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

type Op = { t: 'el'; e: Element } | { t: 'stroke'; s: Stroke };

const STEP_MS = 280;
const ERASER_FACTOR = 5;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export interface Whiteboard {
  draw(elements: Element[]): void;
  snapshot(): { pngBase64: string; userStrokes: number; userErases: number };
  clear(): void;
  exportData(format: 'png' | 'pdf'): string;
}

export function initWhiteboard(canvas: HTMLCanvasElement, onClearRequested: () => void): Whiteboard {
  const ctx = canvas.getContext('2d')!;
  let ops: Op[] = [];
  const queue: Element[] = [];
  let current: Stroke | null = null;
  let tool: Tool = 'pen';
  let color: Color = 'white';
  let size = 4;
  let timer: number | null = null;

  /* ---------- rendering ---------- */
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = BOARD_WIDTH * dpr;
    canvas.height = BOARD_HEIGHT * dpr;
    render();
    updateCursor();
  }

  /** Draws ink only (transparent background), so the glass shows through. */
  function renderInk(target: CanvasRenderingContext2D, scale: number, list: Op[], live: Stroke | null) {
    target.setTransform(scale, 0, 0, scale, 0, 0);
    target.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    for (const op of list) {
      if (op.t === 'el') drawElement(target, op.e);
      else drawStroke(target, op.s);
    }
    if (live) drawStroke(target, live);
    target.globalCompositeOperation = 'source-over';
  }

  function render() {
    renderInk(ctx, canvas.width / BOARD_WIDTH, ops, current);
  }

  function apply(e: Element) {
    if (e.kind === 'clear') ops = [];
    else if (e.kind === 'erase') ops = ops.filter((op) => op.t !== 'el' || !erasedBy(op.e, e.id));
    else ops.push({ t: 'el', e });
  }

  function pump() {
    if (timer !== null) return;
    const next = () => {
      const e = queue.shift();
      if (!e) {
        timer = null;
        return;
      }
      apply(e);
      render();
      timer = window.setTimeout(next, STEP_MS);
    };
    next();
  }

  /* ---------- cursor: a dot for the pen, a ring for the eraser ---------- */
  function updateCursor() {
    const k = canvas.getBoundingClientRect().width / BOARD_WIDTH || 1;
    if (tool === 'pen') {
      const d = Math.max(6, Math.round(size * k) + 2);
      const half = Math.ceil(d / 2) + 2;
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${half * 2}' height='${half * 2}'><circle cx='${half}' cy='${half}' r='${d / 2}' fill='${COLOR_HEX[color]}' stroke='rgba(0,0,0,0.65)' stroke-width='1'/></svg>`;
      canvas.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${half} ${half}, crosshair`;
    } else {
      const d = Math.max(10, Math.round(size * ERASER_FACTOR * k));
      const half = Math.ceil(d / 2) + 2;
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${half * 2}' height='${half * 2}'><circle cx='${half}' cy='${half}' r='${d / 2}' fill='rgba(255,255,255,0.08)' stroke='white' stroke-width='1.5'/></svg>`;
      canvas.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${half} ${half}, cell`;
    }
  }

  /* ---------- user input ---------- */
  const toBoard = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * BOARD_WIDTH, y: ((ev.clientY - r.top) / r.height) * BOARD_HEIGHT };
  };
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    current = { mode: tool, color: COLOR_HEX[color], width: tool === 'pen' ? size : size * ERASER_FACTOR, points: [toBoard(ev)] };
    render();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!current) return;
    current.points.push(toBoard(ev));
    render();
  });
  const end = () => {
    if (current) ops.push({ t: 'stroke', s: current });
    current = null;
    render();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  /* ---------- toolbar ---------- */
  const setActive = (selector: string, active: unknown) =>
    document.querySelectorAll(selector).forEach((x) => x.classList.toggle('active', x === active));
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      tool = b.dataset.tool as Tool;
      setActive('[data-tool]', b);
      updateCursor();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-pen]').forEach((b) => {
    const c = b.dataset.pen as Color;
    b.style.background = COLOR_HEX[c];
    b.style.color = COLOR_HEX[c];
    b.addEventListener('click', () => {
      color = c;
      tool = 'pen';
      setActive('[data-pen]', b);
      setActive('[data-tool]', document.querySelector('[data-tool="pen"]')!);
      updateCursor();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-size]').forEach((b) =>
    b.addEventListener('click', () => {
      size = Number(b.dataset.size);
      setActive('[data-size]', b);
      updateCursor();
    }),
  );
  document.getElementById('wb-undo')?.addEventListener('click', () => {
    for (let i = ops.length - 1; i >= 0; i--) {
      if (ops[i].t === 'stroke') {
        ops.splice(i, 1);
        break;
      }
    }
    render();
  });
  document.getElementById('wb-clear')?.addEventListener('click', () => onClearRequested());

  window.addEventListener('resize', resize);
  new ResizeObserver(updateCursor).observe(canvas);
  resize();

  /** Finished picture on a solid glass-dark background (for Claude and for export). */
  function flattened(): HTMLCanvasElement {
    const all = [...ops];
    for (const e of queue) {
      if (e.kind === 'clear') all.length = 0;
      else if (e.kind === 'erase') {
        const kept = all.filter((op) => op.t !== 'el' || !erasedBy(op.e, e.id));
        all.length = 0;
        all.push(...kept);
      } else all.push({ t: 'el', e });
    }
    const ink = document.createElement('canvas');
    ink.width = BOARD_WIDTH;
    ink.height = BOARD_HEIGHT;
    renderInk(ink.getContext('2d')!, 1, all, null);

    const out = document.createElement('canvas');
    out.width = BOARD_WIDTH;
    out.height = BOARD_HEIGHT;
    const o = out.getContext('2d')!;
    const g = o.createLinearGradient(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    g.addColorStop(0, '#0d1230');
    g.addColorStop(1, '#151036');
    o.fillStyle = g;
    o.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    o.fillStyle = 'rgba(255,255,255,0.06)';
    for (let x = 12; x < BOARD_WIDTH; x += 24) for (let y = 12; y < BOARD_HEIGHT; y += 24) o.fillRect(x, y, 1.5, 1.5);
    o.drawImage(ink, 0, 0);
    return out;
  }

  return {
    draw(elements) {
      queue.push(...elements);
      pump();
    },
    snapshot() {
      const url = flattened().toDataURL('image/png');
      const strokes = ops.filter((op): op is { t: 'stroke'; s: Stroke } => op.t === 'stroke');
      return {
        pngBase64: url.slice(url.indexOf(',') + 1),
        userStrokes: strokes.filter((op) => op.s.mode === 'pen').length,
        userErases: strokes.filter((op) => op.s.mode === 'eraser').length,
      };
    },
    clear() {
      queue.length = 0;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      ops = [];
      render();
    },
    exportData(format) {
      return format === 'png' ? flattened().toDataURL('image/png') : flattened().toDataURL('image/jpeg', 0.92);
    },
  };
}

/* ---------- drawing primitives (neon ink on glass) ---------- */

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

function centeredText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxWidth: number, size = 17) {
  if (!text) return;
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, text, maxWidth);
  const lh = size * 1.25;
  lines.forEach((l, i) => ctx.fillText(l, cx, cy + (i - (lines.length - 1) / 2) * lh));
}

function glow(ctx: CanvasRenderingContext2D, color: string, blur = 10) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

function noGlow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

function drawElement(ctx: CanvasRenderingContext2D, e: Element) {
  ctx.globalCompositeOperation = 'source-over';
  if (e.kind === 'clear' || e.kind === 'erase') return;
  if (e.kind === 'eraseArea') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  const col = COLOR_HEX[e.color];
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (e.kind) {
    case 'title': {
      ctx.font = `300 34px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      glow(ctx, col, 14);
      ctx.fillText(e.text.toUpperCase(), BOARD_WIDTH / 2, 44);
      const w = Math.min(BOARD_WIDTH - 80, ctx.measureText(e.text.toUpperCase()).width + 40);
      ctx.beginPath();
      ctx.moveTo(BOARD_WIDTH / 2 - w / 2, 74);
      ctx.lineTo(BOARD_WIDTH / 2 + w / 2, 74);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      noGlow(ctx);
      break;
    }
    case 'text':
      ctx.font = `19px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      glow(ctx, col, 6);
      wrap(ctx, e.text, BOARD_WIDTH - e.x - 20).forEach((l, i) => ctx.fillText(l, e.x, e.y + i * 25));
      noGlow(ctx);
      break;
    case 'box':
      ctx.beginPath();
      ctx.roundRect(e.x, e.y, e.w, e.h, 12);
      ctx.fillStyle = `${col}1f`;
      ctx.fill();
      glow(ctx, col, 12);
      ctx.stroke();
      noGlow(ctx);
      ctx.fillStyle = '#f4f6ff';
      centeredText(ctx, e.text, e.x + e.w / 2, e.y + e.h / 2, e.w - 16);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fillStyle = `${col}1f`;
      ctx.fill();
      glow(ctx, col, 12);
      ctx.stroke();
      noGlow(ctx);
      ctx.fillStyle = '#f4f6ff';
      centeredText(ctx, e.text, e.x, e.y, e.r * 1.6);
      break;
    case 'line':
      glow(ctx, col, 8);
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      noGlow(ctx);
      break;
    case 'arrow': {
      glow(ctx, col, 8);
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      const a = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
      const head = 12;
      ctx.beginPath();
      ctx.moveTo(e.x2, e.y2);
      ctx.lineTo(e.x2 - head * Math.cos(a - 0.45), e.y2 - head * Math.sin(a - 0.45));
      ctx.lineTo(e.x2 - head * Math.cos(a + 0.45), e.y2 - head * Math.sin(a + 0.45));
      ctx.closePath();
      ctx.fill();
      noGlow(ctx);
      if (e.text) {
        const mx = (e.x1 + e.x2) / 2;
        const my = (e.y1 + e.y2) / 2;
        ctx.font = `15px ${FONT}`;
        const w = Math.min(260, ctx.measureText(e.text).width + 14);
        ctx.fillStyle = 'rgba(10,14,36,0.85)';
        ctx.beginPath();
        ctx.roundRect(mx - w / 2, my - 12, w, 24, 8);
        ctx.fill();
        ctx.fillStyle = col;
        centeredText(ctx, e.text, mx, my, 250, 15);
      }
      break;
    }
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.globalCompositeOperation = s.mode === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = s.mode === 'eraser' ? '#000' : s.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.mode === 'pen') glow(ctx, s.color, 6);
  if (s.points.length === 1) {
    ctx.beginPath();
    ctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  noGlow(ctx);
  ctx.globalCompositeOperation = 'source-over';
}
