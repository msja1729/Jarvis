/**
 * Whiteboard scene model shared by the main process (validation) and the renderer (drawing).
 * Pure TypeScript: no DOM, no Electron. The board is dark glass, so inks are neon.
 */
export const BOARD_WIDTH = 1200;
export const BOARD_HEIGHT = 700;
export const MAX_STEPS = 80;
export const MAX_TEXT = 200;

export const STEP_TYPES = ['title', 'text', 'box', 'circle', 'arrow', 'line', 'erase', 'clear'] as const;
export const COLORS = ['white', 'cyan', 'magenta', 'purple', 'green', 'yellow', 'orange', 'red'] as const;

export type StepType = (typeof STEP_TYPES)[number];
export type Color = (typeof COLORS)[number];

export const COLOR_HEX: Record<Color, string> = {
  white: '#f4f6ff',
  cyan: '#3ee8ff',
  magenta: '#ff4fd8',
  purple: '#a78bfa',
  green: '#4ade80',
  yellow: '#facc15',
  orange: '#fb923c',
  red: '#ff5c7a',
};

export type Element =
  | { kind: 'title'; text: string; color: Color }
  | { kind: 'text'; x: number; y: number; text: string; color: Color }
  | { kind: 'box'; id?: string; x: number; y: number; w: number; h: number; text: string; color: Color }
  | { kind: 'circle'; id?: string; x: number; y: number; r: number; text: string; color: Color }
  | { kind: 'arrow'; from?: string; to?: string; x1: number; y1: number; x2: number; y2: number; text: string; color: Color }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: Color }
  /** Remove a named shape and any arrows attached to it. */
  | { kind: 'erase'; id: string }
  /** Wipe all ink inside a rectangle (like a real eraser). */
  | { kind: 'eraseArea'; x: number; y: number; w: number; h: number }
  | { kind: 'clear' };

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clampX = (v: unknown, d = 0) => Math.round(Math.min(BOARD_WIDTH, Math.max(0, num(v, d))));
const clampY = (v: unknown, d = 0) => Math.round(Math.min(BOARD_HEIGHT, Math.max(0, num(v, d))));
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');
const color = (v: unknown, d: Color): Color => ((COLORS as readonly string[]).includes(v as string) ? (v as Color) : d);

export type Shape = Extract<Element, { kind: 'box' | 'circle' }>;

/** Point on a shape's border in the direction of (tx, ty), so arrows start/end at edges. */
export function edgePoint(s: Shape, tx: number, ty: number): { x: number; y: number } {
  const cx = s.kind === 'box' ? s.x + s.w / 2 : s.x;
  const cy = s.kind === 'box' ? s.y + s.h / 2 : s.y;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  if (s.kind === 'circle') {
    const d = Math.hypot(dx, dy);
    return { x: cx + (dx / d) * s.r, y: cy + (dy / d) * s.r };
  }
  const k = Math.min(Math.abs(s.w / 2 / (dx || 1e-9)), Math.abs(s.h / 2 / (dy || 1e-9)));
  return { x: cx + dx * k, y: cy + dy * k };
}

function center(s: Shape) {
  return s.kind === 'box' ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : { x: s.x, y: s.y };
}

export interface NormalizeResult {
  elements: Element[];
  warnings: string[];
}

/**
 * Validates Claude's steps into drawable elements. Coordinates are clamped to the
 * board, text is cut to 200 chars, and arrows between ids are resolved to edge points.
 * `known` holds shapes drawn earlier so arrows (and erase) can refer to them.
 */
export function normalizeSteps(raw: unknown, known: Map<string, Shape> = new Map()): NormalizeResult {
  const warnings: string[] = [];
  const elements: Element[] = [];
  const steps = Array.isArray(raw) ? raw.slice(0, MAX_STEPS) : [];
  if (Array.isArray(raw) && raw.length > MAX_STEPS) warnings.push(`only the first ${MAX_STEPS} steps were drawn`);

  for (const [i, s] of steps.entries()) {
    const st = (s ?? {}) as Record<string, unknown>;
    switch (st.type) {
      case 'title':
        elements.push({ kind: 'title', text: str(st.text), color: color(st.color, 'white') });
        break;
      case 'text':
        elements.push({ kind: 'text', x: clampX(st.x, 40), y: clampY(st.y, 100), text: str(st.text), color: color(st.color, 'white') });
        break;
      case 'box': {
        const w = Math.max(30, Math.min(BOARD_WIDTH, num(st.w, 180)));
        const h = Math.max(24, Math.min(BOARD_HEIGHT, num(st.h, 70)));
        const x = Math.min(BOARD_WIDTH - w, clampX(st.x, 40));
        const y = Math.min(BOARD_HEIGHT - h, clampY(st.y, 100));
        const el: Shape = { kind: 'box', id: str(st.id) || undefined, x, y, w: Math.round(w), h: Math.round(h), text: str(st.text), color: color(st.color, 'cyan') };
        if (el.id) known.set(el.id, el);
        elements.push(el);
        break;
      }
      case 'circle': {
        const r = Math.round(Math.max(10, Math.min(300, num(st.r, 50))));
        const el: Shape = {
          kind: 'circle',
          id: str(st.id) || undefined,
          x: Math.min(BOARD_WIDTH - r, Math.max(r, clampX(st.x, 200))),
          y: Math.min(BOARD_HEIGHT - r, Math.max(r, clampY(st.y, 200))),
          r,
          text: str(st.text),
          color: color(st.color, 'magenta'),
        };
        if (el.id) known.set(el.id, el);
        elements.push(el);
        break;
      }
      case 'arrow': {
        const c = color(st.color, 'white');
        if (typeof st.from === 'string' || typeof st.to === 'string') {
          const a = known.get(String(st.from));
          const b = known.get(String(st.to));
          if (!a || !b) {
            warnings.push(`step ${i + 1}: arrow needs existing ids (from "${String(st.from)}" to "${String(st.to)}")`);
            break;
          }
          const p1 = edgePoint(a, center(b).x, center(b).y);
          const p2 = edgePoint(b, center(a).x, center(a).y);
          elements.push({ kind: 'arrow', from: a.id, to: b.id, x1: Math.round(p1.x), y1: Math.round(p1.y), x2: Math.round(p2.x), y2: Math.round(p2.y), text: str(st.text), color: c });
        } else {
          elements.push({ kind: 'arrow', x1: clampX(st.x), y1: clampY(st.y), x2: clampX(st.x2), y2: clampY(st.y2), text: str(st.text), color: c });
        }
        break;
      }
      case 'line':
        elements.push({ kind: 'line', x1: clampX(st.x), y1: clampY(st.y), x2: clampX(st.x2), y2: clampY(st.y2), color: color(st.color, 'white') });
        break;
      case 'erase': {
        if (typeof st.id === 'string' && st.id) {
          if (!known.has(st.id)) {
            warnings.push(`step ${i + 1}: nothing named "${st.id}" to erase`);
            break;
          }
          known.delete(st.id);
          elements.push({ kind: 'erase', id: st.id });
        } else {
          const x = clampX(st.x, 0);
          const y = clampY(st.y, 0);
          const w = Math.max(1, Math.min(BOARD_WIDTH - x, Math.round(num(st.w, 100))));
          const h = Math.max(1, Math.min(BOARD_HEIGHT - y, Math.round(num(st.h, 100))));
          elements.push({ kind: 'eraseArea', x, y, w, h });
        }
        break;
      }
      case 'clear':
        known.clear();
        elements.push({ kind: 'clear' });
        break;
      default:
        warnings.push(`step ${i + 1}: unknown type "${String(st.type)}"`);
    }
  }
  return { elements, warnings };
}

/** True if this element should be removed by erasing `id`. */
export function erasedBy(e: Element, id: string): boolean {
  if ((e.kind === 'box' || e.kind === 'circle') && e.id === id) return true;
  return e.kind === 'arrow' && (e.from === id || e.to === id);
}

/** Apply one element to a scene list (clear and erase-by-id remove things). */
export function applyToScene(scene: Element[], e: Element): Element[] {
  if (e.kind === 'clear') return [];
  if (e.kind === 'erase') return scene.filter((x) => !erasedBy(x, e.id));
  return [...scene, e];
}

/** Short text summary of Claude-drawn elements, sent along with a board snapshot. */
export function describeScene(elements: Element[]): string {
  let visible: Element[] = [];
  for (const e of elements) visible = applyToScene(visible, e);
  const drawn = visible.filter((e) => e.kind !== 'eraseArea');
  if (drawn.length === 0) return 'Jarvis has not drawn anything on the board.';
  const parts = drawn.map((e) => {
    switch (e.kind) {
      case 'title':
        return `title "${e.text}"`;
      case 'text':
        return `text "${e.text}"`;
      case 'box':
        return `box${e.id ? ` ${e.id}` : ''} "${e.text}"`;
      case 'circle':
        return `circle${e.id ? ` ${e.id}` : ''} "${e.text}"`;
      case 'arrow':
        return `arrow${e.from && e.to ? ` ${e.from}→${e.to}` : ''}${e.text ? ` "${e.text}"` : ''}`;
      default:
        return 'line';
    }
  });
  const wiped = visible.some((e) => e.kind === 'eraseArea') ? ' Some areas were erased.' : '';
  return `Jarvis drew: ${parts.join(', ')}.${wiped}`.slice(0, 1500);
}
