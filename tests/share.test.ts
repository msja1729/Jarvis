/** Showing an expert something: a drop box, the file in their own folder, and something they can take in. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeShared, kindOf, saveShared, SHARED_DIR, timedTranscript, INLINE_TRANSCRIPT } from '../tools/share/share.js';
import { FilesExecutor } from '../tools/files/executor.js';
import { FILES_APP } from '../tools/files/definition.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-share-'));

describe('shared files', () => {
  it('knows what each file is', () => {
    expect(kindOf('report.PDF')).toBe('pdf');
    expect(kindOf('rash.jpeg')).toBe('image');
    expect(kindOf('lecture.mp4')).toBe('video');
    expect(kindOf('voice note.m4a')).toBe('audio');
    expect(kindOf('notes.docx')).toBe('other');
  });

  it('saves into the member’s own folder, under Shared with me, dated, never overwriting', () => {
    const root = tmp();
    const src = path.join(root, 'blood test.pdf');
    fs.writeFileSync(src, 'x');
    const doctor = path.join(root, 'Team', 'Doctor');
    const a = saveShared(doctor, src, '2026-11-12');
    const b = saveShared(doctor, src, '2026-11-12');
    expect(a).toBe(path.join(doctor, SHARED_DIR, '2026-11-12 blood test.pdf'));
    expect(b).toBe(path.join(doctor, SHARED_DIR, '2026-11-12 (2) blood test.pdf'));
    expect(fs.readFileSync(src, 'utf8')).toBe('x'); // the original stays where it was
  });

  it('a video is described with its scenes and a timed transcript (long transcripts point to the file)', () => {
    const t = timedTranscript([{ at: 0, text: 'Welcome.' }, { at: 30, text: '' }, { at: 75, text: 'Here is the X-ray.' }]);
    expect(t).toBe('[00:00] Welcome.\n[01:15] Here is the X-ray.');
    const d = describeShared({ name: 'visit.mp4', saved: 'C:/T/Doctor/Shared with me/visit.mp4', kind: 'video', duration: 125, pictures: [{ at: 5, file: 'C:/T/s/00-05.jpg' }, { at: 80, file: 'C:/T/s/01-20.jpg' }], transcript: t, transcriptFile: 'C:/T/visit - transcript.txt' });
    expect(d).toMatch(/video, 02:05 long/);
    expect(d).toMatch(/Pictures of the scenes \(2\): 00:05, 01:20/);
    expect(d).toMatch(/\[01:15\] Here is the X-ray\./);
    expect(describeShared({ name: 'l.mp4', saved: 'x', kind: 'video', transcript: 'a'.repeat(INLINE_TRANSCRIPT + 50) })).toMatch(/more in the file/);
    expect(describeShared({ name: 'r.pdf', saved: 'x', kind: 'pdf' })).toMatch(/Read tool/);
  });
});

describe('the drop box', () => {
  it('every member can ask to be shown something; nothing happens until the user drops a file', async () => {
    const ab = FILES_APP.abilities.find((a) => a.name === 'ask_user_to_share')!;
    expect(ab.defaultSetting).toBe('allowed');
    expect(ab.description).toMatch(/drop box/);
    const asked: [string, string][] = [];
    const ex = new FilesExecutor({ jarvisDir: tmp(), askToShare: async (role, prompt) => (asked.push([role, prompt]), { text: 'shared' }) });
    expect((await ex.call('ask_user_to_share', { prompt: 'Drop the report here' }, { role: 'doctor' })).text).toBe('shared');
    expect(asked).toEqual([['doctor', 'Drop the report here']]);
    await expect(ex.call('ask_user_to_share', {}, { role: 'jarvis' })).rejects.toThrow(/not available/);
  });
});
