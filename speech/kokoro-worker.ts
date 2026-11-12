/**
 * Worker thread: loads Kokoro once and turns text into 24 kHz audio,
 * one sentence at a time, so speech can start before the whole reply is ready.
 * Runs off the main thread so the app, hotkeys and microphone stay responsive.
 */
import os from 'node:os';
import { parentPort } from 'node:worker_threads';
import { KokoroTTS } from 'kokoro-js';
import { AutoTokenizer, env, StyleTextToSpeech2Model } from '@huggingface/transformers';
import { pauseAfter, speechChunks, tidyPiece } from './chunks.js';
import { KOKORO_DTYPE } from './kokoro-files.js';

type In =
  | { type: 'init'; modelDir: string; repo: string }
  | { type: 'speak'; id: number; text: string; voice: string; speed: number }
  | { type: 'cancel'; id: number };

let tts: Promise<KokoroTTS> | null = null;
const cancelled = new Set<number>();
let repo = '';

async function load(modelDir: string): Promise<KokoroTTS> {
  env.allowRemoteModels = false; // only the verified local files
  env.allowLocalModels = true;
  env.localModelPath = modelDir;
  // Loaded directly (not KokoroTTS.from_pretrained) so the CPU thread count can be set:
  // the default leaves most cores idle. More than about 8 threads stops helping.
  const threads = Math.max(2, Math.min(8, Math.floor(os.availableParallelism() / 2)));
  const [model, tokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(repo, {
      dtype: KOKORO_DTYPE,
      device: 'cpu',
      session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
    } as never),
    AutoTokenizer.from_pretrained(repo),
  ]);
  return new KokoroTTS(model as never, tokenizer as never);
}

parentPort!.on('message', async (msg: In) => {
  if (msg.type === 'init') {
    repo = msg.repo;
    tts ??= load(msg.modelDir);
    try {
      await tts;
      parentPort!.postMessage({ type: 'ready' });
    } catch (err) {
      tts = null;
      parentPort!.postMessage({ type: 'error', message: String(err) });
    }
    return;
  }
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }
  if (msg.type === 'speak') {
    // One request at a time, in order: a lesson asks for its next steps ahead of time,
    // and those must not slow down the step that is playing now.
    queue = queue.then(() => speak(msg));
  }
});

let queue: Promise<void> = Promise.resolve();

async function speak(msg: Extract<In, { type: 'speak' }>): Promise<void> {
  {
    const { id } = msg;
    try {
      const engine = await tts!;
      let index = 0;
      // A short first piece so the voice starts quickly; each piece plays while the next is made.
      for (const piece of speechChunks(msg.text)) {
        if (cancelled.has(id)) break;
        const audio = await engine.generate(piece, { voice: msg.voice as never, speed: msg.speed });
        if (cancelled.has(id)) break;
        const raw = audio.audio as Float32Array;
        // safety net: a broken (NaN/Infinity) sample would make the rest of the piece silent
        for (let i = 0; i < raw.length; i++) if (!Number.isFinite(raw[i])) raw[i] = 0;
        // trim the model's padding and add a natural pause for how the piece ends (own buffer, so it can be transferred)
        const copy = tidyPiece(raw, audio.sampling_rate, pauseAfter(piece));
        // words and pause let the window show each word while it is being said
        const words = piece.split(/\s+/).filter(Boolean).length;
        parentPort!.postMessage({ type: 'chunk', id, index: index++, rate: audio.sampling_rate, audio: copy, words, pause: pauseAfter(piece) }, [copy.buffer as ArrayBuffer]);
      }
      parentPort!.postMessage({ type: 'done', id, cancelled: cancelled.has(id) });
    } catch (err) {
      parentPort!.postMessage({ type: 'done', id, error: String(err) });
    } finally {
      cancelled.delete(id);
    }
  }
}
