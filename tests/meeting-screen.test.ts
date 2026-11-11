/** Meeting recordings with the screen: a video file, a picture whenever the screen changes, and the team can see them. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChangeDetector, difference, THUMB_H, THUMB_W, toGrey } from '../speech/screen-diff.js';
import { ScreenStore, readIndex } from '../tools/recorder/screen-store.js';
import { MeetingRecorder } from '../tools/recorder/recorder.js';
import { TranscriptExecutor } from '../tools/recorder/executor.js';
import { RECORDER_APP } from '../tools/recorder/definition.js';
import { pickVideoType } from '../app/renderer/audio.js';
import { notesRequest } from '../roles/notes.js';
import { SKILLS } from '../roles/skills/index.js';

const N = THUMB_W * THUMB_H;
const flat = (v: number) => new Uint8Array(N).fill(v);
/** A "slide": left half dark, right half light, shifted by `k`. */
const slide = (k: number) => Uint8Array.from({ length: N }, (_, i) => ((i % THUMB_W) + k) % THUMB_W < 32 ? 30 : 220);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-meet-'));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);

describe('when to take a picture of the screen', () => {
  it('greyscale and difference', () => {
    expect(toGrey(Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255]))).toEqual(Uint8Array.from([255, 0]));
    expect(difference(flat(10), flat(10))).toBe(0);
    expect(difference(flat(10), flat(30))).toBe(20);
  });

  it('takes the first screen, then a new slide once it has settled; not the same slide again', () => {
    const d = new ChangeDetector({ minGapMs: 8000 });
    expect(d.sample(slide(0), 0)).toBe(true); // the opening screen
    expect(d.sample(slide(0), 10_000)).toBe(false); // nothing changed
    expect(d.sample(slide(16), 12_000)).toBe(false); // a new slide appears (still moving in)
    expect(d.sample(slide(16), 14_000)).toBe(true); // it held still: picture
    expect(d.sample(slide(16), 30_000)).toBe(false);
    expect(d.count).toBe(2);
  });

  it('a playing video (always changing) is not photographed frame by frame', () => {
    const d = new ChangeDetector({ minGapMs: 8000 });
    d.sample(slide(0), 0);
    let shots = 0;
    for (let t = 2000, k = 1; t < 120_000; t += 2000, k += 7) if (d.sample(slide(k % 64), t)) shots++;
    expect(shots).toBe(0);
  });

  it('never more than the limit, and never closer than the minimum gap', () => {
    const d = new ChangeDetector({ minGapMs: 8000, max: 3 });
    let shots = 0;
    for (let t = 0, k = 0; t < 600_000; t += 2000) {
      if (t % 20_000 === 0) k += 16; // a new slide every 20 s
      if (d.sample(slide(k % 64), t)) shots++;
    }
    expect(shots).toBe(3);
  });
});

describe('the recording on disk', () => {
  it('video and pictures go to Videos/Jarvis Meetings/<date time>, indexed for the team', async () => {
    const root = tmp();
    const store = new ScreenStore(path.join(root, 'Jarvis Meetings'), path.join(root, 'transcripts'));
    store.start('2026-11-12_10-00-00');
    store.video(Uint8Array.from([1, 2, 3]), 'video/mp4;codecs=avc1,opus');
    store.video(Uint8Array.from([4, 5]), 'video/mp4;codecs=avc1,opus');
    expect(store.frame(JPEG, 5)).toBe(1);
    expect(store.frame(JPEG, 75)).toBe(2);
    const ix = (await store.stop())!;
    expect(ix.folder).toBe(path.join(root, 'Jarvis Meetings', '2026-11-12 10-00-00'));
    expect(ix.video).toBe(path.join(ix.folder, 'Meeting.mp4'));
    expect([...fs.readFileSync(ix.video!)]).toEqual([1, 2, 3, 4, 5]);
    expect(ix.frames).toEqual([{ file: '001 at 00-05.jpg', at: 5 }, { file: '002 at 01-15.jpg', at: 75 }]);
    expect(fs.existsSync(path.join(ix.folder, 'Screens', '002 at 01-15.jpg'))).toBe(true);
    expect(readIndex(path.join(root, 'transcripts'), '2026-11-12_10-00-00')).toEqual(ix);
  });

  it('prefers MP4 (plays everywhere), else WebM', () => {
    expect(pickVideoType(() => true)).toMatch(/^video\/mp4/);
    expect(pickVideoType((t) => t.startsWith('video/webm'))).toMatch(/^video\/webm/);
    expect(pickVideoType(() => false)).toBeNull();
  });

  it('the transcript marks when each picture was shown, and names the video', async () => {
    const root = tmp();
    const rec = new MeetingRecorder({ work: path.join(root, 'work'), transcripts: path.join(root, 'tr') }, async () => 'Here is the plan for next quarter.');
    rec.start();
    rec.note('screen picture 1');
    rec.push(new Uint8Array(16000 * 2 * 31)); // 31 s of sound
    rec.note('screen picture 2');
    const r = await rec.stop('C:/Videos/Jarvis Meetings/x/Meeting.mp4');
    const file = fs.readFileSync(r.transcriptPath, 'utf8');
    expect(file).toContain('Video with sound: C:/Videos/Jarvis Meetings/x/Meeting.mp4');
    expect(file.indexOf('[00:00] (screen picture 1)')).toBeLessThan(file.indexOf('[00:31] (screen picture 2)'));
    expect(file).toContain('Here is the plan for next quarter.');
  });

  it('a recording that never started leaves nothing behind', () => {
    const root = tmp();
    const rec = new MeetingRecorder({ work: path.join(root, 'work'), transcripts: path.join(root, 'tr') }, async () => '');
    rec.start();
    rec.cancel();
    expect(rec.recording).toBe(false);
    expect(fs.existsSync(path.join(root, 'tr'))).toBe(false);
  });
});

describe('after the notes are written', () => {
  it('the video and pictures are deleted (only that meeting, only inside Jarvis Meetings); the transcript stays', async () => {
    const root = tmp();
    const tr = path.join(root, 'tr');
    const store = new ScreenStore(path.join(root, 'Jarvis Meetings'), tr);
    const keep = path.join(root, 'Jarvis Meetings', 'other meeting');
    fs.mkdirSync(keep, { recursive: true });
    store.start('2026-11-12_10-00-00');
    store.video(Uint8Array.from([1]), 'video/mp4');
    store.frame(JPEG, 3);
    const ix = (await store.stop())!;
    fs.writeFileSync(path.join(tr, '2026-11-12_10-00-00.txt'), 'transcript');
    expect(store.discard(ix)).toBe(true);
    expect(fs.existsSync(ix.folder)).toBe(false);
    expect(readIndex(tr, ix.id)).toBeNull();
    expect(fs.existsSync(path.join(tr, '2026-11-12_10-00-00.txt'))).toBe(true);
    expect(fs.existsSync(keep)).toBe(true);
    // a folder outside Jarvis Meetings is never deleted
    const outside = path.join(root, 'Documents');
    fs.mkdirSync(outside);
    expect(store.discard({ ...ix, folder: outside })).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
    expect(store.discard({ ...ix, folder: path.join(root, 'Jarvis Meetings') })).toBe(false);
  });

  it('the note-taker is told to write down what was shown, because the pictures go afterwards', () => {
    expect(notesRequest('pm', 'Ryan')).toMatch(/deleted after your notes/);
  });
});

describe('the team sees what was shown', () => {
  it('view_screens returns up to 4 pictures with their times, as untrusted content', async () => {
    const root = tmp();
    const tr = path.join(root, 'tr');
    const store = new ScreenStore(path.join(root, 'Jarvis Meetings'), tr);
    const id = '2026-11-12_10-00-00';
    store.start(id);
    for (let i = 0; i < 6; i++) store.frame(JPEG, i * 60);
    await store.stop();
    fs.writeFileSync(path.join(tr, `${id}.txt`), 'Meeting transcript\n[00:00] (screen picture 1)\n');
    const ex = new TranscriptExecutor(tr);
    const first = await ex.call('view_screens', {});
    expect(first.images).toHaveLength(4);
    expect(first.images![0].mimeType).toBe('image/jpeg');
    expect(first.text).toMatch(/untrusted/);
    expect(first.text).toMatch(/picture 2: shown at 01:00/);
    expect(first.text).toMatch(/Ask for from 5/);
    const rest = await ex.call('view_screens', { from: 5 });
    expect(rest.images).toHaveLength(2);
    expect((await ex.call('list_transcripts', {})).text).toMatch(/6 screen picture/);
  });

  it('reading is allowed without asking; the playbooks and note request use the pictures', () => {
    const v = RECORDER_APP.abilities.find((a) => a.name === 'view_screens')!;
    expect(v.group).toBe('read');
    expect(notesRequest('pm', 'Ryan')).toMatch(/view_screens/);
    expect(SKILLS.pm.find((s) => s.id === 'meeting-minutes')!.body).toMatch(/view_screens/);
  });
});
