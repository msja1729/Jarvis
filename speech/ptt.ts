/**
 * Push-to-talk (SPEC 6.1, criterion 25). Electron global shortcuts only report
 * key presses (not releases), so the hotkey toggles: press to talk; Jarvis stops
 * by itself after a short silence, or when the hotkey is pressed again.
 */
export type PttState = 'idle' | 'listening' | 'transcribing';

export const SPEECH_LEVEL = 0.02; // RMS above this counts as speech
export const SILENCE_MS = 1200; // stop this long after the last speech
export const NO_SPEECH_MS = 8000; // give up if nothing was said
export const MAX_MS = 30000; // hard limit for one utterance

export interface PttDeps {
  startCapture(): Promise<void>;
  /** Stops the microphone and returns the captured 16 kHz PCM. */
  stopCapture(): Promise<Uint8Array>;
  transcribe(pcm: Uint8Array): Promise<string>;
  /** Sends the recognised text to Jarvis. */
  deliver(text: string): void;
  /** UI feedback: listening indicator, "transcribing…", errors. */
  indicate(state: PttState | 'error' | 'nothing', message?: string): void;
  now?: () => number;
}

export class PushToTalk {
  state: PttState = 'idle';
  private startedAt = 0;
  private lastVoice = 0;
  private heard = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: PttDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  /** Hotkey or mic button pressed. */
  async toggle(): Promise<void> {
    if (this.state === 'idle') return this.begin();
    if (this.state === 'listening') return this.finish('manual');
    // While transcribing, extra presses are ignored.
  }

  private async begin() {
    this.state = 'listening';
    this.startedAt = this.now();
    this.lastVoice = this.startedAt;
    this.heard = false;
    try {
      await this.deps.startCapture();
    } catch (err) {
      this.state = 'idle';
      this.deps.indicate('error', `Microphone unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.deps.indicate('listening');
    this.timer = setInterval(() => this.tick(), 200);
  }

  /** Microphone level from the renderer (RMS, 0..1). */
  level(value: number): void {
    if (this.state !== 'listening') return;
    if (value >= SPEECH_LEVEL) {
      this.heard = true;
      this.lastVoice = this.now();
    }
  }

  /** Checks the silence / time limits. Public so tests can drive time. */
  tick(): void {
    if (this.state !== 'listening') return;
    const t = this.now();
    if (this.heard && t - this.lastVoice >= SILENCE_MS) void this.finish('silence');
    else if (!this.heard && t - this.startedAt >= NO_SPEECH_MS) void this.finish('nothing');
    else if (t - this.startedAt >= MAX_MS) void this.finish('max');
  }

  private async finish(why: 'manual' | 'silence' | 'nothing' | 'max') {
    if (this.state !== 'listening') return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = 'transcribing';
    let pcm: Uint8Array;
    try {
      pcm = await this.deps.stopCapture();
    } catch {
      pcm = new Uint8Array();
    }
    if (why === 'nothing' || (!this.heard && why === 'manual') || pcm.length < 16000 * 2 * 0.3) {
      this.state = 'idle';
      this.deps.indicate('nothing', "I didn't hear anything.");
      return;
    }
    this.deps.indicate('transcribing');
    try {
      const text = (await this.deps.transcribe(pcm)).trim();
      this.state = 'idle';
      if (!text) this.deps.indicate('nothing', "I couldn't make out any words.");
      else {
        this.deps.indicate('idle');
        this.deps.deliver(text);
      }
    } catch (err) {
      this.state = 'idle';
      this.deps.indicate('error', err instanceof Error ? err.message : String(err));
    }
  }
}
