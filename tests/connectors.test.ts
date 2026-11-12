/** Apps from the user's Claude account (connectors): naming, what each tool does, hiding, and the rules. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConnectorRegistry,
  connectorApp,
  connectorAppId,
  hiddenServers,
  ruleForTool,
  serverKey,
  snapshotFromInit,
  splitConnectorTool,
  toolWords,
} from '../connectors/connectors.js';
import { SettingsStore } from '../gateway/settings.js';
import { canUse, membersOf } from '../roles/access.js';
import { judgeExpert } from '../roles/expert-tools.js';
import { appsRules } from '../brain/system-prompt.js';
import { progressLabel } from '../brain/stream.js';
import { CLAUDE_CONFIG } from '../supervisor/policy.js';
import { tmpDir } from './helpers.js';

/** What Claude Code 2.1 reported on this computer (2026-11-12), trimmed. */
const INIT = {
  mcp_servers: [
    { name: 'jarvis', status: 'connected' },
    { name: 'jarvis_approve', status: 'connected' },
    { name: 'claude.ai Gmail', status: 'connected', source: 'claudeai' },
    { name: 'claude.ai Google Calendar', status: 'needs-auth', source: 'claudeai' },
    { name: 'claude.ai monday.com', status: 'needs-auth', source: 'claudeai' },
    { name: 'my-local-server', status: 'connected', source: 'user' },
  ],
  tools: ['ToolSearch', 'mcp__jarvis__screen__look', 'mcp__claude_ai_Gmail__search_threads', 'mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Gmail__trash_message'],
};

describe('names', () => {
  it('server keys and tool names follow Claude Code', () => {
    expect(serverKey('claude.ai Gmail')).toBe('claude_ai_Gmail');
    expect(serverKey('claude.ai monday.com')).toBe('claude_ai_monday_com');
    expect(splitConnectorTool('mcp__claude_ai_Gmail__send_message')).toEqual({ key: 'claude_ai_Gmail', tool: 'send_message' });
    expect(splitConnectorTool('mcp__claude_ai_Google_Calendar__list_events')).toEqual({ key: 'claude_ai_Google_Calendar', tool: 'list_events' });
    expect(splitConnectorTool('mcp__jarvis__screen__look')).toBeNull();
    expect(splitConnectorTool('Bash')).toBeNull();
  });

  it('Tool Hub ids are stable and safe', () => {
    expect(connectorAppId('Google Calendar')).toBe('cx_google_calendar');
    expect(connectorAppId('monday.com')).toBe('cx_monday_com');
    expect(connectorApp('Gmail').kind).toBe('connector');
  });
});

describe("Claude Code's start-up report", () => {
  it('finds the connectors, their status and tools, and the other servers to hide', () => {
    const snap = snapshotFromInit(INIT, 5);
    expect(snap.connectors.map((c) => [c.name, c.status])).toEqual([
      ['Gmail', 'connected'],
      ['Google Calendar', 'needs-auth'],
      ['monday.com', 'needs-auth'],
    ]);
    expect(snap.connectors[0].tools).toEqual(['search_threads', 'send_message', 'trash_message']);
    expect(snap.others).toEqual(['my-local-server']); // Jarvis's own servers are never hidden
    expect(snap.at).toBe(5);
  });

  it('remembers what it learned (no secrets) and keeps known tools when a run reports none yet', () => {
    const file = path.join(tmpDir(), 'connectors.json');
    const reg = new ConnectorRegistry(file);
    expect(reg.update(snapshotFromInit(INIT))).toBe(true);
    const again = new ConnectorRegistry(file);
    expect(again.byKey('claude_ai_Gmail')?.tools).toHaveLength(3);
    // a later run listed Gmail as connected but its tools were not loaded yet
    again.update(snapshotFromInit({ ...INIT, tools: [] }));
    expect(again.byKey('claude_ai_Gmail')?.tools).toHaveLength(3);
    expect(again.byAppId('cx_gmail')?.name).toBe('Gmail');
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(/token|secret|password/i);
  });

  it('a run hides connectors the member may not use, and every other MCP server', () => {
    const reg = new ConnectorRegistry(null);
    reg.update(snapshotFromInit(INIT));
    expect(hiddenServers(reg, (c) => c.name === 'Gmail')).toEqual(['mcp__claude_ai_Google_Calendar', 'mcp__claude_ai_monday_com', 'mcp__my-local-server']);
    expect(hiddenServers(reg, () => true)).toEqual(['mcp__my-local-server']);
  });
});

describe('what a tool does, from its name', () => {
  it("sorts Gmail's real tools into reading, making changes, and deleting", () => {
    const read = ['search_threads', 'get_message', 'get_thread', 'list_labels', 'list_drafts', 'get_draft', 'download_gmail_attachment'];
    const change = ['create_draft', 'update_draft', 'send_message', 'reply', 'forward', 'label_message', 'mark_message_spam', 'untrash_message', 'create_label', 'apply_sensitive_message_label'];
    const del = ['trash_message', 'trash_thread', 'delete_draft', 'delete_label'];
    for (const t of read) expect(ruleForTool(t), t).toBe('read');
    for (const t of change) expect(ruleForTool(t), t).toBe('change');
    for (const t of del) expect(ruleForTool(t), t).toBe('delete');
  });

  it('spending money counts as deleting (always asks); unknown actions are changes (ask by default)', () => {
    expect(ruleForTool('pay_invoice')).toBe('delete');
    expect(ruleForTool('createRefund')).toBe('change');
    expect(ruleForTool('refund_charge')).toBe('delete');
    expect(ruleForTool('play')).toBe('change');
    expect(ruleForTool('frobnicate')).toBe('change');
    expect(ruleForTool('searchTracks')).toBe('read');
    expect(toolWords('send_message')).toBe('send message');
  });
});

describe('the rules for an app from the Claude account', () => {
  it('reading is allowed, changes ask, deleting asks and can never be set to Allowed', () => {
    const s = new SettingsStore(null);
    const app = connectorApp('Gmail');
    const rule = (n: string) => app.abilities.find((a) => a.name === n)!;
    expect(s.isEnabled(app)).toBe(true);
    expect(s.effective(app, rule('read'))).toBe('allowed');
    expect(s.effective(app, rule('change'))).toBe('ask');
    expect(s.effective(app, rule('delete'))).toBe('ask');
    expect(() => s.setAbility(app, 'delete', 'allowed')).toThrow();
    s.setEnabled(app.id, false);
    expect(s.effective(app, rule('read'))).toBe('off');
  });

  it('each app goes to the members whose field it fits; the user can change it; Jarvis has all', () => {
    expect(membersOf(connectorApp('Gmail'))).toEqual(['pa']);
    expect(membersOf(connectorApp('GitHub'))).toEqual(['pm']);
    expect(membersOf(connectorApp('PubMed'))).toEqual(['doctor']);
    expect(membersOf(connectorApp('Spotify'))).toEqual(['pa']);
    expect(canUse('doctor', connectorApp('Gmail'))).toBe(false);
    expect(canUse('doctor', connectorApp('Gmail'), { cx_gmail: ['doctor'] })).toBe(true);
    expect(canUse('jarvis', connectorApp('Gmail'), { cx_gmail: [] })).toBe(true);
  });

  it('members are told which apps they have, and the progress line names the app', () => {
    expect(appsRules(['Gmail', 'Notion'])).toMatch(/Gmail, Notion.*ToolSearch/s);
    expect(appsRules([])).toMatch(/Tool Hub/);
    expect(progressLabel('mcp__claude_ai_Google_Calendar__list_events', () => undefined)).toBe('Using Google Calendar…');
  });
});

describe('nothing a member writes can change their next run', () => {
  const ws = { own: path.resolve('/team/PA'), team: path.resolve('/team') };
  it("Claude Code's settings and instruction files are refused", () => {
    for (const f of ['.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md', '.claude/settings.json', 'sub/.mcp.json']) {
      expect(judgeExpert({ tool_name: 'Write', input: { file_path: path.join(ws.own, f) } }, ws).decision, f).toBe('deny');
    }
    expect(judgeExpert({ tool_name: 'Write', input: { file_path: path.join(ws.own, 'notes.md') } }, ws).decision).toBe('allow');
    expect(CLAUDE_CONFIG.test('C:\\team\\PA\\.mcp.json')).toBe(true);
    expect(CLAUDE_CONFIG.test('C:\\team\\PA\\my.mcp.json.md')).toBe(false);
  });
});
