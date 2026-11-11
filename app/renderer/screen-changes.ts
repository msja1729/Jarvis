/** Watches the screen being recorded and sends a sharp picture each time it shows something new. */
import { ChangeDetector, THUMB_H, THUMB_W, toGrey } from '../../speech/screen-diff.js';

const SAMPLE_MS = 2000;
const MAX_SIDE = 1280; // the most the gateway lets through to Claude

export class ScreenChanges {
  private video = document.createElement('video');
  private thumb = document.createElement('canvas');
  private timer = 0;
  private detector = new ChangeDetector({ minGapMs: 8000, max: 300 });
  private t0 = performance.now();

  constructor(
    track: MediaStreamTrack,
    private readonly onPicture: (jpeg: Uint8Array) => void,
  ) {
    this.video.muted = true;
    this.video.srcObject = new MediaStream([track]);
    this.thumb.width = THUMB_W;
    this.thumb.height = THUMB_H;
  }

  start(): void {
    void this.video.play().catch(() => undefined);
    this.timer = window.setInterval(() => void this.tick(), SAMPLE_MS);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.video.pause();
    this.video.srcObject = null;
  }

  private async tick() {
    const v = this.video;
    if (!v.videoWidth || !v.videoHeight) return;
    const g = this.thumb.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(v, 0, 0, THUMB_W, THUMB_H);
    const grey = toGrey(g.getImageData(0, 0, THUMB_W, THUMB_H).data);
    if (!this.detector.sample(grey, performance.now() - this.t0)) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (blob) this.onPicture(new Uint8Array(await blob.arrayBuffer()));
  }
}
