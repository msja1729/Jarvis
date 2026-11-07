/** Phase 3: screen look (criteria 14, 23) and whiteboard (criterion 24). */
import { describe, expect, it } from 'vitest';
import { checkAttachment, imageSize } from '../gateway/image-guard.js';
import { defaultSetting, SettingsStore } from '../gateway/settings.js';
import { JARVIS_SYSTEM_PROMPT, wordCount } from '../brain/system-prompt.js';
import { pickModel } from '../router/model.js';
import { SCREEN_APP } from '../tools/screen/definition.js';
import { CapturedImage, ScreenBackend, ScreenChoice, ScreenExecutor, ScreenSource, ScreenUI, toPixelRect } from '../tools/screen/executor.js';
import { WHITEBOARD_APP } from '../tools/whiteboard/definition.js';
import { WhiteboardExecutor } from '../tools/whiteboard/executor.js';
import { jpegSize, jpegToPdf } from '../tools/whiteboard/pdf.js';
import { BOARD_HEIGHT, BOARD_WIDTH, describeScene, Element, normalizeSteps } from '../tools/whiteboard/scene.js';
import { makeCore } from './helpers.js';

/** Minimal JPEG (SOI + SOF0 + EOI) whose header carries the given size. */
function tinyJpeg(width: number, height: number): Buffer {
  const b = Buffer.alloc(2 + 19 + 2);
  b.writeUInt16BE(0xffd8, 0);
  b.writeUInt16BE(0xffc0, 2);
  b.writeUInt16BE(17, 4);
  b[6] = 8;
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  b[11] = 3;
  b.writeUInt16BE(0xffd9, 21);
  return b;
}

function pngOf(width: number, height: number): string {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b.toString('base64');
}

class FakeImage implements CapturedImage {
  ops: string[] = [];
  constructor(
    public width: number,
    public height: number,
  ) {}
  crop(r: { x: number; y: number; width: number; height: number }) {
    const n = new FakeImage(r.width, r.height);
    n.ops = [...this.ops, `crop ${r.x},${r.y},${r.width}x${r.height}`];
    return n;
  }
  resize(w: number, h: number) {
    const n = new FakeImage(w, h);
    n.ops = [...this.ops, `resize ${w}x${h}`];
    return n;
  }
  toJpegBase64() {
    return tinyJpeg(this.width, this.height).toString('base64');
  }
  toPreviewDataUrl() {
    return 'data:image/jpeg;base64,preview';
  }
}

function screenHarness(opts: { choice?: ScreenChoice | null; area?: { x: number; y: number; width: number; height: number } | null; size?: [number, number]; permission?: 'granted' | 'denied' } = {}) {
  const sources: ScreenSource[] = [
    { id: 'screen:0', name: 'Whole screen', kind: 'screen', thumbnail: 'data:,' },
    { id: 'window:42', name: 'Chrome – error page', kind: 'window', thumbnail: 'data:,' },
  ];
  const calls = { capture: 0, indicate: 0, pick: 0 };
  let req = 1;
  const [w, h] = opts.size ?? [3840, 2160];
  const backend: ScreenBackend = {
    permission: () => opts.permission ?? 'granted',
    sources: async () => sources,
    currentScreen: async () => sources[0],
    capture: async () => {
      calls.capture++;
      return new FakeImage(w, h);
    },
  };
  const ui: ScreenUI = {
    pick: async () => {
      calls.pick++;
      return opts.choice === undefined ? { sourceId: 'screen:0', area: false } : opts.choice;
    },
    pickArea: async () => (opts.area === undefined ? { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } : opts.area),
    indicate: () => calls.indicate++,
  };
  const exec = new ScreenExecutor(backend, ui, () => req);
  return { exec, calls, nextRequest: () => req++ };
}

describe('C23 screen look: exactly one capture per request, with an indicator', () => {
  it('C23 by default captures the current screen once, with no picker, and shows the indicator', async () => {
    const h = screenHarness();
    const r = await h.exec.call('look', { reason: 'explain this error' });
    expect(h.calls).toEqual({ capture: 1, indicate: 1, pick: 0 });
    expect(r.images).toHaveLength(1);
    expect(r.text).toContain('Whole screen');
  });

  it('C23 a picker appears only when the user asks for a specific window', async () => {
    const h = screenHarness({ choice: { sourceId: 'window:42', area: false } });
    const r = await h.exec.call('look', { target: 'window' });
    expect(h.calls.pick).toBe(1);
    expect(r.text).toContain('the window "Chrome – error page"');
  });

  it('C23 a second capture in the same request is refused; the next request may capture again', async () => {
    const h = screenHarness();
    await h.exec.call('look', {});
    await expect(h.exec.call('look', {})).rejects.toThrow(/one screen capture/);
    expect(h.calls.capture).toBe(1);
    h.nextRequest();
    await h.exec.call('look', {});
    expect(h.calls.capture).toBe(2);
  });

  it('C23 nothing is captured if the user cancels the picker', async () => {
    const h = screenHarness({ choice: null });
    await expect(h.exec.call('look', { target: 'window' })).rejects.toThrow(/cancelled/);
    expect(h.calls.capture).toBe(0);
    expect(h.calls.indicate).toBe(0);
  });

  it('C23 explains how to grant permission on macOS when it is denied', async () => {
    const h = screenHarness({ permission: 'denied' });
    await expect(h.exec.call('look', {})).rejects.toThrow(/Screen Recording/);
    expect(h.calls.pick).toBe(0);
  });

  it('C23 through the Gateway: the screenshot passes the image guard', async () => {
    const h = screenHarness();
    const core = makeCore([SCREEN_APP], { screen: h.exec });
    expect(core.core.listTools().map((t) => t.name)).toContain('screen__look');
    const r = await core.core.callTool('screen__look', {});
    expect(r.isError).toBe(false);
    expect(r.images![0].mimeType).toBe('image/jpeg');
  });
});

describe('C14 screenshots are cropped and scaled to at most 1280 px', () => {
  it('C14 a 4K screen is scaled to 1280x720', async () => {
    const h = screenHarness();
    const r = await h.exec.call('look', {});
    const size = imageSize(Buffer.from(r.images![0].data, 'base64'))!;
    expect(size).toEqual({ width: 1280, height: 720 });
    expect(checkAttachment(r.images![0])).toBeNull();
  });

  it('C14 a selected area is cropped first, then scaled only if needed', async () => {
    const h = screenHarness({ area: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
    const r = await h.exec.call('look', { target: 'area' });
    const size = imageSize(Buffer.from(r.images![0].data, 'base64'))!;
    expect(size).toEqual({ width: 1280, height: 720 }); // 1920x1080 crop → scaled
    expect(r.text).toContain('an area of Whole screen');
    expect(h.calls.pick).toBe(0); // area goes straight to the area selector on the current screen
    const small = screenHarness({ area: { x: 0, y: 0, width: 0.2, height: 0.2 } });
    const r2 = await small.exec.call('look', { target: 'area' });
    expect(imageSize(Buffer.from(r2.images![0].data, 'base64'))).toEqual({ width: 768, height: 432 });
  });

  it('C14 area rectangles are clamped to the image', () => {
    expect(toPixelRect({ x: -0.5, y: 0.9, width: 2, height: 0.5 }, 1000, 500)).toEqual({ x: 0, y: 450, width: 1000, height: 50 });
    expect(toPixelRect({ x: 0.5, y: 0.5, width: 0, height: 0 }, 1000, 500)).toEqual({ x: 500, y: 250, width: 8, height: 8 });
  });
});

describe('C24 whiteboard', () => {
  /** What Claude typically sends for "Explain binary search on the whiteboard". */
  const binarySearch = [
    { type: 'title', text: 'Binary search' },
    { type: 'box', id: 'arr', x: 100, y: 120, w: 1000, h: 70, text: '[1, 3, 5, 7, 9, 11, 13]' },
    { type: 'box', id: 'mid', x: 500, y: 260, w: 200, h: 70, text: 'Check middle (7)', color: 'blue' },
    { type: 'box', id: 'left', x: 200, y: 420, w: 220, h: 70, text: 'Target < 7: search left half' },
    { type: 'box', id: 'right', x: 780, y: 420, w: 220, h: 70, text: 'Target > 7: search right half' },
    { type: 'arrow', from: 'arr', to: 'mid' },
    { type: 'arrow', from: 'mid', to: 'left', text: 'smaller' },
    { type: 'arrow', from: 'mid', to: 'right', text: 'bigger' },
    { type: 'text', x: 100, y: 560, text: 'Each step halves the search space: O(log n).' },
  ];

  it('C24 a title and a diagram are drawn', async () => {
    const drawn: Element[][] = [];
    const exec = new WhiteboardExecutor({ draw: async (e) => void drawn.push(e), snapshot: async () => ({ pngBase64: pngOf(1200, 700), userStrokes: 0 }) });
    const r = await exec.call('draw', { steps: binarySearch });
    expect(r.text).toBe('Drew 9 item(s) on the whiteboard.');
    const kinds = drawn[0].map((e) => e.kind);
    expect(kinds[0]).toBe('title');
    expect(kinds.filter((k) => k === 'box')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'arrow')).toHaveLength(3);
  });

  it('C24 arrows start and end on shape edges, and everything stays on the board', () => {
    const { elements, warnings } = normalizeSteps([
      { type: 'box', id: 'a', x: 100, y: 100, w: 200, h: 100 },
      { type: 'circle', id: 'b', x: 700, y: 150, r: 50 },
      { type: 'arrow', from: 'a', to: 'b' },
      { type: 'box', x: 5000, y: -40, w: 300, h: 80 },
      { type: 'arrow', from: 'a', to: 'missing' },
      { type: 'sparkle' },
    ]);
    const arrow = elements.find((e) => e.kind === 'arrow') as Extract<Element, { kind: 'arrow' }>;
    expect(arrow.x1).toBe(300); // right edge of box a
    expect(arrow.x2).toBe(650); // left edge of circle b
    const far = elements[3] as Extract<Element, { kind: 'box' }>;
    expect(far.x + far.w).toBeLessThanOrEqual(BOARD_WIDTH);
    expect(far.y).toBeGreaterThanOrEqual(0);
    expect(warnings).toHaveLength(2);
  });

  it('C24 arrows can connect to shapes drawn in an earlier call', async () => {
    const drawn: Element[][] = [];
    const exec = new WhiteboardExecutor({ draw: async (e) => void drawn.push(e), snapshot: async () => ({ pngBase64: '', userStrokes: 0 }) });
    await exec.call('draw', { steps: [{ type: 'box', id: 'x', x: 50, y: 50 }, { type: 'box', id: 'y', x: 600, y: 50 }] });
    await exec.call('draw', { steps: [{ type: 'arrow', from: 'x', to: 'y' }] });
    expect(drawn[1][0].kind).toBe('arrow');
    exec.reset();
    await expect(exec.call('draw', { steps: [{ type: 'arrow', from: 'x', to: 'y' }] })).rejects.toThrow(/Nothing to draw/);
  });

  it('"what did I draw?": look returns a 1200x700 picture plus a summary', async () => {
    const exec = new WhiteboardExecutor({ draw: async () => undefined, snapshot: async () => ({ pngBase64: pngOf(BOARD_WIDTH, BOARD_HEIGHT), userStrokes: 4 }) });
    await exec.call('draw', { steps: binarySearch.slice(0, 2) });
    const r = await exec.call('look', {});
    expect(r.images![0].mimeType).toBe('image/png');
    expect(r.text).toContain('title "Binary search"');
    expect(r.text).toContain('The user drew 4 pen stroke(s).');
    expect(describeScene([{ kind: 'title', text: 'A', color: 'white' }, { kind: 'clear' }])).toContain('has not drawn');
  });

  it('drawing needs no popup (local only); looking is a read; defaults are safe', () => {
    const draw = WHITEBOARD_APP.abilities.find((a) => a.name === 'draw')!;
    const look = WHITEBOARD_APP.abilities.find((a) => a.name === 'look')!;
    expect(defaultSetting(draw)).toBe('allowed');
    expect(defaultSetting(look)).toBe('allowed');
    expect(defaultSetting({ ...draw, group: 'destructive', defaultSetting: 'allowed' })).toBe('ask');
    const s = new SettingsStore(null);
    expect(s.effective(WHITEBOARD_APP, draw)).toBe('allowed');
  });

  it('PDF export embeds the JPEG in a valid one-page PDF', () => {
    const jpeg = tinyJpeg(1200, 700);
    expect(jpegSize(jpeg)).toEqual({ width: 1200, height: 700 });
    const pdf = jpegToPdf(jpeg).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 900 525]');
    // Every xref offset points at the start of its object.
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    const offsets = pdf.slice(xrefAt).match(/^(\d{10}) 00000 n $/gm)!.map((l) => Number(l.slice(0, 10)));
    offsets.forEach((o, i) => expect(pdf.startsWith(`${i + 1} 0 obj
`, o)).toBe(true));
  });
});

describe('phase 3 routing and prompt', () => {
  it('screen and whiteboard requests use the larger model', () => {
    expect(pickModel('look at my screen and explain this error')).toBe('sonnet');
    expect(pickModel('what did I draw?')).toBe('sonnet');
    expect(pickModel('fix this diagram')).toBe('sonnet');
  });
  it('the system prompt is still under 500 words', () => {
    expect(wordCount(JARVIS_SYSTEM_PROMPT)).toBeLessThan(500);
  });
});

describe('whiteboard eraser (Claude can erase too)', () => {
  it('erase by id removes the shape and the arrows attached to it', async () => {
    const drawn: Element[][] = [];
    const exec = new WhiteboardExecutor({ draw: async (e) => void drawn.push(e), snapshot: async () => ({ pngBase64: pngOf(1200, 700), userStrokes: 0 }) });
    await exec.call('draw', {
      steps: [
        { type: 'box', id: 'a', x: 50, y: 100, text: 'A' },
        { type: 'box', id: 'b', x: 600, y: 100, text: 'B' },
        { type: 'arrow', from: 'a', to: 'b' },
      ],
    });
    const r = await exec.call('draw', { steps: [{ type: 'erase', id: 'b' }] });
    expect(r.text).toBe('Erased 1 time(s) on the whiteboard.');
    expect(drawn[1]).toEqual([{ kind: 'erase', id: 'b' }]);
    const look = await exec.call('look', {});
    expect(look.text).toContain('box a "A"');
    expect(look.text).not.toContain('box b');
    expect(look.text).not.toContain('arrow');
  });

  it('erase by area is clamped to the board', () => {
    const { elements } = normalizeSteps([{ type: 'erase', x: 1100, y: 600, w: 500, h: 500 }]);
    expect(elements[0]).toEqual({ kind: 'eraseArea', x: 1100, y: 600, w: 100, h: 100 });
  });

  it('erasing an unknown id is reported, not silently ignored', async () => {
    const exec = new WhiteboardExecutor({ draw: async () => undefined, snapshot: async () => ({ pngBase64: '', userStrokes: 0 }) });
    await expect(exec.call('draw', { steps: [{ type: 'erase', id: 'ghost' }] })).rejects.toThrow(/nothing named "ghost"/);
  });

  it('the tool schema offers the erase step and neon inks', () => {
    const draw = WHITEBOARD_APP.abilities.find((a) => a.name === 'draw')!;
    const item = (draw.inputSchema.properties as any).steps.items.properties;
    expect(item.type.enum).toContain('erase');
    expect(item.color.enum).toEqual(['white', 'cyan', 'magenta', 'purple', 'green', 'yellow', 'orange', 'red']);
  });
});
