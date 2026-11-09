/** Names, reminders, the project board, and watching the user's own Claude Code sessions. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { routeRole } from '../router/roles.js';
import { peopleNames, PERSON_NAME } from '../roles/roles.js';
import { rolePrompt } from '../roles/prompts.js';
import { BoardStore, MISSED_GRACE_MS, ReminderStore } from '../supervisor/reminders.js';
import { HOOK_MARKER, hookCommand, hooksInstalled, installHooks, removeHooks, withJarvisHooks, withoutJarvisHooks } from '../supervisor/hooks.js';
import { startControlServer } from '../gateway/control-server.js';
import { codeArgs } from '../brain/coder.js';
import { tmpDir } from './helpers.js';

describe('team members have names', () => {
  it('you can call them by name like people', () => {
    expect(routeRole('Sara, what should I eat?', null, null)).toMatchObject({ role: 'doctor', text: 'what should I eat?' });
    expect(routeRole('hey Maya what is next today', null, null)).toMatchObject({ role: 'pa', text: 'what is next today' });
    expect(routeRole('Dr. Sara, is this rash serious?', null, null).role).toBe('doctor');
    expect(routeRole('Victor how much should I save', null, null).role).toBe('finance');
  });

  it('renamed members answer to their new names', () => {
    const people = peopleNames({ doctor: 'Priya', pa: 'not valid 123!!' });
    expect(people.doctor).toBe('Priya');
    expect(people.pa).toBe('Maya'); // invalid names fall back to the default
    expect(routeRole('Priya, should I take a walk?', null, null, Date.now(), people).role).toBe('doctor');
    expect(rolePrompt('doctor', people)).toMatch(/^You are Priya, the doctor/);
    expect(rolePrompt('pa', people)).toMatch(/Priya \(health and nutrition; doctor\)/);
    expect(PERSON_NAME.test("D'Souza")).toBe(true);
    expect(PERSON_NAME.test('a')).toBe(false);
  });
});

describe('reminders', () => {
  it('are given at their time, once; missed ones are still given if recent, old ones are dropped', () => {
    const s = new ReminderStore(path.join(tmpDir(), 'reminders.json'));
    const now = Date.parse('2026-11-09T10:00:00Z');
    s.add('Stand-up meeting in 10 minutes', '2026-11-09T10:05:00Z', now);
    s.add('Call Mom', '2026-11-09T18:00:00+05:30', now);
    expect(s.upcoming(now).map((r) => r.text)).toEqual(['Stand-up meeting in 10 minutes', 'Call Mom']);
    expect(s.takeDue(now)).toEqual([]);
    expect(s.takeDue(now + 6 * 60_000).map((r) => r.text)).toEqual(['Stand-up meeting in 10 minutes']);
    expect(s.takeDue(now + 7 * 60_000)).toEqual([]); // only once
    expect(() => s.add('x', 'tomorrow-ish', now)).toThrow(/ISO 8601/);
    expect(() => s.add('x', '2026-11-08T10:00:00Z', now)).toThrow(/already passed/);
    // Jarvis was closed for a long time: a very old reminder is not announced late
    const later = Date.parse('2026-11-09T12:30:00Z') + MISSED_GRACE_MS + 60_000;
    expect(s.takeDue(later)).toEqual([]);
  });
});

describe('the project board', () => {
  it('adds, moves and removes tasks', () => {
    const b = new BoardStore(path.join(tmpDir(), 'board.json'));
    const t = b.add({ title: 'Add login page', project: 'my-shop', due: '2026-11-14' });
    expect(t.status).toBe('todo');
    b.update(t.id, { status: 'doing' });
    expect(b.list({ status: 'doing' }).map((x) => x.title)).toEqual(['Add login page']);
    expect(BoardStore.describe(b.all())).toBe(`[${t.id}] DOING Add login page (my-shop) due 2026-11-14`);
    expect(() => b.add({ title: '  ' })).toThrow();
    b.add({ title: 'bad date', due: 'next friday' });
    expect(b.list().find((x) => x.title === 'bad date')!.due).toBeUndefined();
    expect(b.remove(t.id)).toBe(true);
  });
});

describe('watching Claude Code sessions you start yourself', () => {
  const cmd = hookCommand('C:\\Jarvis\\Jarvis.exe', 'C:\\Jarvis\\supervisor\\jarvis-claude-hook.mjs', 'C:\\Users\\me\\AppData\\Roaming\\Jarvis\\hook-endpoint.json');

  it('the hook command runs the script with Jarvis itself and carries the marker', () => {
    expect(cmd).toBe('ELECTRON_RUN_AS_NODE=1 "C:/Jarvis/Jarvis.exe" "C:/Jarvis/supervisor/jarvis-claude-hook.mjs" "C:/Users/me/AppData/Roaming/Jarvis/hook-endpoint.json"');
    expect(cmd).toContain(HOOK_MARKER);
  });

  it('adds only its own two hooks, keeps everything else, and removes exactly them', () => {
    const user = { model: 'opus', permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'audit.sh' }] }] } };
    const on = withJarvisHooks(user, cmd);
    expect(on.model).toBe('opus');
    expect(on.hooks!.Stop).toHaveLength(2);
    expect(on.hooks!.Notification).toHaveLength(1);
    expect(withJarvisHooks(on, cmd).hooks!.Stop).toHaveLength(2); // no duplicates when turned on twice
    expect(withoutJarvisHooks(on)).toEqual(user);
  });

  it('works on the real settings file, keeps a copy of the original, and refuses a broken file', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark' }));
    installHooks(file, cmd);
    expect(hooksInstalled(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(`${file}.before-jarvis`, 'utf8'))).toEqual({ theme: 'dark' });
    removeHooks(file);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ theme: 'dark' });
    expect(hooksInstalled(file)).toBe(false);
    fs.writeFileSync(file, '{ not json');
    expect(() => installHooks(file, cmd)).toThrow(/not valid JSON/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it('the hook token only opens the hook door', async () => {
    const seen: unknown[] = [];
    const server = await startControlServer(() => ({ listTools: () => [], callTool: async () => ({ text: 'x' }) }) as never, { hook: (p) => void seen.push(p) });
    const post = (route: string, token: string) => fetch(`${server.url}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ event: 'Stop', cwd: 'C:/p' }) });
    expect((await post('/hook', server.hookToken)).status).toBe(200);
    expect((await post('/call', server.hookToken)).status).toBe(401);
    expect((await post('/sup/approve', server.hookToken)).status).toBe(401);
    expect((await post('/hook', server.supToken)).status).toBe(401);
    expect(seen).toEqual([{ event: 'Stop', cwd: 'C:/p' }]);
    await server.close();
  });

  it('sessions Jarvis supervises are marked, so they are not announced twice', () => {
    expect(codeArgs({ task: 't', resume: null, shim: { command: 'x', args: [], env: {} } })).toBeDefined();
    const src = fs.readFileSync(path.join(__dirname, '..', 'brain', 'coder.ts'), 'utf8');
    expect(src).toMatch(/JARVIS_SUPERVISED: '1'/);
    expect(fs.readFileSync(path.join(__dirname, '..', 'supervisor', 'jarvis-claude-hook.ts'), 'utf8')).toMatch(/JARVIS_SUPERVISED === '1'/);
  });
});

describe('shared chat history', () => {
  it('keeps chat, voice and box messages together, without secrets, and can be switched off or cleared', async () => {
    const { ChatHistory } = await import('../app/history.js');
    const file = path.join(tmpDir(), 'history.jsonl');
    let keep = true;
    const h = new ChatHistory(file, () => keep);
    h.add([{ who: 'user', text: 'Maya, my card is 4111 1111 1111 1111', via: 'voice' }, { who: 'assistant', text: 'Noted.', via: 'voice', roleName: 'Maya · PA' }]);
    h.add([{ who: 'user', text: 'hello', via: 'chat' }]);
    const items = h.recent();
    expect(items.map((i) => `${i.via}:${i.who}`)).toEqual(['voice:user', 'voice:assistant', 'chat:user']);
    expect(items[0].text).not.toMatch(/4111/);
    keep = false;
    h.add([{ who: 'user', text: 'not saved', via: 'chat' }]);
    expect(h.recent()).toEqual([]);
    keep = true;
    expect(h.recent().some((i) => i.text === 'not saved')).toBe(false);
    h.clear();
    expect(h.recent()).toEqual([]);
  });
});

describe('usage: "unusually large" compares like with like', () => {
  it('uses each member\'s recent typical size, not a stale setup baseline', async () => {
    const { UsageLog } = await import('../brain/usage.js');
    const u = new UsageLog(null, null);
    u.setBaseline(1000); // measured at setup, before any apps were added
    for (let i = 0; i < 6; i++) u.add({ request: 'q', model: 'sonnet', tokens: 9000, isError: false, role: 'pa' });
    expect(u.isExpensive(9500, 'pa')).toBe(false); // normal for the PA now
    expect(u.isExpensive(30_000, 'pa')).toBe(true);
    expect(u.isExpensive(4000, 'doctor')).toBe(true); // no doctor history yet: falls back to the baseline
    // once there are a few requests to compare with, normal ones are no longer flagged
    const s = u.summary();
    expect(s.entries.slice(5).every((e) => !e.expensive)).toBe(true);
  });
});

describe('web search', () => {
  it('is a one-click app with no account, given to the members who need current facts', async () => {
    const { SUGGESTED_APPS } = await import('../gateway/suggested.js');
    const { roleById, roleUsesApp } = await import('../roles/roles.js');
    const web = SUGGESTED_APPS.find((a) => a.id === 'web')!;
    expect(web).toMatchObject({ auth: 'none', url: 'https://mcp.exa.ai/mcp' });
    for (const r of ['educator', 'doctor', 'finance', 'pa', 'pm'] as const) expect(roleUsesApp(roleById(r), 'web', true), r).toBe(true);
  });
});
