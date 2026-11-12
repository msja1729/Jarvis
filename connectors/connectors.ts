/**
 * Apps from the user's Claude account ("connectors": Gmail, Google Calendar, Notion, Spotify…).
 *
 * The user connects them on claude.ai; Claude Code loads them by itself (it needs the same claude.ai
 * login Jarvis already requires). Claude calls their tools directly, but never without Jarvis:
 *   - a connector that is off, or not given to a team member, is hidden from that member's runs
 *     (--disallowedTools), and
 *   - every call is a permission prompt that Jarvis answers (--permission-prompt-tool): reading,
 *     making changes and deleting each follow the rule the user set in the Tool Hub; deleting always asks.
 *
 * A connector's tools are named mcp__<server key>__<tool>, e.g. "claude.ai Gmail" → mcp__claude_ai_Gmail__send_message.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AbilityGroup, AppDef } from '../gateway/types.js';

export type ConnectorStatus = 'connected' | 'needs-auth' | 'failed' | 'pending';

export interface Connector {
  /** Display name, e.g. "Gmail". */
  name: string;
  /** The server key used in tool names, e.g. "claude_ai_Gmail". */
  key: string;
  status: ConnectorStatus;
  /** Tool names without the mcp__<key>__ prefix (known once connected). */
  tools: string[];
}

export interface ConnectorSnapshot {
  connectors: Connector[];
  /** Other MCP servers Claude Code would load (the user's own, plugins): always hidden from Jarvis's runs. */
  others: string[];
  /** When this was learned (ms). */
  at: number;
}

/** Claude Code names claude.ai connectors "claude.ai <name>". */
export const CONNECTOR_PREFIX = 'claude.ai ';
/** Where the user adds and signs in to connectors. */
export const CONNECTORS_URL = 'https://claude.ai/customize/connectors';
/** Jarvis's own MCP servers (never hidden). */
const JARVIS_SERVERS = new Set(['jarvis', 'jarvis_approve']);

/** The key Claude Code uses in tool names for a server name ("claude.ai Gmail" → "claude_ai_Gmail"). */
export function serverKey(serverName: string): string {
  return serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** A stable Tool Hub id for a connector ("Google Calendar" → "cx_google_calendar"). */
export function connectorAppId(name: string): string {
  return `cx_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'app'}`;
}

/** "mcp__claude_ai_Gmail__send_message" → { key: "claude_ai_Gmail", tool: "send_message" }; other tools → null. */
export function splitConnectorTool(toolName: string): { key: string; tool: string } | null {
  const m = /^mcp__(claude_ai_[A-Za-z0-9_-]*?)__(.+)$/.exec(toolName);
  return m ? { key: m[1], tool: m[2] } : null;
}

const STATUSES = new Set<ConnectorStatus>(['connected', 'needs-auth', 'failed', 'pending']);

/** What Claude Code's start-up event says about MCP servers and tools. */
export function snapshotFromInit(ev: { mcp_servers?: { name?: unknown; status?: unknown; source?: unknown }[]; tools?: unknown[] }, now = Date.now()): ConnectorSnapshot {
  const tools = (ev.tools ?? []).filter((t): t is string => typeof t === 'string');
  const connectors: Connector[] = [];
  const others: string[] = [];
  for (const s of ev.mcp_servers ?? []) {
    if (typeof s?.name !== 'string' || !s.name) continue;
    const key = serverKey(s.name);
    if (s.source === 'claudeai' || s.name.startsWith(CONNECTOR_PREFIX)) {
      const status = (STATUSES.has(s.status as ConnectorStatus) ? s.status : 'failed') as ConnectorStatus;
      const prefix = `mcp__${key}__`;
      connectors.push({
        name: s.name.startsWith(CONNECTOR_PREFIX) ? s.name.slice(CONNECTOR_PREFIX.length) : s.name,
        key,
        status,
        tools: tools.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length)),
      });
    } else if (!JARVIS_SERVERS.has(s.name)) {
      others.push(key);
    }
  }
  return { connectors, others, at: now };
}

/* ---------- what a tool does, from its name ---------- */

/** The three rules the user sets per connector. */
export type ConnectorRule = 'read' | 'change' | 'delete';

const READ_WORDS = new Set(['get', 'list', 'search', 'read', 'find', 'query', 'fetch', 'view', 'show', 'lookup', 'look', 'download', 'export', 'describe', 'check', 'count', 'preview', 'browse', 'recommend', 'suggest', 'guide', 'help', 'whoami', 'me', 'retrieve', 'explore', 'summarize', 'summarise']);
const DELETE_WORDS = new Set(['delete', 'remove', 'trash', 'purge', 'drop', 'destroy', 'erase', 'wipe', 'revoke', 'empty', 'pay', 'purchase', 'buy', 'refund', 'transfer', 'charge', 'unsubscribe', 'cancel']);

/** What a connector tool does: only reads, makes changes (writes, sends, posts), or deletes / spends money. */
export function ruleForTool(tool: string): ConnectorRule {
  const words = tool
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const first = words[0] ?? '';
  if (DELETE_WORDS.has(first) || words.some((w) => w === 'delete' || w === 'trash' || w === 'purge')) return 'delete';
  if (READ_WORDS.has(first)) return 'read';
  return 'change'; // unknown → the careful middle: it asks by default
}

const RULE_GROUP: Record<ConnectorRule, AbilityGroup> = { read: 'read', change: 'act', delete: 'destructive' };

/** "send_message" → "send message". */
export function toolWords(tool: string): string {
  return tool.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
}

/** Short descriptions for well-known connectors (anything else is described generically). */
export const KNOWN: Record<string, { maker?: string; description: string; category: string }> = {
  Gmail: { maker: 'Google', description: 'Read, search, draft and send email.', category: 'Email & calendar' },
  'Google Calendar': { maker: 'Google', description: 'See your schedule and create or change events.', category: 'Email & calendar' },
  'Microsoft 365': { maker: 'Microsoft', description: 'Outlook mail and calendar, OneDrive, SharePoint and Teams (work or school accounts).', category: 'Email & calendar' },
  'Google Drive': { maker: 'Google', description: 'Find and read your files in Drive.', category: 'Docs & files' },
  'Google Docs': { maker: 'Google', description: 'Read and write Google Docs.', category: 'Docs & files' },
  'Google Sheets': { maker: 'Google', description: 'Read and update spreadsheets.', category: 'Docs & files' },
  'Google Slides': { maker: 'Google', description: 'Read and build presentations.', category: 'Docs & files' },
  Box: { maker: 'Box', description: 'Search and read files stored in Box.', category: 'Docs & files' },
  Notion: { maker: 'Notion', description: 'Search, read and write your Notion pages and databases.', category: 'Docs & files' },
  Slack: { maker: 'Slack', description: 'Read channels and send messages in Slack.', category: 'Chat & meetings' },
  Asana: { maker: 'Asana', description: 'Track tasks and projects in Asana.', category: 'Work & projects' },
  Atlassian: { maker: 'Atlassian', description: 'Jira issues and Confluence pages.', category: 'Work & projects' },
  Linear: { maker: 'Linear', description: 'Issues, projects and cycles in Linear.', category: 'Work & projects' },
  'monday.com': { maker: 'monday.com', description: 'Boards, items and updates in monday.com.', category: 'Work & projects' },
  GitHub: { maker: 'GitHub', description: 'Repositories, issues and pull requests.', category: 'Code & dev' },
  Figma: { maker: 'Figma', description: 'Read designs and design details from Figma.', category: 'Design' },
  Canva: { maker: 'Canva', description: 'Find, create and edit Canva designs.', category: 'Design' },
  HubSpot: { maker: 'HubSpot', description: 'Contacts, deals and companies in your CRM.', category: 'Sales & support' },
  Intercom: { maker: 'Intercom', description: 'Customer conversations and help articles.', category: 'Sales & support' },
  Spotify: { maker: 'Spotify', description: 'Music and podcast recommendations, just for you.', category: 'Music & media' },
  PubMed: { description: 'Search biomedical research papers.', category: 'Health & science' },
  'Clinical Trials': { description: 'Search clinical trials.', category: 'Health & science' },
  ChEMBL: { description: 'Look up drugs and bioactive molecules.', category: 'Health & science' },
  bioRxiv: { description: 'Search biology preprints.', category: 'Health & science' },
  Consensus: { maker: 'Consensus', description: 'Answers from scientific research papers.', category: 'Health & science' },
  'Claude Docs': { maker: 'Anthropic', description: 'Documents you keep and share on claude.ai.', category: 'Docs & files' },
  Meetings: { maker: 'Anthropic', description: 'Notes and transcripts of your claude.ai meetings.', category: 'Chat & meetings' },
};

/** Well-known connectors from Claude's directory, suggested in the Tool Hub until the user adds them. */
export const SUGGESTED = ['Gmail', 'Google Calendar', 'Microsoft 365', 'Google Drive', 'Notion', 'Slack', 'Spotify', 'Asana', 'Atlassian', 'Linear', 'Figma', 'Canva'];

/** A connector as a Tool Hub app: on/off, who can use it, and its three rules. */
export function connectorApp(name: string): AppDef {
  const known = KNOWN[name];
  return {
    id: connectorAppId(name),
    name,
    description: known?.description ?? `${name}, connected through your Claude account.`,
    kind: 'connector',
    defaultEnabled: true,
    abilities: [
      { name: 'read', title: 'Read and search', description: 'Look things up, list and read.', group: RULE_GROUP.read, inputSchema: { type: 'object' } },
      { name: 'change', title: 'Make changes and send', description: 'Create, edit, send, post or play: anything that changes something.', group: RULE_GROUP.change, inputSchema: { type: 'object' } },
      { name: 'delete', title: 'Delete or spend money', description: 'Delete, trash, cancel or pay. Always asks you first.', group: RULE_GROUP.delete, inputSchema: { type: 'object' } },
    ],
  };
}

/* ---------- what Jarvis knows about the user's connectors ---------- */

/** The last known connectors, kept between runs (no secrets: names, status and tool names only). */
export class ConnectorRegistry {
  private snap: ConnectorSnapshot = { connectors: [], others: [], at: 0 };

  constructor(private readonly file: string | null) {
    if (file && fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as ConnectorSnapshot;
        if (Array.isArray(raw.connectors)) this.snap = { connectors: raw.connectors, others: Array.isArray(raw.others) ? raw.others : [], at: Number(raw.at) || 0 };
      } catch {
        /* a broken file is rebuilt on the next check */
      }
    }
  }

  get checkedAt(): number {
    return this.snap.at;
  }

  list(): Connector[] {
    return this.snap.connectors;
  }

  others(): string[] {
    return this.snap.others;
  }

  byKey(key: string): Connector | undefined {
    return this.snap.connectors.find((c) => c.key === key);
  }

  byAppId(appId: string): Connector | undefined {
    return this.snap.connectors.find((c) => connectorAppId(c.name) === appId);
  }

  /** Replace with what Claude Code just reported. Returns true when anything the user would see changed. */
  update(next: ConnectorSnapshot): boolean {
    const shape = (s: ConnectorSnapshot) => JSON.stringify([s.connectors.map((c) => [c.name, c.status, c.tools.length]), s.others]);
    // a run whose connectors were still starting knows less than the last full check: keep the tools we know
    const merged = next.connectors.map((c) => {
      const old = this.byKey(c.key);
      return c.status === 'connected' && !c.tools.length && old?.tools.length ? { ...c, tools: old.tools } : c;
    });
    const changed = shape({ ...next, connectors: merged }) !== shape(this.snap);
    this.snap = { connectors: merged, others: next.others, at: next.at };
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.snap, null, 2));
    }
    return changed;
  }
}

/**
 * The --disallowedTools entries for one run: connectors the member may not use (or that are off),
 * and every other MCP server Claude Code would load (the user's own servers and plugins).
 */
export function hiddenServers(reg: ConnectorRegistry, usable: (c: Connector) => boolean): string[] {
  const out = reg.list().filter((c) => !usable(c)).map((c) => `mcp__${c.key}`);
  for (const k of reg.others()) out.push(`mcp__${k}`);
  return [...new Set(out)].sort();
}
