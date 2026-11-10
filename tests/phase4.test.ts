/** Phase 4: meeting recorder (criterion 22), push-to-talk (criterion 25), local speech (T8, criterion 15). */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchLocalCommand } from '../router/commands.js';
import { Orchestrator } from '../app/orchestrator.js';
import { SessionManager } from '../brain/session.js';
import { UsageLog } from '../brain/usage.js';
import { floatTo16, rms, wavHeader } from '../speech/pcm.js';
import { MAX_MS, NO_SPEECH_MS, PushToTalk, SILENCE_MS } from '../speech/ptt.js';
import { cleanTranscript, extractZip, WhisperEngine, WHISPER_MODEL } from '../speech/whisper.js';
import { MeetingRecorder, SEGMENT_SECONDS } from '../tools/recorder/recorder.js';
import { PART_CHARS, splitParts, TranscriptExecutor } from '../tools/recorder/executor.js';
import { RECORDER_APP } from '../tools/recorder/definition.js';
import { MAX_RESULT_CHARS } from '../gateway/trim.js';
import { makeCore, tmpDir } from './helpers.js';

const SECOND = 16000 * 2; // bytes of 16 kHz mono 16-bit audio
const silence = (sec: number) => new Uint8Array(Math.round(sec * SECOND));

describe('PCM and WAV helpers', () => {
  it('converts floats to 16-bit PCM with clipping', () => {
    const out = floatTo16(new Float32Array([0, 1, -1, 2, -2]));
    const v = new DataView(out.buffer);
    expect([0, 1, 2, 3, 4].map((i) => v.getInt16(i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768]);
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });
  it('writes a valid 16 kHz mono WAV header', () => {
    const h = Buffer.from(wavHeader(32000));
    expect(h.toString('ascii', 0, 4)).toBe('RIFF');
    expect(h.toString('ascii', 8, 12)).toBe('WAVE');
    expect(h.readUInt32LE(24)).toBe(16000);
    expect(h.readUInt16LE(22)).toBe(1);
    expect(h.readUInt32LE(40)).toBe(32000);
  });
});

describe('C22 meeting recorder', () => {
  it('C22 "record this meeting" and "stop recording" are local commands (0 tokens)', () => {
    for (const t of ['record this meeting', 'Jarvis, record the meeting please', 'start recording', 'start the meeting recording']) {
      expect(matchLocalCommand(t)).toBe('start_recording');
    }
    for (const t of ['stop recording', 'Stop the recording.', 'end the meeting recording']) expect(matchLocalCommand(t)).toBe('stop_recording');
  });

  it('C22 starts instantly, transcribes 30-second parts while recording, and writes one transcript on stop', async () => {
    const dir = tmpDir();
    const seen: string[] = [];
    let n = 0;
    const rec = new MeetingRecorder({ work: path.join(dir, 'rec'), transcripts: path.join(dir, 'tx') }, async (wav) => {
      seen.push(wav);
      const bytes = fs.statSync(wav).size;
      expect(fs.readFileSync(wav).toString('ascii', 0, 4)).toBe('RIFF');
      return `part ${++n} (${Math.round((bytes - 44) / SECOND)}s)`;
    });
    const t0 = Date.now();
    const id = rec.start();
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(rec.recording).toBe(true);
    for (let i = 0; i < 75; i++) rec.push(silence(1)); // 75 seconds in 1-second chunks
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.length).toBe(2); // two full 30 s parts transcribed while the meeting goes on
    const r = await rec.stop();
    expect(rec.recording).toBe(false);
    expect(r.id).toBe(id);
    expect(r.seconds).toBe(75);
    const file = fs.readFileSync(r.transcriptPath, 'utf8');
    expect(file).toContain('[00:00] part 1 (30s)');
    expect(file).toContain(`[00:${SEGMENT_SECONDS}] part 2 (30s)`);
    expect(file).toContain('[01:00] part 3 (15s)');
    expect(file).toContain('Audio is not kept');
    // Audio segments are deleted once transcribed.
    expect(fs.existsSync(path.join(dir, 'rec', id))).toBe(false);
  });

  it('C22 keeps audio for parts that failed to transcribe and says so', async () => {
    const dir = tmpDir();
    const rec = new MeetingRecorder({ work: path.join(dir, 'rec'), transcripts: path.join(dir, 'tx') }, async () => {
      throw new Error('engine missing');
    });
    const id = rec.start();
    rec.push(silence(30));
    const r = await rec.stop();
    expect(r.failedSegments).toBe(1);
    expect(fs.readFileSync(r.transcriptPath, 'utf8')).toContain('could not be transcribed');
    expect(fs.readdirSync(path.join(dir, 'rec', id)).length).toBe(1);
  });

  it('C22 "stop recording" hands the summary to Claude as a separate follow-up request', async () => {
    const calls: string[] = [];
    const orch = new Orchestrator({
      brain: { ask: async (t) => (calls.push(t), { reply: 'ok', session_id: 's', tokens_used: 1, is_error: false }) },
      sessions: new SessionManager(),
      usage: new UsageLog(null, null),
      modelOverride: () => null,
      runLocal: () => ({ reply: 'Recording stopped (3 min).', followUp: 'Summarize the meeting I just recorded.' }),
    });
    const r = await orch.handle('stop recording');
    expect(r.kind).toBe('local');
    expect(calls).toHaveLength(0); // the command itself uses 0 tokens (T1)
    expect(r.followUp).toBe('Summarize the meeting I just recorded.');
  });
});

describe('C22 / C15 / T8: Claude reads transcripts as text, in parts', () => {
  function withTranscript(text: string) {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, '2026-11-08_10-00-00.txt'), 'older');
    fs.writeFileSync(path.join(dir, '2026-11-08_15-30-00.txt'), text);
    return new TranscriptExecutor(dir);
  }
  const long = Array.from({ length: 400 }, (_, i) => `[${i}] Ravi said the launch moves to Friday and Asha owns the slides.`).join('\n');

  it('reads the latest transcript in parts that fit the 4,000-char limit', async () => {
    const ex = withTranscript(long);
    const p1 = await ex.call('read_transcript', {});
    expect(p1.text).toContain('2026-11-08_15-30-00');
    expect(p1.text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    const total = splitParts(long).length;
    expect(p1.text).toContain(`Part 1 of ${total}. Ask for part 2`);
    const last = await ex.call('read_transcript', { part: total });
    expect(last.text).toContain('End of transcript');
    expect(p1.images).toBeUndefined(); // C15: never audio, only text
  });

  it('splits at line breaks and never loses text', () => {
    const parts = splitParts(long);
    expect(parts.every((p) => p.length <= PART_CHARS)).toBe(true);
    expect(parts.join('\n')).toBe(long);
  });

  it('rejects ids that are not transcript names (no path tricks)', async () => {
    const ex = withTranscript('hi');
    await expect(ex.call('read_transcript', { id: '../../secrets' })).rejects.toThrow(/No transcript/);
  });

  it('is listed for Claude; reading is allowed, starting a recording asks first', async () => {
    const h = makeCore([RECORDER_APP], { recorder: withTranscript('hello') });
    expect(h.core.listTools().map((t) => t.name)).toEqual(['recorder__start_recording', 'recorder__stop_recording', 'recorder__list_transcripts', 'recorder__read_transcript']);
    const start = RECORDER_APP.abilities.find((a) => a.name === 'start_recording')!;
    expect(h.settings.effective(RECORDER_APP, start)).toBe('ask');
    const r = await h.core.callTool('recorder__list_transcripts', {});
    expect(r.text).toContain('2026-11-08_15-30-00');
    expect(h.confirms).toHaveLength(0);
  });
});

describe('C25 push-to-talk', () => {
  function harness(opts: { text?: string; fail?: 'mic' | 'stt' } = {}) {
    let t = 0;
    const log: string[] = [];
    const delivered: string[] = [];
    let pcm: Uint8Array = new Uint8Array(SECOND * 2);
    const ptt = new PushToTalk({
      now: () => t,
      startCapture: async () => {
        if (opts.fail === 'mic') throw new Error('denied');
        log.push('mic on');
      },
      stopCapture: async () => {
        log.push('mic off');
        return pcm;
      },
      transcribe: async () => {
        if (opts.fail === 'stt') throw new Error('engine missing');
        return opts.text ?? 'what is on my calendar today';
      },
      deliver: (text) => delivered.push(text),
      indicate: (s, m) => log.push(m ? `${s}: ${m}` : s),
    });
    const flush = () => new Promise((r) => setTimeout(r, 0));
    return { ptt, log, delivered, advance: (ms: number) => (t += ms), setPcm: (p: Uint8Array) => (pcm = p), flush };
  }

  it('C25 press → listen → stops by itself after a pause → text goes to Jarvis', async () => {
    const h = harness();
    await h.ptt.toggle();
    expect(h.ptt.state).toBe('listening');
    h.ptt.level(0.1); // speaking
    h.advance(800);
    h.ptt.level(0.1);
    h.advance(SILENCE_MS);
    h.ptt.tick();
    await h.flush();
    await h.flush();
    expect(h.delivered).toEqual(['what is on my calendar today']);
    expect(h.log).toEqual(['mic on', 'listening', 'mic off', 'transcribing', 'idle']);
    expect(h.ptt.state).toBe('idle');
  });

  it('C25 pressing the hotkey again stops listening right away', async () => {
    const h = harness();
    await h.ptt.toggle();
    h.ptt.level(0.2);
    await h.ptt.toggle();
    expect(h.delivered).toHaveLength(1);
  });

  it('gives up quietly when nothing is said, and never sends empty text', async () => {
    const h = harness();
    await h.ptt.toggle();
    h.advance(NO_SPEECH_MS);
    h.ptt.tick();
    await h.flush();
    expect(h.delivered).toEqual([]);
    expect(h.log.at(-1)).toContain("didn't hear anything");
  });

  it('stops at the 30-second limit even if the room is noisy', async () => {
    const h = harness();
    await h.ptt.toggle();
    for (let i = 0; i < 40; i++) {
      h.ptt.level(0.3);
      h.advance(1000);
      h.ptt.tick();
    }
    await h.flush();
    await h.flush();
    expect(h.delivered).toHaveLength(1);
    expect(MAX_MS).toBe(30000);
  });

  it('explains microphone and speech-engine problems instead of failing silently', async () => {
    const mic = harness({ fail: 'mic' });
    await mic.ptt.toggle();
    expect(mic.log.at(-1)).toContain('Microphone unavailable');
    expect(mic.ptt.state).toBe('idle');
    const stt = harness({ fail: 'stt' });
    await stt.ptt.toggle();
    stt.ptt.level(0.2);
    await stt.ptt.toggle();
    expect(stt.log.at(-1)).toContain('engine missing');
  });

  it('C25 the hotkey is a global shortcut registered in the main process (works while other apps have focus)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'voice.ts'), 'utf8');
    expect(src).toMatch(/globalShortcut\.register\(accelerator/);
    expect(src).toMatch(/DEFAULT_PTT_HOTKEY = process\.platform === 'darwin' \? 'Alt\+Space' : 'Control\+Alt\+Space'/);
  });
});

describe('speech engine (whisper.cpp)', () => {
  it('cleans whisper output markers', () => {
    expect(cleanTranscript(' [BLANK_AUDIO]\n Hello there.\n (music) How are you? ')).toBe('Hello there. How are you?');
  });

  it('refuses a download whose checksum does not match, and installs nothing', async () => {
    const dir = tmpDir();
    const body = Buffer.from('not the real model');
    const engine = new WhisperEngine(dir, { fetchImpl: (async () => new Response(body, { headers: { 'content-length': String(body.length) } })) as typeof fetch });
    const dest = path.join(dir, 'model.bin');
    await expect(engine.download('https://x', dest, WHISPER_MODEL.sha256, () => undefined)).rejects.toThrow(/checksum/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    const good = crypto.createHash('sha256').update(body).digest('hex');
    await engine.download('https://x', dest, good, () => undefined);
    expect(fs.readFileSync(dest, 'utf8')).toBe('not the real model');
  });

  it('on macOS asks the user to install whisper-cpp with Homebrew', () => {
    const engine = new WhisperEngine(tmpDir(), { platform: 'darwin', binaryOverride: '/nope/whisper-cli' });
    expect(engine.status().help).toMatch(/brew install whisper-cpp/);
  });

  it('refuses zip entries that try to escape the install folder', async () => {
    const { zipSync } = await import('fflate');
    const dir = tmpDir();
    const zip = path.join(dir, 'evil.zip');
    fs.writeFileSync(zip, zipSync({ '../escape.txt': new TextEncoder().encode('x') }));
    await expect(extractZip(zip, path.join(dir, 'out'))).rejects.toThrow(/unsafe path/);
  });

  // Runs only where the real engine has been downloaded (set JARVIS_TEST_WHISPER_DIR).
  const realDir = process.env.JARVIS_TEST_WHISPER_DIR;
  it.skipIf(!realDir)('transcribes real speech locally', async () => {
    const engine = new WhisperEngine(realDir!, {
      binaryOverride: path.join(realDir!, 'x', 'Release', 'whisper-cli.exe'),
      modelOverride: path.join(realDir!, WHISPER_MODEL.name),
    });
    expect(engine.status().ready).toBe(true);
    const text = await engine.transcribe(path.join(realDir!, 'test.wav'));
    expect(text.toLowerCase()).toContain('schedule a meeting with asha tomorrow');
  });
});
