/**
 * Lesson narration with no waiting: the voice for upcoming steps is made ahead
 * of time (in order, by the local voice engine) and kept, so each step can start
 * its voice and its animation together, the next step follows straight away, and
 * replaying or going back is instant. Falls back to the OS voice if the natural
 * voice is not installed.
 */
import { cleanForSpeech } from '../../speech/speakable.js';

export interface NarratorApi {
  ttsSpeak(text: string, opts?: { voice?: string }): Promise<number | null>;
  ttsStop(id?: number): void;
  onTtsChunk(cb: (c: { id: number; rate: number; audio: Float32Array }) => void): void;
  onTtsDone(cb: (d: { id: number; error?: string; cancelled?: boolean }) => void): void;
}

interface Clip {
  text: string;
  id: number | null;
  chunks: { audio: Float32Array; rate: number }[];
  done: boolean;
  /** No natural voice for this clip: use the OS voice when it plays. */
  system: boolean;
  wake: Set<() => void>;
}

export class Narrator {
  private clips = new Map<number, Clip>();
  private byId = new Map<number, Clip>();
  /** Chunks that arrive before the request's id is known. */
  private early = new Map<number, { chunks: Clip['chunks']; done?: { error?: string; cancelled?: boolean } }>();
  private ctx: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private playing: { clip: Clip; next: number; at: number; onEnd: () => void; my: number } | null = null;
  private seq = 0;

  constructor(private readonly api: NarratorApi) {
    api.onTtsChunk((c) => {
      const clip = this.byId.get(c.id);
      if (!clip) {
        const e = this.early.get(c.id) ?? { chunks: [] };
        e.chunks.push({ audio: c.audio, rate: c.rate });
        this.early.set(c.id, e);
        return;
      }
      clip.chunks.push({ audio: c.audio, rate: c.rate });
      this.notify(clip);
    });
    api.onTtsDone((d) => {
      const clip = this.byId.get(d.id);
      if (!clip) {
        const e = this.early.get(d.id) ?? { chunks: [] };
        e.done = d;
        this.early.set(d.id, e);
        return;
      }
      this.finish(clip, d);
    });
  }

  private finish(clip: Clip, d: { error?: string; cancelled?: boolean }) {
    if (clip.id !== null) this.byId.delete(clip.id);
    if (d.cancelled) {
      // stopped half-way (e.g. push-to-talk): forget it so it is made again when needed
      for (const [k, c] of this.clips) if (c === clip) this.clips.delete(k);
    }
    clip.done = true;
    if (d.error && clip.chunks.length === 0) clip.system = true;
    this.notify(clip);
  }

  private notify(clip: Clip) {
    for (const f of [...clip.wake]) f();
    if (this.playing?.clip === clip) this.schedule();
  }

  /** Asks for the voice of one step (once); requests run one after another in the engine. */
  prefetch(key: number, text: string): void {
    const have = this.clips.get(key);
    if (have && have.text === text) return;
    const clip: Clip = { text, id: null, chunks: [], done: false, system: false, wake: new Set() };
    this.clips.set(key, clip);
    if (!text.trim()) {
      clip.done = true;
      return;
    }
    void this.api
      .ttsSpeak(text)
      .catch(() => null)
      .then((id) => {
        if (id === null) {
          clip.system = true;
          clip.done = true;
          this.notify(clip);
          return;
        }
        clip.id = id;
        this.byId.set(id, clip);
        const e = this.early.get(id);
        if (e) {
          this.early.delete(id);
          clip.chunks.push(...e.chunks);
          if (e.done) this.finish(clip, e.done);
          else this.notify(clip);
        }
      });
  }

  /** Resolves when the step can start speaking right away. Returns its length when already known. */
  async ready(key: number, text: string): Promise<{ ms: number | null }> {
    this.prefetch(key, text);
    const clip = this.clips.get(key)!;
    if (!clip.chunks.length && !clip.done) {
      await new Promise<void>((resolve) => {
        const f = () => {
          if (clip.chunks.length || clip.done) {
            clip.wake.delete(f);
            resolve();
          }
        };
        clip.wake.add(f);
      });
    }
    if (clip.system) return { ms: null };
    return { ms: clip.done ? clip.chunks.reduce((s, c) => s + (c.audio.length / c.rate) * 1000, 0) : null };
  }

  /** Plays a step's voice (from the start). `onEnd` runs when it has finished, not when stopped. */
  play(key: number, text: string, onEnd: () => void): void {
    this.stop();
    this.prefetch(key, text);
    const clip = this.clips.get(key)!;
    const my = ++this.seq;
    if (clip.system) {
      this.systemSay(clip.text, onEnd, my);
      return;
    }
    this.ctx ??= new AudioContext();
    this.playing = { clip, next: 0, at: this.ctx.currentTime + 0.02, onEnd, my };
    this.schedule();
  }

  private schedule() {
    const p = this.playing;
    if (!p || !this.ctx) return;
    if (p.clip.system) {
      // the natural voice failed before saying anything: use the OS voice
      this.playing = null;
      this.systemSay(p.clip.text, p.onEnd, p.my);
      return;
    }
    while (p.next < p.clip.chunks.length) {
      const c = p.clip.chunks[p.next++];
      const buffer = this.ctx.createBuffer(1, c.audio.length, c.rate);
      buffer.copyToChannel(new Float32Array(c.audio), 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.ctx.destination);
      const at = Math.max(this.ctx.currentTime + 0.01, p.at);
      src.start(at);
      p.at = at + buffer.duration;
      this.sources.push(src);
      src.onended = () => {
        this.sources = this.sources.filter((s) => s !== src);
        this.endIfDone();
      };
    }
    this.endIfDone();
  }

  private endIfDone() {
    const p = this.playing;
    if (p && p.clip.done && p.next >= p.clip.chunks.length && this.sources.length === 0) {
      this.playing = null;
      p.onEnd();
    }
  }

  private systemSay(text: string, onEnd: () => void, my: number) {
    if (typeof speechSynthesis === 'undefined') {
      setTimeout(onEnd, 1500);
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(cleanForSpeech(text));
    u.onend = () => my === this.seq && onEnd();
    u.onerror = () => my === this.seq && onEnd();
    speechSynthesis.speak(u);
  }

  /** Stops what is playing; prepared voice is kept for replay. */
  stop(): void {
    this.seq++;
    this.playing = null;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  /** After a jump: stop making voice for steps outside [from, to], so the wanted step is not stuck in line. */
  keepOnly(from: number, to: number): void {
    for (const [k, c] of this.clips) {
      if ((k < from || k > to) && !c.done) {
        if (c.id !== null) this.api.ttsStop(c.id);
        this.clips.delete(k);
      }
    }
  }

  /** Forgets everything (new lesson): cancels voice still being made. */
  reset(): void {
    this.stop();
    for (const c of this.clips.values()) if (!c.done && c.id !== null) this.api.ttsStop(c.id);
    this.clips.clear();
    this.byId.clear();
    this.early.clear();
  }
}
