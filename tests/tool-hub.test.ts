import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverApp, McpProxyExecutor } from '../gateway/mcp-proxy.js';
import { SettingsStore } from '../gateway/settings.js';
import { MAX_RESULT_CHARS } from '../gateway/trim.js';
import { DestructiveLockError } from '../security/destructive-lock.js';
import { GMAIL_APP } from '../tools/email/definition.js';
import { ROOT, SpyExecutor, makeCore, tmpDir } from './helpers.js';

const fakeServer = { command: process.execPath, args: [path.join(ROOT, 'tests', 'fixtures', 'fake-mcp-server.mjs')] };

describe('C26 apps added in the Tool Hub work on the next request', () => {
  it('C26 a newly added MCP app is listed and callable without a restart', async () => {
    const proxies: Record<string, McpProxyExecutor> = {};
    const h = makeCore([GMAIL_APP], new Proxy({}, { get: (_t, id: string) => proxies[id] }));
    expect(h.core.listTools().some((t) => t.name.startsWith('notes__'))).toBe(false);

    const def = await discoverApp('notes', 'Notes', fakeServer, 'k-123');
    h.settings.addCustomApp(def);
    proxies.notes = new McpProxyExecutor(def, async () => ({ secret: 'k-123' }));

    const names = h.core.listTools().map((t) => t.name);
    expect(names).toContain('notes__search_pages');
    const r = await h.core.callTool('notes__search_pages', { q: 'x' });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('secret=k-123');
    expect(r.text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS); // C11 for a real third-party server
    await proxies.notes.close();
  });
});

describe('C27 Off abilities are never called', () => {
  it('C27 an Off ability returns a message naming the ability and app, and is not executed', async () => {
    const spy = new SpyExecutor();
    const h = makeCore([GMAIL_APP], { gmail: spy });
    h.settings.setEnabled('gmail', true);
    h.settings.setAbility(GMAIL_APP, 'delete_email', 'off');
    const r = await h.core.callTool('gmail__delete_email', { id: 'm1' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Delete email');
    expect(r.text).toContain('Gmail');
    expect(r.text).toContain('Tool Hub');
    expect(spy.calls).toHaveLength(0);
  });
  it('C27 a disabled app is never called', async () => {
    const spy = new SpyExecutor();
    const h = makeCore([GMAIL_APP], { gmail: spy });
    const r = await h.core.callTool('gmail__list_emails', {});
    expect(r.text).toContain('Gmail is turned off');
    expect(spy.calls).toHaveLength(0);
  });
});

describe('C28 Ask me first needs a recorded Yes', () => {
  it('C28 No → not executed; Yes → executed and logged as confirmed', async () => {
    const spy = new SpyExecutor();
    const h = makeCore([GMAIL_APP], { gmail: spy }, { answer: false });
    h.settings.setEnabled('gmail', true);
    await h.core.callTool('gmail__send_draft', { draft_id: 'd' });
    expect(spy.calls).toHaveLength(0);
    h.setAnswer(true);
    await h.core.callTool('gmail__send_draft', { draft_id: 'd' });
    expect(spy.calls).toHaveLength(1);
    const outcomes = h.log.list().map((e) => [e.ability, e.outcome, e.detail]);
    expect(outcomes).toEqual([
      ['send_draft', 'declined', 'user clicked No'],
      ['send_draft', 'done', 'confirmed by user'],
    ]);
  });
  it('C28 a failing popup counts as No', async () => {
    const spy = new SpyExecutor();
    const h = makeCore([GMAIL_APP], { gmail: spy });
    h.settings.setEnabled('gmail', true);
    const core = new (await import('../gateway/core.js')).GatewayCore({
      apps: () => [GMAIL_APP],
      settings: h.settings,
      executors: () => spy,
      confirm: async () => {
        throw new Error('window closed');
      },
      log: h.log,
    });
    expect((await core.callTool('gmail__send_draft', { draft_id: 'd' })).text).toBe('user declined');
    expect(spy.calls).toHaveLength(0);
  });
});

describe('C29 destructive abilities cannot be Allowed', () => {
  it('C29 saving Allowed for a destructive ability is rejected', () => {
    const s = new SettingsStore(null);
    expect(() => s.setAbility(GMAIL_APP, 'delete_email', 'allowed')).toThrow(DestructiveLockError);
  });
  it('C29 a tampered settings file still cannot make it Allowed in the Gateway', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'settings.json');
    const fs = await import('node:fs');
    fs.writeFileSync(file, JSON.stringify({ apps: { gmail: { enabled: true, abilities: { delete_email: 'allowed' } } } }));
    const s = new SettingsStore(file);
    const del = GMAIL_APP.abilities.find((a) => a.name === 'delete_email')!;
    expect(s.effective(GMAIL_APP, del)).toBe('ask');
  });
});

describe('C30 no declared group → Act / Ask me first', () => {
  it('C30 an ungrouped ability defaults to Ask me first', async () => {
    const def = await discoverApp('notes', 'Notes', fakeServer, null);
    const mystery = def.abilities.find((a) => a.name === 'mystery_tool')!;
    expect(mystery.group).toBeUndefined();
    const s = new SettingsStore(null);
    s.addCustomApp(def);
    expect(s.effective(def, mystery)).toBe('ask');
    expect(def.abilities.find((a) => a.name === 'delete_page')!.group).toBe('destructive');
    expect(def.abilities.find((a) => a.name === 'search_pages')!.group).toBe('read');
  });
});
