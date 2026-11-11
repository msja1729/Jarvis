/** Experts also get Claude Code's own tools, in their own folder, with every permission prompt going to Jarvis. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeExpert } from '../roles/expert-tools.js';
import { buildArgs, EXPERT_APPROVE_TOOL } from '../brain/args.js';
import { startControlServer } from '../gateway/control-server.js';
import { rolePrompt } from '../roles/prompts.js';

const team = path.resolve('/jarvis-data/Team');
const ws = { own: path.join(team, 'Project Manager'), team };
const j = (tool_name: string, input: Record<string, unknown> = {}) => judgeExpert({ tool_name, input }, ws);

describe('what an expert may do with Claude Code tools', () => {
  it('saving and editing in their own folder is allowed; files land there by default', () => {
    expect(j('Write', { file_path: path.join(ws.own, 'Meetings', '2026-11-12 Sprint.md') }).decision).toBe('allow');
    expect(j('Write', { file_path: 'Projects/Jarvis/Status.md' }).decision).toBe('allow'); // relative = in their folder
    expect(j('Edit', { file_path: path.join(ws.own, 'notes.md') }).decision).toBe('allow');
  });

  it('reading any team folder is allowed; writing in a teammate’s folder is refused', () => {
    expect(j('Read', { file_path: path.join(team, 'Doctor', 'Profile', 'Health.md') }).decision).toBe('allow');
    expect(j('Glob', { pattern: '**/*.md' }).decision).toBe('allow');
    expect(j('Grep', { pattern: 'deadline', path: team }).decision).toBe('allow');
    const w = j('Write', { file_path: path.join(team, 'Doctor', 'x.md') });
    expect(w.decision).toBe('deny');
    expect(w.why).toMatch(/only in their own folder/);
  });

  it('anything outside the team folders, and key or password files, ask the user', () => {
    expect(j('Read', { file_path: path.resolve('/Users/me/Documents/tax.pdf') }).decision).toBe('ask');
    expect(j('Write', { file_path: path.resolve('/Users/me/Desktop/out.txt') }).decision).toBe('ask');
    expect(j('Read', { file_path: path.join(ws.own, '.env') }).decision).toBe('ask');
  });

  it('commands: looking is allowed, running programs asks, deleting asks as destructive', () => {
    expect(j('Bash', { command: 'ls' }).decision).toBe('allow');
    const py = j('Bash', { command: 'python -c "print(1200*1.08**5)"' });
    expect(py.decision).toBe('ask');
    expect(py.what).toMatch(/run: python/);
    const rm = j('PowerShell', { command: 'Remove-Item -Recurse notes' });
    expect(rm.decision).toBe('ask');
    expect(rm.group).toBe('destructive');
  });

  it('the web, to-do lists and helpers are allowed; dialogs and unknown tools are not silently allowed', () => {
    expect(j('WebSearch', { query: 'RBI repo rate' }).decision).toBe('allow');
    expect(j('WebFetch', { url: 'https://rbi.org.in' }).decision).toBe('allow');
    expect(j('TodoWrite').decision).toBe('allow');
    expect(j('Task', { description: 'research' }).decision).toBe('allow');
    expect(j('AskUserQuestion').decision).toBe('deny');
    expect(j('SomethingNew').decision).toBe('ask');
  });
});

describe('how an expert run is started', () => {
  const gateway = { command: 'node', args: ['shim.mjs'], env: { JARVIS_ROLE: 'pm' } };
  const approve = { command: 'node', args: ['shim.mjs'], env: { JARVIS_SHIM_MODE: 'expert' } };

  it('built-in tools on, permission prompts go to Jarvis, nothing is ever skipped', () => {
    const a = buildArgs({ prompt: 'hi', model: 'sonnet', sessionId: null, gateway, builtinTools: { approve, addDirs: [team] } });
    const at = (f: string) => a[a.indexOf(f) + 1];
    expect(at('--tools')).toBe('Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Bash,TodoWrite'); // not all of them: tokens
    expect(at('--permission-mode')).toBe('manual');
    expect(at('--permission-prompt-tool')).toBe(EXPERT_APPROVE_TOOL);
    expect(at('--add-dir')).toBe(team);
    expect(at('--setting-sources')).toBe(''); // the user's own allow rules never bypass Jarvis
    expect(a.join(' ')).not.toMatch(/dangerously|bypassPermissions/);
    expect(JSON.parse(at('--mcp-config')).mcpServers).toHaveProperty('jarvis_approve');
  });

  it('without them (front desk, or turned off in Settings) it stays tool-less as before', () => {
    const a = buildArgs({ prompt: 'hi', model: 'sonnet', sessionId: null, gateway });
    expect(a[a.indexOf('--tools') + 1]).toBe('');
    expect(a[a.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(a).not.toContain('--permission-prompt-tool');
  });

  it('the experts are told about the tools only when they have them', () => {
    expect(rolePrompt('pm', undefined, true)).toMatch(/Claude Code's tools/);
    expect(rolePrompt('pm', undefined, false)).not.toMatch(/Claude Code's tools|__NO_TOOLS__/);
  });
});

describe('the approve channel', () => {
  it('its token only opens /expert/approve, and the main token cannot answer permission prompts', async () => {
    const seen: unknown[] = [];
    const s = await startControlServer(() => ({ listTools: () => [], callTool: async () => ({ text: '', isError: false }) }) as never, {
      expertApprove: async (role, _c, req) => (seen.push([role, req.tool_name]), { behavior: 'allow', updatedInput: req.input }),
    });
    const post = (p: string, token: string, body: unknown) =>
      fetch(`${s.url}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      const ok = await post('/expert/approve', s.expertToken, { role: 'pm', tool_name: 'Write', input: { file_path: 'a.md' } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ behavior: 'allow' });
      expect(seen).toEqual([['pm', 'Write']]);
      expect((await post('/call', s.expertToken, { name: 'gmail__send_draft' })).status).toBe(401); // cannot use Jarvis's tools
      expect((await post('/expert/approve', s.token, { role: 'pm', tool_name: 'Write' })).status).toBe(401); // a run cannot approve itself
    } finally {
      await s.close();
    }
  });
});
