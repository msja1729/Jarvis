/**
 * Speaking replies in the window. Uses the natural local voice (Kokoro, streamed
 * piece by piece from the main process) when it is installed; otherwise the OS
 * voice through the Web Speech API. T8: never through Claude.
 *
 * Two ways to speak:
 *  - speak(text): a finished reply.
 *  - speakStream(): a reply that is still being written. Each finished sentence is
 *    sent to the voice at once, so speaking starts while Claude is still writing.
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

/** A reply being spoken while it is still written. */
interface Live {
  voice?: string;
  buf: string;
  /** Voice requests not finished yet. */
  ids: Set<number>;
  /** Sentences sent or waiting to be sent. */
  pending: number;
  ended: boolean;
  onEnd?: () => void;
  queue: Promise<void>;
  /** The natural voice is not available: the OS voice speaks instead. */
  system: boolean;
}
let live: Live | null = null;

/** Everything spoken goes through this, so animations can follow the voice (speechLevel). */
let analyser: AnalyserNode | null = null;
let levelBuf: Float32Array<ArrayBuffer> | null = null;

function output(): AudioNode {
  ctx ??= new AudioContext();
  if (!analyser) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    analyser.connect(ctx.destination);
    levelBuf = new Float32Array(analyser.fftSize);
  }
  return analyser;
}

/** How loud the natural voice is right now, 0..1 (0 when silent or using the OS voice). */
export function speechLevel(): number {
  if (!analyser || !levelBuf || sources.length === 0) return 0;
  analyser.getFloatTimeDomainData(levelBuf);
  let sum = 0;
  for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
  return Math.min(1, Math.sqrt(sum / levelBuf.length) * 4);
}

/** Speak and wait until it has been said (or stopped, or failed). */
export function speakAndWait(text: string, opts: { voice?: string } = {}, maxMs = 60_000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, maxMs);
    void speak(
      text,
      () => {
        clearTimeout(timer);
        resolve();
      },
      opts,
    ).catch(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function play(c: { rate: number; audio: Float32Array }) {
  const out = output();
  ctx ??= new AudioContext();
  const buffer = ctx.createBuffer(1, c.audio.length, c.rate);
  buffer.copyToChannel(new Float32Array(c.audio), 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(out);
  const at = Math.max(ctx.currentTime + 0.03, nextTime);
  src.start(at);
  nextTime = at + buffer.duration;
  sources.push(src);
  src.onended = () => {
    sources = sources.filter((s) => s !== src);
    finishIfDone();
  };
}

export function initTts(bridge: TtsApi): void {
  api = bridge;
  bridge.onTtsChunk((c) => {
    if (live && live.ids.has(c.id)) {
      play(c);
      return;
    }
    if (!current || c.id !== current.id) return;
    current.chunks++;
    play(c);
  });
  bridge.onTtsDone((d) => {
    if (live && live.ids.has(d.id)) {
      live.ids.delete(d.id);
      live.pending--;
      finishIfDone();
      return;
    }
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
  if (live && live.ended && live.pending === 0 && sources.length === 0 && !live.system) {
    const end = live.onEnd;
    live = null;
    nextTime = 0;
    end?.();
  }
}

function systemSpeak(text: string, onEnd?: () => void, queue = false): void {
  if (typeof speechSynthesis === 'undefined') {
    onEnd?.();
    return;
  }
  if (!queue) speechSynthesis.cancel();
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

/** The finished sentences at the start of `buf`, and what is left over. Short ones wait for more. */
export function takeSentences(buf: string, final: boolean, min = 28): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let rest = buf;
  for (;;) {
    // a sentence ends at . ! ? … followed by a space or line break, or at a line break (list items)
    const re = /([.!?…]["')\]]*)(\s+)|\n+/g;
    let cut = -1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest))) {
      const end = m.index + (m[1] ? m[1].length : 0);
      if (rest.slice(0, end).trim().length >= min || m[0].includes('\n')) {
        cut = m.index + m[0].length;
        break;
      }
    }
    if (cut < 0) break;
    const s = rest.slice(0, cut).trim();
    if (s) ready.push(s);
    rest = rest.slice(cut);
  }
  if (final && rest.trim()) {
    ready.push(rest.trim());
    rest = '';
  }
  return { ready, rest };
}

/** Speak a reply that is still being written: push() pieces as they come, end() when it is complete. */
export function speakStream(opts: { voice?: string } = {}): { push(text: string): void; end(onEnd?: () => void): void; cancel(): void } {
  stopSpeaking();
  const me: Live = { voice: opts.voice, buf: '', ids: new Set(), pending: 0, ended: false, queue: Promise.resolve(), system: false };
  live = me;
  const send = (sentence: string) => {
    const text = cleanForSpeech(sentence);
    if (!text) return;
    me.pending++;
    // in order: each request is made after the previous one, and the voice engine works through them in turn
    me.queue = me.queue.then(async () => {
      if (live !== me) return;
      const id = me.system || !api ? null : await api.ttsSpeak(text, { voice: me.voice }).catch(() => null);
      if (live !== me) {
        if (id !== null) api?.ttsStop(id);
        return;
      }
      if (id === null) {
        // no natural voice: the OS voice queues sentences itself
        me.system = true;
        me.pending--;
        const last = me.ended && me.pending === 0;
        systemSpeak(text, last ? () => live === me && endSystem(me) : undefined, true);
        return;
      }
      me.ids.add(id);
    });
  };
  const flush = (final: boolean) => {
    const { ready, rest } = takeSentences(me.buf, final);
    me.buf = rest;
    ready.forEach(send);
  };
  return {
    push(text: string) {
      if (live !== me) return;
      me.buf += text;
      flush(false);
    },
    end(onEnd?: () => void) {
      if (live !== me) return;
      me.onEnd = onEnd;
      flush(true);
      me.ended = true;
      void me.queue.then(() => {
        if (live === me && me.system && me.pending === 0 && (typeof speechSynthesis === 'undefined' || !speechSynthesis.speaking)) endSystem(me);
        finishIfDone();
      });
    },
    cancel() {
      if (live === me) stopSpeaking();
    },
  };
}

function endSystem(me: Live) {
  if (live !== me) return;
  live = null;
  me.onEnd?.();
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
  if (live && api) for (const id of live.ids) api.ttsStop(id);
  live = null;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
