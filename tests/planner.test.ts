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

describe('chat history, organised into conversations', () => {
  async function setup() {
    const { ChatHistory, GAP_MS } = await import('../app/history.js');
    const dir = tmpDir();
    let t = Date.parse('2026-11-10T09:00:00Z');
    let keep = true;
    const h = new ChatHistory(path.join(dir, 'history.jsonl'), path.join(dir, 'conversations.json'), () => keep, () => new Date(t));
    return { h, dir, GAP_MS, tick: (ms: number) => (t += ms), setKeep: (k: boolean) => (keep = k), ChatHistory };
  }

  it('keeps chat, voice and box messages of one conversation together, without secrets', async () => {
    const { h } = await setup();
    h.add([{ who: 'user', text: 'Maya, my card is 4111 1111 1111 1111', via: 'voice' }, { who: 'assistant', text: 'Noted.', via: 'voice', roleName: 'Maya · PA', color: '#3987e5' }]);
    h.add([{ who: 'user', text: 'hello', via: 'chat' }]);
    const [c] = h.list();
    expect(h.list()).toHaveLength(1);
    expect(c.title.startsWith('My card is')).toBe(true);
    expect(c.title).not.toMatch(/4111/);
    expect(c.people).toEqual([{ name: 'Maya · PA', color: '#3987e5' }]);
    const msgs = h.messages(c.id);
    expect(msgs.map((i) => `${i.via}:${i.who}`)).toEqual(['voice:user', 'voice:assistant', 'chat:user']);
    expect(msgs[0].text).not.toMatch(/4111/);
  });

  it('starts a new conversation on "New chat", after 30 quiet minutes, and every time Jarvis starts', async () => {
    const { h, dir, tick, GAP_MS, ChatHistory } = await setup();
    expect(h.prepare().isNew).toBe(true);
    h.add([{ who: 'user', text: 'first', via: 'chat' }]);
    tick(60_000);
    expect(h.prepare().isNew).toBe(false);
    h.add([{ who: 'user', text: 'still first', via: 'chat' }]);
    tick(GAP_MS + 1000);
    expect(h.prepare().isNew).toBe(true);
    h.add([{ who: 'user', text: 'second', via: 'chat' }]);
    h.startNew();
    h.add([{ who: 'user', text: 'third', via: 'chat' }]);
    expect(h.list().map((c) => c.title)).toEqual(['Third', 'Second', 'First']);
    expect(h.list().find((c) => c.title === 'First')!.count).toBe(2);
    // a restart of Jarvis begins fresh, the old ones are still listed
    const again = new ChatHistory(path.join(dir, 'history.jsonl'), path.join(dir, 'conversations.json'), () => true);
    expect(again.currentId).toBeNull();
    expect(again.list()).toHaveLength(3);
  });

  it('continues an earlier conversation with the Claude sessions each member used in it', async () => {
    const { h, tick, GAP_MS } = await setup();
    const { conv } = h.prepare();
    h.add([{ who: 'user', text: 'Sara, headache', via: 'chat' }]);
    h.setSession(conv, 'doctor', 'sess-doc');
    h.setSession(conv, 'pa', 'sess-pa');
    h.startNew();
    h.add([{ who: 'user', text: 'other', via: 'chat' }]);
    tick(GAP_MS * 10);
    const c = h.continue(conv);
    expect(c.sessions).toEqual({ doctor: 'sess-doc', pa: 'sess-pa' });
    expect(h.prepare()).toEqual({ conv, isNew: false }); // even though it was hours ago
    h.add([{ who: 'user', text: 'and now?', via: 'chat' }]);
    expect(h.messages(conv).map((i) => i.text)).toEqual(['Sara, headache', 'and now?']);
    expect(h.get(conv)!.title).toBe('Headache');
  });

  it('searches titles and messages; deletes chosen conversations for good; clears all', async () => {
    const { h, dir } = await setup();
    h.add([{ who: 'user', text: 'eigenvectors please', via: 'chat' }, { who: 'assistant', text: 'A matrix stretches some arrows…', via: 'chat' }]);
    h.startNew();
    h.add([{ who: 'user', text: 'budget for November', via: 'chat' }]);
    expect(h.list('matrix').map((c) => c.title)).toEqual(['Eigenvectors please']);
    expect(h.list('NOVEMBER').map((c) => c.title)).toEqual(['Budget for November']);
    const budget = h.list('budget')[0].id;
    expect(h.remove([budget])).toBe(1);
    expect(h.list().map((c) => c.title)).toEqual(['Eigenvectors please']);
    expect(h.currentId).toBeNull(); // the deleted one was current
    expect(fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8')).not.toMatch(/budget/i);
    expect(fs.readFileSync(path.join(dir, 'conversations.json'), 'utf8')).not.toMatch(/budget/i);
    h.clear();
    expect(h.list()).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'history.jsonl'))).toBe(false);
  });

  it('switched off: nothing is saved or listed', async () => {
    const { h, setKeep } = await setup();
    setKeep(false);
    const items = h.add([{ who: 'user', text: 'not saved', via: 'chat' }]);
    expect(items[0].conv).toBeTruthy();
    expect(h.list()).toEqual([]);
    setKeep(true);
    expect(h.list()).toEqual([]);
  });

  it('splits history saved before conversations existed by time gaps, once', async () => {
    const { ChatHistory } = await import('../app/history.js');
    const dir = tmpDir();
    const file = path.join(dir, 'history.jsonl');
    const old = [
      { at: '2026-11-08T10:00:00Z', who: 'user', text: 'plan my day', via: 'chat' },
      { at: '2026-11-08T10:00:05Z', who: 'assistant', text: 'Here it is', via: 'chat', roleName: 'Maya · PA', color: '#3987e5' },
      { at: '2026-11-08T10:05:00Z', who: 'user', text: 'thanks', via: 'chat' },
      { at: '2026-11-09T18:00:00Z', who: 'user', text: 'explain derivatives', via: 'voice' },
    ];
    fs.writeFileSync(file, old.map((o) => JSON.stringify(o)).join('\n') + '\n');
    const h = new ChatHistory(file, path.join(dir, 'conversations.json'), () => true);
    const list = h.list();
    expect(list.map((c) => c.title)).toEqual(['Explain derivatives', 'Plan my day']);
    expect(list[1].count).toBe(3);
    expect(list[1].startedAt).toBe('2026-11-08T10:00:00Z');
    expect(h.messages(list[1].id).every((i) => i.id && i.conv === list[1].id)).toBe(true);
    // done once: a second load finds the same conversations
    const again = new ChatHistory(file, path.join(dir, 'conversations.json'), () => true);
    expect(again.list().map((c) => c.id)).toEqual(list.map((c) => c.id));
  });
});

describe('conversations and Claude sessions', () => {
  it('a new conversation gives every member a fresh session; continuing restores theirs', async () => {
    const { Orchestrator } = await import('../app/orchestrator.js');
    const { SessionManager } = await import('../brain/session.js');
    const { UsageLog } = await import('../brain/usage.js');
    const seen: (string | null)[] = [];
    let n = 0;
    const brain = {
      ask: async (_t: string, sid: string | null) => {
        seen.push(sid);
        if (sid === 'gone') return { reply: 'No conversation found with session ID: gone', session_id: null, tokens_used: 0, is_error: true };
        return { reply: 'ok', session_id: sid ?? `s${++n}`, tokens_used: 1, is_error: false };
      },
    };
    const orch = new Orchestrator({ brain, sessions: new SessionManager(), usage: new UsageLog(null, null), modelOverride: () => null, runLocal: () => '' });
    const a = await orch.handle('Sara, hi');
    expect(a.sessionId).toBe('s1');
    await orch.handle('Sara, and?');
    orch.resetSessions();
    await orch.handle('Sara, new topic');
    orch.restoreSessions({ doctor: 's1' });
    await orch.handle('Sara, back to the first');
    // an old session Claude Code no longer has: answered in a fresh one, not an error
    orch.restoreSessions({ doctor: 'gone' });
    const r = await orch.handle('Sara, still there?');
    expect(seen).toEqual([null, 's1', null, 's1', 'gone', null]);
    expect(r.isError).toBe(false);
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
  it('is built in (no account) and every member has it', async () => {
    const { BUILTIN_APPS } = await import('../app/apps.js');
    const { WEB_APP, WEB_SEARCH_URL } = await import('../tools/web/definition.js');
    const { roleById, roleUsesApp, ROLE_IDS } = await import('../roles/roles.js');
    expect(BUILTIN_APPS).toContain(WEB_APP);
    expect(WEB_SEARCH_URL).toBe('https://mcp.exa.ai/mcp');
    expect(WEB_APP.defaultEnabled).toBe(true);
    expect(WEB_APP.abilities.every((a) => a.group === 'read')).toBe(true);
    for (const r of ROLE_IDS) expect(roleUsesApp(roleById(r), 'web', false), r).toBe(true);
  });
});
