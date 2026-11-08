/** Natural voice (Kokoro): speakable text, verified downloads, voice list, real engine (optional). */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanForSpeech, MAX_SPOKEN_CHARS } from '../speech/speakable.js';
import { DEFAULT_VOICE, isVoice, KOKORO_FILES, KOKORO_REVISION, kokoroUrl, VOICES } from '../speech/kokoro-files.js';
import { KokoroEngine } from '../speech/kokoro.js';
import { ROOT, tmpDir } from './helpers.js';

describe('speakable text', () => {
  it('removes markdown, links, code and emoji, and turns list items into sentences', () => {
    const out = cleanForSpeech(
      '## Summary\n**Good news!** You have *3* new emails 🎉:\n- One from Mom\n- One from HR\n\nSee [the inbox](https://mail.google.com) or https://example.com/x.\n```js\nconsole.log(1)\n```\nUse `npm start`.',
    );
    expect(out).not.toMatch(/[*#`]|https?:|🎉|console\.log/);
    expect(out).toContain('Good news! You have 3 new emails');
    expect(out).toContain('One from Mom.');
    expect(out).toContain('See the inbox or a link.');
    expect(out).toContain('I have put the code in the chat.');
    expect(out).toContain('Use npm start.');
  });

  it('cuts very long replies at a sentence and says the rest is in the chat', () => {
    const long = Array.from({ length: 200 }, (_, i) => `This is sentence number ${i}.`).join(' ');
    const out = cleanForSpeech(long);
    expect(out.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS + 30);
    expect(out.endsWith('The rest is in the chat.')).toBe(true);
  });

  it('returns nothing to say for an empty reply', () => {
    expect(cleanForSpeech('  ** ``` ```  ')).toBe('(I have put the code in the chat.)');
    expect(cleanForSpeech('')).toBe('');
  });
});

describe('voice model files', () => {
  it('are pinned to one revision and checked with SHA-256', () => {
    expect(KOKORO_REVISION).toMatch(/^[0-9a-f]{40}$/);
    for (const f of KOKORO_FILES) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(kokoroUrl(f.path)).toContain(`/resolve/${KOKORO_REVISION}/`);
    }
    expect(KOKORO_FILES.find((f) => f.path === 'onnx/model_fp16.onnx')?.bytes).toBe(163234740);
  });

  it('every voice in the picker ships with kokoro-js', () => {
    for (const v of VOICES) expect(fs.existsSync(path.join(ROOT, 'node_modules', 'kokoro-js', 'voices', `${v.id}.bin`)), v.id).toBe(true);
    expect(isVoice(DEFAULT_VOICE)).toBe(true);
    expect(isVoice('not_a_voice')).toBe(false);
  });

  it('a tampered download is rejected and nothing is installed', async () => {
    const dir = tmpDir();
    const fake = (async () => new Response('tampered', { headers: { 'content-length': '8' } })) as typeof fetch;
    const engine = new KokoroEngine(dir, 'unused-worker.mjs', fake);
    expect(engine.status().installed).toBe(false);
    await expect(engine.install()).rejects.toThrow(/checksum/);
    expect(engine.status().installed).toBe(false);
    const leftovers = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.(json|onnx|part)$/.test(f));
    expect(leftovers).toEqual([]);
  });

  it('installing a newer model removes the old one so it does not take up space', async () => {
    const dir = tmpDir();
    const old = path.join(dir, 'onnx-community', 'Kokoro-82M-v1.0-ONNX', 'onnx', 'model_old.onnx');
    const oldRepo = path.join(dir, 'some-older-repo', 'model.onnx');
    for (const f of [old, oldRepo]) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, 'old model');
    }
    const engine = new KokoroEngine(dir, 'unused-worker.mjs');
    // pretend the current model is already downloaded
    for (const f of KOKORO_FILES) {
      const p = path.join(dir, 'onnx-community', 'Kokoro-82M-v1.0-ONNX', ...f.path.split('/'));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '');
      fs.truncateSync(p, f.bytes);
    }
    await engine.install();
    expect(engine.status().installed).toBe(true);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'some-older-repo'))).toBe(false);
  });
});

// Real speech: runs only where the model has been downloaded (set JARVIS_TEST_KOKORO_DIR) and after `npm run build`.
const realDir = process.env.JARVIS_TEST_KOKORO_DIR;
describe.skipIf(!realDir)('natural voice engine (real)', () => {
  it('speaks a reply sentence by sentence and can be stopped', async () => {
    const engine = new KokoroEngine(realDir!, path.join(ROOT, 'dist', 'speech', 'kokoro-worker.mjs'));
    expect(engine.status().installed).toBe(true);
    const chunks: number[] = [];
    const a = engine.speak('Hello there. This is Jarvis speaking.', 'bm_george', 1, (c) => chunks.push(c.audio.length));
    expect(await a.done).toEqual({ cancelled: false });
    expect(chunks.length).toBe(2);
    let got = 0;
    const b = engine.speak('One. Two. Three. Four. Five. Six.', 'bm_george', 1, () => {
      if (++got === 1) engine.cancel(b.id);
    });
    expect((await b.done).cancelled).toBe(true);
    expect(got).toBeLessThan(6);
    engine.dispose();
  }, 60000);
});

describe('speech pieces', () => {
  it('keeps the first piece short so the voice starts quickly, and never makes very long pieces', async () => {
    const { speechChunks, FIRST_CHUNK_CHARS, CHUNK_CHARS } = await import('../speech/chunks.js');
    const story =
      'Once upon a time, in a dense, green jungle, lived a mighty and ferocious lion named Bhasuraka, who was strong, proud, and cruel to every animal that crossed his path. ' +
      'Every day he hunted many animals. Mr. Rabbit was afraid.';
    const pieces = speechChunks(story);
    expect(pieces[0].length).toBeLessThanOrEqual(FIRST_CHUNK_CHARS);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(CHUNK_CHARS);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(story.trim());
    expect(pieces).toContain('Mr. Rabbit was afraid.'); // "Mr." does not end a sentence
    expect(speechChunks('Hello there. This is Jarvis speaking.')).toEqual(['Hello there.', 'This is Jarvis speaking.']);
  });
});
