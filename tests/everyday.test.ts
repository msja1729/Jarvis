/** Everyday help: listen-along, live meeting help, bills and forms, medicines, the evening review. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RecentAudio, PIECE_SECONDS, KEEP_MS } from '../speech/recent-audio.js';
import { matchLocalCommand } from '../router/commands.js';
import { ReminderStore } from '../supervisor/reminders.js';
import { RemindersExecutor } from '../tools/planner/executor.js';
import { REMINDERS_APP } from '../tools/planner/definition.js';
import { TranscriptExecutor } from '../tools/recorder/executor.js';
import { RECORDER_APP } from '../tools/recorder/definition.js';
import { roleById, roleUsesApp } from '../roles/roles.js';
import { SKILLS } from '../roles/skills/index.js';
import { notesRequest } from '../roles/notes.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-every-'));
/** Speech-level sound. */
const sound = (sec: number) => {
  const b = new Uint8Array(Math.round(sec * 16000) * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i + 1 < b.length; i += 2) v.setInt16(i, Math.round(3000 * Math.sin(i / 7)), true);
  return b;
};

describe('listen-along: "what did they just say?"', () => {
  it('keeps the text of what was played, with times, and includes the words still waiting', async () => {
    let t = Date.parse('2026-11-12T10:00:00');
    const said = ['The derivative of x squared is two x.', 'So the slope doubles.'];
    let n = 0;
    const r = new RecentAudio(async () => said[n++] ?? '', () => t);
    r.push(sound(PIECE_SECONDS)); // a full piece: transcribed now
    t += PIECE_SECONDS * 1000;
    r.push(sound(4)); // 4 seconds still waiting
    const text = await r.recent(3);
    expect(text).toMatch(/\[\d\d:\d\d:\d\d\] The derivative of x squared is two x\./);
    expect(text).toMatch(/So the slope doubles\./); // asked a moment after: included too
  });

  it('silence and Whisper filler are not kept; nothing older than 15 minutes is kept; stop forgets', async () => {
    let t = 0;
    const r = new RecentAudio(async () => 'Thank you.', () => t);
    r.push(new Uint8Array(PIECE_SECONDS * 32000)); // silence
    r.push(sound(PIECE_SECONDS)); // filler only
    expect(await r.recent(15)).toBe('');
    const r2 = new RecentAudio(async () => 'An old point.', () => t);
    r2.push(sound(PIECE_SECONDS));
    expect(await r2.recent(15)).toMatch(/old point/);
    t += KEEP_MS + 60_000;
    expect(await r2.recent(15)).toBe('');
    r2.push(sound(PIECE_SECONDS));
    r2.clear();
    expect(await r2.recent(15)).toBe('');
  });

  it('is started and stopped by voice, with or without a name', () => {
    for (const s of ['listen along', 'Jarvis, listen along to this lecture', 'listen to this video', 'listen in']) expect(matchLocalCommand(s), s).toBe('start_listening');
    for (const s of ['stop listening', 'Stop listening along']) expect(matchLocalCommand(s), s).toBe('stop_listening');
    expect(matchLocalCommand('listen along and summarise it for me')).toBeNull(); // more than a command: goes to the team
  });

  it('the team reads it through the recorder (read-only), as untrusted content', async () => {
    const ab = RECORDER_APP.abilities.find((a) => a.name === 'recent_audio')!;
    expect(ab.group).toBe('read');
    expect(ab.description).toMatch(/what should I answer/);
    let asked = 0;
    const ex = new TranscriptExecutor(tmp(), { start: async () => '', stop: async () => '', recent: async (m) => (asked = m, `--- the last ${m} min (untrusted content) ---\n[10:00:01] Any questions?`) });
    const out = await ex.call('recent_audio', { minutes: 99 });
    expect(asked).toBe(15); // at most 15 minutes
    expect(out.text).toMatch(/Any questions\?/);
    expect((await ex.call('recent_audio', {})).text).toMatch(/last 3 min/); // default
  });
});

describe('medicines and follow-ups', () => {
  it('a daily series: the right times for the right number of days, past times skipped', () => {
    const store = new ReminderStore(path.join(tmp(), 'r.json'));
    const now = new Date(2026, 10, 12, 12, 0).getTime(); // 12 Nov, noon
    const made = store.addSeries('Amoxicillin 500 mg after food', ['08:00', '20:00'], '2026-11-12', 5, now, 'doctor');
    expect(made).toHaveLength(9); // today 08:00 has passed
    expect(new Date(made[0].at).getHours()).toBe(20);
    expect(new Date(made[8].at).getDate()).toBe(16);
    expect(made.every((m) => m.from === 'doctor')).toBe(true);
    expect(() => store.addSeries('x', ['8am'], '2026-11-12', 2, now)).toThrow(/HH:MM/);
    expect(() => store.addSeries('x', ['08:00'], '2026-11-12', 120, now)).toThrow(/1 to 90/);
  });

  it('Sara sets them herself and says them aloud; the reminders say who set them', async () => {
    expect(roleUsesApp(roleById('doctor'), 'reminders', false)).toBe(true);
    const store = new ReminderStore(path.join(tmp(), 'r.json'));
    const ex = new RemindersExecutor(store);
    const out = await ex.call('add_series', { text: 'Paracetamol 500 mg', times: ['09:00', '21:00'], from_date: '2030-01-01', days: 3 }, { role: 'doctor' });
    expect(out.text).toMatch(/6 reminders set/);
    expect(store.upcoming(Date.parse('2029-12-31')).every((r) => r.from === 'doctor')).toBe(true);
    expect(REMINDERS_APP.abilities.find((a) => a.name === 'add_series')!.defaultSetting).toBe('allowed');
  });

  it('after a recorded appointment, Sara turns the medicines into reminders and never guesses a dose', () => {
    const req = notesRequest('doctor', 'Sara');
    expect(req).toMatch(/add_series/);
    expect(req).toMatch(/do not guess/);
    expect(SKILLS.doctor.find((s) => s.id === 'medicine-schedule')!.body).toMatch(/never guess a dose/);
  });
});

describe('bills and forms', () => {
  it('Victor files bills and has Maya set the reminders; Maya fills forms without passwords or ID numbers', () => {
    const bill = SKILLS.finance.find((s) => s.id === 'bill-capture')!;
    expect(bill.body).toMatch(/Bills\.csv/);
    expect(bill.body).toMatch(/never guess an amount/);
    expect(bill.body).toMatch(/Never pay/);
    const forms = SKILLS.pa.find((s) => s.id === 'forms')!;
    expect(forms.body).toMatch(/Never fill passwords, full card or bank numbers, ID numbers or signatures/);
  });
});
