import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Orchestrator } from '../app/orchestrator.js';
import type { Brain } from '../brain/brain.js';
import { buildArgs } from '../brain/args.js';
import { IDLE_MS, MAX_TURNS_PER_SESSION, SessionManager } from '../brain/session.js';
import { JARVIS_SYSTEM_PROMPT, wordCount } from '../brain/system-prompt.js';
import { UsageLog } from '../brain/usage.js';
import { startControlServer } from '../gateway/control-server.js';
import { checkAttachment, fitWithin } from '../gateway/image-guard.js';
import { MAX_RESULT_CHARS } from '../gateway/trim.js';
import { matchLocalCommand } from '../router/commands.js';
import { pickModel } from '../router/model.js';
import { GMAIL_APP } from '../tools/email/definition.js';
import { formatEmail, formatEmailList } from '../tools/email/trim.js';
import { GCAL_APP } from '../tools/calendar/definition.js';
import { ROOT, SpyExecutor, makeCore } from './helpers.js';

function countingBrain() {
  const calls: string[] = [];
  const brain: Brain = {
    async ask(text) {
      calls.push(text);
      return { reply: 'ok', session_id: 's1', tokens_used: 1000, is_error: false };
    },
  };
  return { brain, calls };
}

describe('C08 local commands use zero claude runs', () => {
  const commands = [
    'stop recording',
    'Start recording',
    'record this meeting and take notes',
    'the meeting is over',
    'new conversation',
    'open Tool Hub',
    'mute voice',
    'unmute',
    'Jarvis, open the Tool Hub please.',
    'Ryan, record this meeting and note down the tasks given to me',
  ];
  it.each(commands)('C08 "%s" is handled locally', async (text) => {
    const { brain, calls } = countingBrain();
    const handled: string[] = [];
    const orch = new Orchestrator({
      brain,
      sessions: new SessionManager(),
      usage: new UsageLog(null, null),
      modelOverride: () => null,
      runLocal: (c) => {
        handled.push(c);
        return 'done';
      },
    });
    const r = await orch.handle(text);
    expect(r.kind).toBe('local');
    expect(handled).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it('C08 requests with extra content still go to Claude', () => {
    expect(matchLocalCommand('stop recording and summarize it')).toBeNull();
    expect(matchLocalCommand('explain binary search on the whiteboard')).toBeNull();
  });
});

describe('C09 fixed-cost reduction', () => {
  it('C09 token_baseline.md records a reduction of at least 50% vs Claude Code defaults', () => {
    const md = fs.readFileSync(path.join(ROOT, 'tests', 'token_baseline.md'), 'utf8');
    const m = md.match(/Reduction:\s*\*?\*?(\d+(?:\.\d+)?)%/);
    expect(m, 'token_baseline.md must contain "Reduction: NN%"').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(50);
  });

  it('C09/T2 the Jarvis system prompt stays under 500 words', () => {
    expect(wordCount(JARVIS_SYSTEM_PROMPT)).toBeLessThan(500);
  });
});

describe('C10 email list trimming', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    id: `id${i}`,
    from: `Person ${i} <p${i}@example.com>`,
    subject: `Subject ${i} `.repeat(30),
    date: 'Sat, 7 Nov 2026 10:00:00 +0530',
    text: `<p>Body ${i}</p> ` + 'lorem ipsum '.repeat(200),
  }));
  it('C10 returns at most 10 items, each with a gist of at most 200 characters', () => {
    const out = formatEmailList(many, 50);
    const items = out.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(items).toHaveLength(10);
    const gists = out.split('\n').filter((l) => l.startsWith('   '));
    expect(gists).toHaveLength(10);
    for (const g of gists) expect(g.trim().length).toBeLessThanOrEqual(200);
    expect(out).not.toContain('<p>');
  });
  it('C10 the list passes through the Gateway uncut', async () => {
    const h = makeCore([GMAIL_APP], { gmail: new SpyExecutor(() => ({ text: formatEmailList(many) })) });
    h.settings.setEnabled('gmail', true);
    const r = await h.core.callTool('gmail__list_emails', {});
    expect(r.text.split('\n').filter((l) => /^\d+\. /.test(l))).toHaveLength(10);
    expect(r.text).not.toContain('more available');
  });
});

describe('C11 single email and third-party results', () => {
  it('C11 a single email is plain text, without quotes or signature, and at most 4,000 chars', () => {
    const body = `<html><body><p>Hi team,</p><p>${'Long update. '.repeat(600)}</p>\n-- \nRavi Kumar\nCEO</body></html>`;
    const out = formatEmail({ id: '1', from: 'Ravi', to: 'me', subject: 'Update', date: 'today', text: '', body });
    expect(out.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(out).toContain('more available');
    expect(out).not.toMatch(/<\/?p>|<html>/);
    const quoted = formatEmail({ id: '2', from: 'A', subject: 'Re', date: 'd', text: '', body: 'Sounds good.\n\nOn Mon, Ravi wrote:\n> old text\n> more old' });
    expect(quoted).toContain('Sounds good.');
    expect(quoted).not.toContain('old text');
    const sig = formatEmail({ id: '3', from: 'A', subject: 's', date: 'd', text: '', body: 'See you.\n-- \nAsha\n+91 99999' });
    expect(sig).not.toContain('+91');
  });

  it('C11 any third-party result is cut to 4,000 chars by the Gateway', async () => {
    const app = { id: 'notes', name: 'Notes', description: '', kind: 'mcp' as const, abilities: [{ name: 'get', title: 'Get', description: 'Get.', group: 'read' as const, inputSchema: { type: 'object' as const }, resultLimit: 50000 }] };
    const h = makeCore([app], { notes: new SpyExecutor(() => ({ text: 'y'.repeat(20000) })) });
    h.settings.setEnabled('notes', true);
    const r = await h.core.callTool('notes__get', {});
    expect(r.text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(r.text).toContain('more available');
  });
});

describe('C12 disabled apps and Off abilities are not listed', () => {
  it('C12 tool list hides disabled apps and Off abilities', () => {
    const h = makeCore([GMAIL_APP, GCAL_APP], {});
    expect(h.core.listTools()).toEqual([]); // apps start off until connected
    h.settings.setEnabled('gmail', true);
    h.settings.setAbility(GMAIL_APP, 'delete_email', 'off');
    const names = h.core.listTools().map((t) => t.name);
    expect(names).toContain('gmail__list_emails');
    expect(names).not.toContain('gmail__delete_email');
    expect(names.some((n) => n.startsWith('gcal__'))).toBe(false);
  });

  it('C12 the stdio shim (what claude actually sees) reflects the same list', async () => {
    const h = makeCore([GMAIL_APP, GCAL_APP], {});
    h.settings.setEnabled('gmail', true);
    h.settings.setAbility(GMAIL_APP, 'send_draft', 'off');
    const server = await startControlServer(() => h.core);
    try {
      const tools = await listViaShim(server.url, server.token);
      const names = tools.map((t: { name: string }) => t.name);
      expect(names).toEqual(['gmail__list_emails', 'gmail__read_email', 'gmail__draft_email', 'gmail__delete_email']);
    } finally {
      await server.close();
    }
  });
});

async function listViaShim(url: string, token: string) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, 'gateway', 'shim.ts')],
      env: { ...(process.env as Record<string, string>), JARVIS_CONTROL_URL: url, JARVIS_CONTROL_TOKEN: token },
    }),
  );
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

describe('C13 short sessions', () => {
  it('C13 starts a new session after 10 minutes idle', () => {
    let now = 0;
    const s = new SessionManager(() => now);
    s.record('a');
    now += IDLE_MS - 1;
    expect(s.current()).toEqual({ sessionId: 'a', startedNew: false });
    s.record('a');
    now += IDLE_MS;
    expect(s.current()).toEqual({ sessionId: null, startedNew: true });
  });
  it('C13 starts a new session after 20 turns', () => {
    const s = new SessionManager(() => 0);
    for (let i = 0; i < MAX_TURNS_PER_SESSION; i++) {
      expect(s.current().startedNew).toBe(false);
      s.record('a');
    }
    expect(s.current()).toEqual({ sessionId: null, startedNew: true });
  });
});

function png(width: number, height: number): string {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b.toString('base64');
}

describe('C14 image size', () => {
  it('C14 scaling keeps the longest side at most 1280 px', () => {
    expect(fitWithin(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(fitWithin(1000, 3000)).toEqual({ width: 427, height: 1280 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('C14 the Gateway refuses any image larger than 1280 px', async () => {
    const app = { id: 'screen', name: 'Screen', description: '', kind: 'builtin' as const, defaultEnabled: true, abilities: [{ name: 'look', title: 'Look', description: 'Look.', group: 'read' as const, inputSchema: { type: 'object' as const } }] };
    const big = makeCore([app], { screen: new SpyExecutor(() => ({ text: 'shot', images: [{ data: png(1920, 1080), mimeType: 'image/png' }] })) });
    const r = await big.core.callTool('screen__look', {});
    expect(r.isError).toBe(true);
    expect(r.images).toBeUndefined();
    const ok = makeCore([app], { screen: new SpyExecutor(() => ({ text: 'shot', images: [{ data: png(1280, 720), mimeType: 'image/png' }] })) });
    expect((await ok.core.callTool('screen__look', {})).images).toHaveLength(1);
  });
});

describe('C15 no audio to Claude', () => {
  it('C15 the Gateway refuses audio attachments', () => {
    expect(checkAttachment({ data: 'AAAA', mimeType: 'audio/wav' })).toMatch(/not allowed/);
    expect(checkAttachment({ data: png(10, 10), mimeType: 'image/png' })).toBeNull();
  });
  it('C15 the shim only ever emits text and image content', () => {
    const src = fs.readFileSync(path.join(ROOT, 'gateway', 'shim.ts'), 'utf8');
    expect(src).not.toMatch(/type:\s*'audio'/);
  });
});

describe('C16 model by task', () => {
  it.each([
    ['read my 5 latest mails', 'haiku'],
    ["what's on my calendar today?", 'haiku'],
    ['list unread emails', 'haiku'],
    ['Reply to Ravi saying I will join', 'sonnet'],
    ['Draft a mail to HR', 'sonnet'],
    ['Explain binary search on the whiteboard', 'sonnet'],
    ['Look at my screen and explain this error', 'sonnet'],
  ])('C16 "%s" → %s', (text, model) => {
    expect(pickModel(text)).toBe(model);
  });
  it('C16 the user override wins', () => {
    expect(pickModel('read my mail', 'sonnet')).toBe('sonnet');
  });
});

describe('C17 stable prompt and tool list', () => {
  it('C17 system prompt and tool list are byte-identical across runs', async () => {
    const a = buildArgs({ prompt: 'one', model: 'haiku', sessionId: null, gateway: null });
    const b = buildArgs({ prompt: 'two', model: 'haiku', sessionId: 's', gateway: null });
    const sp = (x: string[]) => x[x.indexOf('--system-prompt') + 1];
    expect(sp(a)).toBe(sp(b));

    const h = makeCore([GMAIL_APP, GCAL_APP], {});
    h.settings.setEnabled('gmail', true);
    h.settings.setEnabled('gcal', true);
    const server = await startControlServer(() => h.core);
    try {
      const first = JSON.stringify(await listViaShim(server.url, server.token));
      const second = JSON.stringify(await listViaShim(server.url, server.token));
      expect(second).toBe(first);
    } finally {
      await server.close();
    }
  });
});

describe('C18 usage panel', () => {
  it('C18 logs every request and highlights those above 3× baseline', async () => {
    const usage = new UsageLog(null, null);
    usage.setBaseline(1000);
    let tokens = 900;
    const brain: Brain = { ask: async () => ({ reply: 'ok', session_id: 's', tokens_used: tokens, is_error: false }) };
    const orch = new Orchestrator({ brain, sessions: new SessionManager(), usage, modelOverride: () => null, runLocal: () => '' });
    const cheap = await orch.handle('hello there');
    tokens = 3500;
    const pricey = await orch.handle('summarize everything');
    expect(cheap.expensive).toBe(false);
    expect(pricey.expensive).toBe(true);
    const s = usage.summary();
    expect(s.entries.map((e) => e.tokens)).toEqual([900, 3500]);
    expect(s.entries.map((e) => e.expensive)).toEqual([false, true]);
    expect(s.todayTotal).toBe(4400);
    expect(s.topExpensive[0].tokens).toBe(3500);
  });
});
