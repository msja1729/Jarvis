import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeExpert } from '../roles/expert-tools.js';
import { buildArgs, HELPER_AGENTS } from '../brain/args.js';
import { TeamExecutor } from '../tools/team/executor.js';
import { TEAM_APP } from '../tools/team/definition.js';
import type { RoleId } from '../roles/roles.js';

const team = path.resolve('/jarvis-data/Team');
const ws = { own: path.join(team, 'Doctor'), team };
const j = (tool_name: string, input: Record<string, unknown> = {}, consult = false) => judgeExpert({ tool_name, input }, ws, { consult });

describe('helpers: a member splits a job into parts that run at the same time', () => {
  it('only the read-only helper may be started, and it reports back before the member goes on', () => {
    expect(j('Agent', { description: 'read report 1', subagent_type: 'helper', prompt: 'x' }).decision).toBe('allow');
    // the built-in helpers can change files: refused, so helpers never get in each other's way
    expect(j('Agent', { description: 'x', subagent_type: 'general-purpose', prompt: 'x' })).toMatchObject({ decision: 'deny', why: expect.stringMatching(/read-only helper/) });
    expect(j('Agent', { description: 'x', prompt: 'x' }).decision).toBe('deny');
    expect(j('Agent', { description: 'x', subagent_type: 'helper', run_in_background: true }).decision).toBe('deny');
    expect(j('Agent', { description: 'x', subagent_type: 'helper', isolation: 'worktree' }).decision).toBe('deny');
    expect(j('Task', { description: 'x', subagent_type: 'helper' }).decision).toBe('allow');
  });

  it('the helper can only read and search', () => {
    expect(HELPER_AGENTS.helper.tools).toEqual(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']);
    expect(HELPER_AGENTS.helper.tools.some((t) => /Write|Edit|Bash|PowerShell|Agent/.test(t))).toBe(false);
  });

  it('members get helpers when they work for the user, not when a teammate asks them', () => {
    const base = { prompt: 'hi', model: 'sonnet' as const, sessionId: null, gateway: null, builtinTools: { addDirs: [] } };
    const withHelpers = buildArgs({ ...base, helpers: true });
    const tools = withHelpers[withHelpers.indexOf('--tools') + 1];
    expect(tools).toMatch(/\bAgent\b/);
    expect(JSON.parse(withHelpers[withHelpers.indexOf('--agents') + 1])).toHaveProperty('helper');
    // Claude Code starts helpers without asking Jarvis: its own helper types are refused by a deny rule
    const denied = withHelpers[withHelpers.indexOf('--disallowedTools') + 1];
    expect(denied).toMatch(/Agent\(general-purpose\)/);
    expect(denied).toMatch(/Agent\(Explore\)/);
    expect(denied).not.toMatch(/Agent\(helper\)/);
    const without = buildArgs({ ...base, helpers: false });
    expect(without[without.indexOf('--tools') + 1]).not.toMatch(/\bAgent\b/);
    expect(without).not.toContain('--agents');
  });
});

describe('a teammate who is asked only reads', () => {
  it('cannot change files or start helpers (they may be answering the user at the same moment)', () => {
    const note = path.join(ws.own, 'Profile', 'Health profile.md');
    expect(j('Edit', { file_path: note }).decision).toBe('allow');
    expect(j('Edit', { file_path: note }, true)).toMatchObject({ decision: 'deny', why: expect.stringMatching(/without changing files/) });
    expect(j('Write', { file_path: note }, true).decision).toBe('deny');
    expect(j('Bash', { command: 'npm install x' }, true).decision).toBe('deny');
    expect(j('Agent', { subagent_type: 'helper', description: 'x' }, true).decision).toBe('deny');
    // reading is fine
    expect(j('Read', { file_path: note }, true).decision).toBe('allow');
    expect(j('WebSearch', { query: 'iron rich foods' }, true).decision).toBe('allow');
  });
});

describe('asking several teammates at once', () => {
  it('they answer at the same time and all answers come back together', async () => {
    const started: string[] = [];
    const finish = new Map<string, () => void>();
    const team = new TeamExecutor({
      consult: (role: RoleId, question: string) =>
        new Promise((resolve) => {
          started.push(role);
          finish.set(role, () => resolve({ reply: `${role} on: ${question}`, isError: false, name: role }));
        }),
    });
    const out = team.call('ask_several', { questions: [{ role: 'finance', question: 'can I afford it?' }, { role: 'doctor', question: 'is it safe?' }] });
    await new Promise((r) => setTimeout(r, 0));
    // both started before either finished
    expect(started).toEqual(['finance', 'doctor']);
    finish.get('doctor')!();
    finish.get('finance')!();
    const r = await out;
    expect(r.text).toMatch(/finance says: finance on: can I afford it\?[\s\S]*doctor says: doctor on: is it safe\?/);
  });

  it('one failing does not lose the others; two questions for one teammate become one run', async () => {
    const calls: string[] = [];
    const team = new TeamExecutor({
      consult: async (role: RoleId, question: string) => {
        calls.push(`${role}: ${question}`);
        if (role === 'pa') throw new Error('offline');
        return { reply: 'ok', isError: false, name: role };
      },
    });
    const r = await team.call('ask_several', {
      questions: [
        { role: 'doctor', question: 'a' },
        { role: 'doctor', question: 'b' },
        { role: 'pa', question: 'c' },
      ],
    });
    expect(calls).toEqual(['doctor: 1. a\n\n2. b', 'pa: c']);
    expect(r.text).toMatch(/doctor says: ok[\s\S]*PA could not answer: offline/);
  });

  it('is offered to the team as its own ability', () => {
    expect(TEAM_APP.abilities.map((a) => a.name)).toEqual(['ask', 'ask_several']);
  });
});
