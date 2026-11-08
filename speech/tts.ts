/**
 * Speaking replies in the window. Uses the natural local voice (Kokoro, streamed
 * sentence by sentence from the main process) when it is installed; otherwise the
 * OS voice through the Web Speech API. T8: never through Claude.
 */
import { cleanForSpeech } from './speakable.js';

export interface TtsApi {
  ttsSpeak(text: string, opts?: { voice?: string }): Promise<number | null>;
  ttsStop(id?: number): void;
  onTtsChunk(cb: (c: { id: number; rate: number; audio: Float32Array }) => void): void;
  onTtsDone(cb: (d: { id: number; error?: string }) => void): void;
  onTtsStopAll(cb: () => void): void;
}

let api: TtsApi | null = null;
let ctx: AudioContext | null = null;
let sources: AudioBufferSourceNode[] = [];
let nextTime = 0;
let current: { id: number; text: string; onEnd?: () => void; done: boolean; chunks: number } | null = null;

export function initTts(bridge: TtsApi): void {
  api = bridge;
  bridge.onTtsChunk((c) => {
    if (!current || c.id !== current.id) return;
    ctx ??= new AudioContext();
    const buffer = ctx.createBuffer(1, c.audio.length, c.rate);
    buffer.copyToChannel(new Float32Array(c.audio), 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, nextTime);
    src.start(at);
    nextTime = at + buffer.duration;
    sources.push(src);
    current.chunks++;
    src.onended = () => {
      sources = sources.filter((s) => s !== src);
      finishIfDone();
    };
  });
  bridge.onTtsDone((d) => {
    if (!current || d.id !== current.id) return;
    current.done = true;
    // The natural voice failed before saying anything: fall back to the OS voice.
    if (d.error && current.chunks === 0) {
      const { text, onEnd } = current;
      current = null;
      systemSpeak(text, onEnd);
      return;
    }
    finishIfDone();
  });
  bridge.onTtsStopAll(() => stopSpeaking());
}

function finishIfDone() {
  if (current && current.done && sources.length === 0) {
    const end = current.onEnd;
    current = null;
    nextTime = 0;
    end?.();
  }
}

function systemSpeak(text: string, onEnd?: () => void): void {
  if (typeof speechSynthesis === 'undefined') {
    onEnd?.();
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(cleanForSpeech(text).slice(0, 1500));
  if (onEnd) {
    u.onend = () => onEnd();
    u.onerror = () => onEnd();
  }
  speechSynthesis.speak(u);
}

/** Speak a reply. `onEnd` runs when speaking finishes (not when it is stopped). */
export async function speak(text: string, onEnd?: () => void, opts: { voice?: string } = {}): Promise<void> {
  stopSpeaking();
  const id = api ? await api.ttsSpeak(text, opts).catch(() => null) : null;
  if (id === null) {
    systemSpeak(text, onEnd);
    return;
  }
  current = { id, text, onEnd, done: false, chunks: 0 };
}

export function stopSpeaking(): void {
  for (const s of sources) {
    s.onended = null;
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
  }
  sources = [];
  nextTime = 0;
  if (current && api) api.ttsStop(current.id);
  current = null;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
