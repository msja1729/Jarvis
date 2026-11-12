/** Phase 3: screen look (criteria 14, 23). The whiteboard was removed at the user's request (Lessons replace it). */
import { describe, expect, it } from 'vitest';
import { checkAttachment, imageSize } from '../gateway/image-guard.js';
import { defaultSetting, SettingsStore } from '../gateway/settings.js';
import { JARVIS_SYSTEM_PROMPT, wordCount } from '../brain/system-prompt.js';
import { modelFor } from '../router/model.js';
import { SCREEN_APP } from '../tools/screen/definition.js';
import { CapturedImage, ScreenBackend, ScreenChoice, ScreenExecutor, ScreenSource, ScreenUI, toPixelRect } from '../tools/screen/executor.js';
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

describe('phase 3 routing and prompt', () => {
  it('screen and drawing requests use the larger model', () => {
    expect(modelFor('pa')).toBe('sonnet');
  });
  it('the system prompt is still under 500 words', () => {
    expect(wordCount(JARVIS_SYSTEM_PROMPT)).toBeLessThan(500);
  });
});

