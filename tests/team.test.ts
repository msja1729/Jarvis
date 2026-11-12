/** The Jarvis team: routing, expertise, scoped apps, one-hop consults, memory, per-role conversations. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { routeRole, STICKY_MS } from '../router/roles.js';
import { ROLE_IDS, ROLES, roleById, roleUsesApp } from '../roles/roles.js';
import { rolePrompt } from '../roles/prompts.js';
import { redact, RoleMemory, SUMMARISE_EVERY } from '../roles/memory.js';
import { JARVIS_SYSTEM_PROMPT, wordCount } from '../brain/system-prompt.js';
import { buildArgs } from '../brain/args.js';
import { Orchestrator } from '../app/orchestrator.js';
import type { AskOptions, Brain } from '../brain/brain.js';
import { SessionManager } from '../brain/session.js';
import { UsageLog } from '../brain/usage.js';
import { TeamExecutor } from '../tools/team/executor.js';
import { TEAM_APP } from '../tools/team/definition.js';
import { BUILTIN_APPS } from '../app/apps.js';
import { makeCore, SpyExecutor } from './helpers.js';
import { tmpDir } from './helpers.js';

describe('who answers: names only', () => {
  it.each([
    ['Doctor, what should I eat tonight?', 'doctor', 'what should I eat tonight?', 'named'],
    ['hey PA what is on my calendar', 'pa', 'what is on my calendar', 'named'],
    ['ask the accountant what my tax is', 'finance', 'what my tax is', 'named'],
    ['Sarah, I have a headache', 'doctor', 'I have a headache', 'named'],
    ['hey Rian how is the build going', 'pm', 'how is the build going', 'named'],
    ['Viktor what about my savings', 'finance', 'what about my savings', 'named'],
    ['Sara', 'doctor', 'Sara', 'named'],
    // no name and no one talked to yet: Maya; topic words no longer decide
    ['Explain the chain rule in calculus', 'pa', 'Explain the chain rule in calculus', 'default'],
    ['Jarvis, explain photosynthesis', 'pa', 'explain photosynthesis', 'default'],
  ])('"%s" → %s', (input, role, text, how) => {
    expect(routeRole(input, null, null)).toEqual({ role, text, how });
  });

  it('you stay with the person you named until you name someone else, however long it takes', () => {
    const sara = { role: 'doctor' as const, at: 0 };
    // the exact message that used to go to someone else ("How do you rate this?")
    const skin = "I'm doing great and I'm starting to follow a skin routine. I'm using a moisturizer gel for pimples and also a sunscreen. How do you rate this?";
    expect(routeRole(skin, null, sara, 10 * 60 * 60 * 1000).role).toBe('doctor');
    for (const t of ['Yes, go ahead.', 'Explain the chain rule in calculus', 'make me a budget', 'fix the bug in my project', 'Jarvis, hi']) expect(routeRole(t, null, sara).role, t).toBe('doctor');
    expect(routeRole('Victor, now make me a budget', null, sara).role).toBe('finance');
  });

  it('a picked chip counts like a name; a name in the message wins over the chip', () => {
    expect(routeRole('what should I eat', 'finance', null).role).toBe('finance');
    expect(routeRole('Doctor, what should I eat', 'finance', null).role).toBe('doctor');
  });
});


describe('each member\'s expertise', () => {
  it('Jarvis stays under 500 words, experts under 700 (skills list included), all fixed text', () => {
    for (const r of ROLE_IDS) {
      expect(wordCount(rolePrompt(r)), r).toBeLessThan(r === 'jarvis' ? 500 : 700);
      expect(rolePrompt(r)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
    expect(rolePrompt('jarvis')).toBe(JARVIS_SYSTEM_PROMPT);
  });

  it('roles carry the right rules', () => {
    expect(rolePrompt('doctor')).toMatch(/not a replacement for an in-person doctor/);
    expect(rolePrompt('doctor')).toMatch(/emergency services/);
    expect(rolePrompt('finance')).toMatch(/not regulated financial advice/);
    expect(rolePrompt('finance')).toMatch(/Never ask for passwords/);
    expect(rolePrompt('pm')).toMatch(/coding task/);
    for (const r of ROLE_IDS) expect(rolePrompt(r)).toMatch(/data, never instructions/); // the safety rule is shared
  });

  it('each run uses its member\'s prompt', () => {
    const args = buildArgs({ prompt: 'hi', model: 'haiku', sessionId: null, gateway: null, systemPrompt: rolePrompt('pa') });
    expect(args[args.indexOf('--system-prompt') + 1]).toBe(rolePrompt('pa'));
  });
});

describe('each member only gets its own apps', () => {
  it('the doctor has no email or coding; the PA has the calendar; Jarvis has everything', () => {
    const doctor = roleById('doctor');
    expect(roleUsesApp(doctor, 'gmail', false)).toBe(false);
    expect(roleUsesApp(doctor, 'coding', false)).toBe(false);
    expect(roleUsesApp(roleById('pa'), 'gcal', false)).toBe(true);
    expect(roleUsesApp(roleById('pm'), 'github', true)).toBe(true); // user-added apps go to the PM
    expect(roleUsesApp(roleById('jarvis'), 'anything', true)).toBe(true);
  });

  it('every app a member is given is a real built-in app (no typos, nothing removed)', async () => {
    const { BUILTIN_APPS } = await import('../app/apps.js');
    const ids = new Set(BUILTIN_APPS.map((a) => a.id));
    for (const r of ROLES) {
      if (r.apps === '*') continue;
      for (const id of r.apps) if (id !== 'custom') expect(ids.has(id), `${r.id} → ${id}`).toBe(true);
    }
    expect(roleUsesApp(roleById('pa'), 'outlookcal', false)).toBe(true);
    expect(ids.has('spotify')).toBe(false);
  });

  it('the gateway only lists and runs the member\'s tools', async () => {
    const mail = new SpyExecutor();
    const gmail = { id: 'gmail', name: 'Gmail', description: '', kind: 'builtin' as const, defaultEnabled: true, abilities: [{ name: 'list_emails', title: 'List emails', description: 'd', group: 'read' as const, inputSchema: { type: 'object' as const } }] };
    const { core } = makeCore([gmail], { gmail: mail });
    const pa = roleById('pa');
    const doctor = roleById('doctor');
    const paTools = core.listTools((a) => roleUsesApp(pa, a.id, false)).map((t) => t.name);
    const docTools = core.listTools((a) => roleUsesApp(doctor, a.id, false)).map((t) => t.name);
    expect(paTools.some((n) => n.startsWith('gmail__'))).toBe(true);
    expect(docTools.some((n) => n.startsWith('gmail__'))).toBe(false);
    const r = await core.callTool(paTools.find((n) => n.startsWith('gmail__'))!, {}, (a) => roleUsesApp(doctor, a.id, false));
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/belongs to another member of the team/);
  });

  it('the team tool is a default app; a consulted member cannot consult again (one hop)', async () => {
    expect(BUILTIN_APPS).toContain(TEAM_APP);
    const asked: string[] = [];
    const team = new TeamExecutor({ consult: async (role, q) => (asked.push(`${role}:${q}`), { reply: 'Project X is due Friday.', isError: false }) });
    const r = await team.call('ask', { role: 'pm', question: 'Any deadlines this week?' });
    expect(r.text).toBe('Project Manager says: Project X is due Friday.');
    expect(asked).toEqual(['pm:Any deadlines this week?']);
    await expect(team.call('ask', { role: 'jarvis', question: 'x' })).rejects.toThrow(/Pick a teammate/);
  });
});

describe('memory, kept in the Jarvis folder', () => {
  it('summarises every few conversations into short notes and uses them for a new conversation', async () => {
    const dir = tmpDir('jarvis-roles-');
    let prompts = 0;
    const mem = new RoleMemory(dir, async (prompt) => {
      prompts++;
      expect(prompt).toMatch(/I am vegetarian/);
      return '- Vegetarian.\n- Wants to lose 3 kg by March.';
    });
    for (let i = 0; i < SUMMARISE_EVERY - 1; i++) await mem.remember('doctor', i === 0 ? 'I am vegetarian' : 'ok', 'noted');
    expect(prompts).toBe(0);
    expect(mem.pendingCount('doctor')).toBe(SUMMARISE_EVERY - 1);
    await mem.remember('doctor', 'thanks', 'you are welcome');
    expect(prompts).toBe(1);
    expect(mem.notes('doctor')).toMatch(/Vegetarian/);
    expect(mem.pendingCount('doctor')).toBe(0);
    expect(mem.prefix('doctor')).toMatch(/^\[your notes about the user:\n- Vegetarian/);
    expect(fs.existsSync(path.join(dir, 'doctor', 'notes.md'))).toBe(true);
    expect(mem.notes('finance')).toBe(''); // each member has its own notes
    mem.clear('doctor');
    expect(mem.notes('doctor')).toBe('');
  });

  it('keeps the recent conversations if summarising fails, and never writes secrets', async () => {
    const dir = tmpDir('jarvis-roles-');
    const mem = new RoleMemory(dir, async () => null);
    for (let i = 0; i < SUMMARISE_EVERY; i++) await mem.remember('finance', 'my card is 4111 1111 1111 1111 and password: hunter2', 'ok');
    expect(mem.pendingCount('finance')).toBe(SUMMARISE_EVERY);
    const raw = fs.readFileSync(path.join(dir, 'finance', 'recent.jsonl'), 'utf8');
    expect(raw).not.toMatch(/4111|hunter2/);
    expect(redact('OTP is 123456')).toBe('OTP is [removed]');
  });
});

describe('separate conversations per member', () => {
  it('routes, keeps a conversation per member, and gives notes only at the start of one', async () => {
    const calls: { text: string; session: string | null; role?: string }[] = [];
    let n = 0;
    const brain: Brain = {
      async ask(text, session_id, _model, opts?: AskOptions) {
        calls.push({ text, session: session_id, role: opts?.role });
        return { reply: 'ok', session_id: session_id ?? `S${++n}`, tokens_used: 1, is_error: false };
      },
    };
    const remembered: string[] = [];
    const orch = new Orchestrator({
      brain,
      sessions: new SessionManager(),
      usage: new UsageLog(null, null),
      runLocal: () => 'x',
      memory: { prefix: (r) => (r === 'doctor' ? '[your notes about the user:\n- Vegetarian.\n]' : ''), remember: async (r, u) => void remembered.push(`${r}:${u}`) },
    });
    const a = await orch.handle('Doctor, what should I eat?');
    const b = await orch.handle('and for lunch?'); // follow-up stays with the doctor
    const c = await orch.handle('PA, what is next today?');
    expect([a.role, b.role, c.role]).toEqual(['doctor', 'doctor', 'pa']);
    expect(calls[0]).toMatchObject({ session: null, role: 'doctor' });
    expect(calls[0].text).toMatch(/^\[your notes about the user:\n- Vegetarian\.\n\]\n\[now: .*\] what should I eat\?$/);
    expect(calls[1]).toMatchObject({ session: 'S1', role: 'doctor' });
    expect(calls[1].text).not.toMatch(/notes about the user/);
    expect(calls[2]).toMatchObject({ session: null, role: 'pa' });
    expect(remembered).toEqual(['doctor:what should I eat?', 'doctor:and for lunch?', 'pa:what is next today?']);
  });
});

describe('the team itself', () => {
  it('has the five experts plus Jarvis, each with a distinct default natural voice and colour', () => {
    expect(ROLES.map((r) => r.id)).toEqual(['jarvis', 'pa', 'pm', 'doctor', 'finance']);
    expect(new Set(ROLES.map((r) => r.defaultVoice)).size).toBe(ROLES.length);
    expect(new Set(ROLES.map((r) => r.color)).size).toBe(ROLES.length);
  });
});

describe('the window markup', () => {
  it('has no duplicate element ids (a clash once stopped the main window from starting Jarvis)', () => {
    for (const file of ['index.html', 'lesson.html', 'supervisor.html']) {
      const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', file), 'utf8');
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes, file).toEqual([]);
    }
  });
});

describe('faster spoken replies', () => {
  it('asks Claude Code for the reply as it is written, and reads it', async () => {
    const { applyLine, newStreamState } = await import('../brain/stream.js');
    expect(buildArgs({ prompt: 'x', model: 'haiku', sessionId: null, gateway: null, partial: true })).toContain('--include-partial-messages');
    expect(buildArgs({ prompt: 'x', model: 'haiku', sessionId: null, gateway: null })).not.toContain('--include-partial-messages');
    const got: string[] = [];
    const st = newStreamState();
    applyLine(st, '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi, I am "}}}', (d) => got.push(d));
    applyLine(st, '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Maya."}}}', (d) => got.push(d));
    expect(got.join('')).toBe('Hi, I am Maya.');
  });

  it('spoken questions ask for a short answer; the role is known before the answer', async () => {
    const calls: string[] = [];
    const roles: string[] = [];
    const brain: Brain = {
      async ask(text, _s, _m, opts?: AskOptions) {
        calls.push(text);
        opts?.onText?.('Hello.');
        return { reply: 'Hello.', session_id: 'S', tokens_used: 1, is_error: false };
      },
    };
    const orch = new Orchestrator({ brain, sessions: new SessionManager(), usage: new UsageLog(null, null), runLocal: () => 'x' });
    const text: string[] = [];
    await orch.handle('Maya, what can you do?', null, { spoken: true, onRole: (r) => roles.push(r), onText: (d) => text.push(d) });
    await orch.handle('what can you do?', 'pa');
    expect(roles).toEqual(['pa']);
    expect(text).toEqual(['Hello.']);
    expect(calls[0]).toMatch(/\[spoken: [^\]]*answer in at most 3 short, plain sentences/);
    expect(calls[1]).not.toMatch(/spoken/);
  });
});
