/** Electron implementation of ScreenBackend (main process only). */
import { BrowserWindow, desktopCapturer, NativeImage, screen, systemPreferences } from 'electron';
import type { CapturedImage, PixelRect, ScreenBackend, ScreenSource } from './executor.js';

function wrap(img: NativeImage): CapturedImage {
  const { width, height } = img.getSize();
  return {
    width,
    height,
    crop: (r: PixelRect) => wrap(img.crop(r)),
    resize: (w: number, h: number) => wrap(img.resize({ width: w, height: h, quality: 'best' })),
    toJpegBase64: () => img.toJPEG(85).toString('base64'),
    toPreviewDataUrl: () => {
      const max = 1600;
      const k = Math.min(1, max / Math.max(width, height));
      const p = k < 1 ? img.resize({ width: Math.round(width * k), height: Math.round(height * k) }) : img;
      return `data:image/jpeg;base64,${p.toJPEG(80).toString('base64')}`;
    },
  };
}

function largestDisplaySize() {
  let w = 0;
  let h = 0;
  for (const d of screen.getAllDisplays()) {
    w = Math.max(w, Math.round(d.size.width * d.scaleFactor));
    h = Math.max(h, Math.round(d.size.height * d.scaleFactor));
  }
  return { width: w || 1920, height: h || 1080 };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ElectronScreenBackend implements ScreenBackend {
  permission(): 'granted' | 'denied' | 'unknown' {
    if (process.platform !== 'darwin') return 'granted';
    const s = systemPreferences.getMediaAccessStatus('screen');
    return s === 'granted' ? 'granted' : s === 'denied' || s === 'restricted' ? 'denied' : 'unknown';
  }

  async sources(): Promise<ScreenSource[]> {
    const list = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: false,
    });
    const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
    return list
      .filter((s) => !own.has(s.id) && !s.thumbnail.isEmpty())
      .map((s) => ({
        id: s.id,
        name: s.id.startsWith('screen') ? (list.filter((x) => x.id.startsWith('screen')).length > 1 ? s.name : 'Whole screen') : s.name,
        kind: s.id.startsWith('screen') ? ('screen' as const) : ('window' as const),
        thumbnail: s.thumbnail.toDataURL(),
      }));
  }

  async currentScreen(): Promise<ScreenSource | null> {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    const hit = list.find((s) => s.display_id === String(display.id)) ?? list[0];
    return hit ? { id: hit.id, name: list.length > 1 ? hit.name : 'your screen', kind: 'screen', thumbnail: '' } : null;
  }

  /** Hides Jarvis's windows so they are not in the picture, captures, then restores them. */
  async capture(sourceId: string): Promise<CapturedImage | null> {
    const visible = BrowserWindow.getAllWindows().filter((w) => w.isVisible() && !w.isDestroyed());
    visible.forEach((w) => w.hide());
    try {
      await wait(350);
      const list = await desktopCapturer.getSources({
        types: [sourceId.startsWith('screen') ? 'screen' : 'window'],
        thumbnailSize: largestDisplaySize(),
        fetchWindowIcons: false,
      });
      const hit = list.find((s) => s.id === sourceId);
      return hit && !hit.thumbnail.isEmpty() ? wrap(hit.thumbnail) : null;
    } finally {
      visible.forEach((w) => !w.isDestroyed() && w.showInactive());
    }
  }
}
