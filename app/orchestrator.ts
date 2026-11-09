/**
 * Orchestrator: user text → Local Command Router (0 tokens) or Brain.
 * Holds session rules (T6), model choice (T9), and usage logging (5.1).
 * No Electron imports, so it is unit-tested directly.
 */
import type { Brain, ModelChoice } from '../brain/brain.js';
import { SessionManager } from '../brain/session.js';
import { timePrefix } from '../brain/system-prompt.js';
import { UsageLog } from '../brain/usage.js';
import { LocalCommand, matchLocalCommand } from '../router/commands.js';
import { pickModel } from '../router/model.js';
import { routeRole } from '../router/roles.js';
import type { RoleId } from '../roles/roles.js';

export interface HandleResult {
  kind: 'local' | 'brain';
  reply: string;
  command?: LocalCommand;
  model?: ModelChoice;
  tokens?: number;
  expensive?: boolean;
  isError?: boolean;
  limitReached?: boolean;
  /** "New conversation started" note for the UI. */
  newConversation?: boolean;
  /** A request the UI should send next, e.g. a meeting summary after "stop recording". */
  followUp?: string;
  /** Which team member answered. */
  role?: RoleId;
}

export interface LocalReply {
  reply: string;
  followUp?: string;
}

export interface OrchestratorDeps {
  brain: Brain;
  sessions: SessionManager;
  usage: UsageLog;
  modelOverride: () => ModelChoice | null;
  /** Executes a local command in the UI/app; returns a short confirmation. */
  runLocal: (cmd: LocalCommand) => Promise<string | LocalReply> | string | LocalReply;
  onProgress?: (label: string) => void;
  /** Called before each Claude request (used to allow one screen capture per request). */
  onRequestStart?: () => void;
  /** Explanation level chosen in Settings (eli5, student, professional); null = let Claude infer it. */
  level?: () => string | null;
  /** Team roles' memory: notes for a new conversation, and recording each exchange. */
  memory?: { prefix(role: RoleId): string; remember(role: RoleId, user: string, reply: string): Promise<void> };
  /** The names the user gave team members, so "Sara, …" reaches the Doctor. */
  people?: () => Partial<Record<RoleId, string>>;
  now?: () => Date;
}

export class Orchestrator {
  private busy = false;
  /** One conversation per team role (Jarvis itself uses deps.sessions). */
  private roleSessions = new Map<RoleId, SessionManager>();
  private last: { role: RoleId; at: number } | null = null;

  constructor(private readonly deps: OrchestratorDeps) {}

  get isBusy(): boolean {
    return this.busy;
  }

  private sessionsFor(role: RoleId): SessionManager {
    if (role === 'jarvis') return this.deps.sessions;
    let s = this.roleSessions.get(role);
    if (!s) {
      s = new SessionManager();
      this.roleSessions.set(role, s);
    }
    return s;
  }

  /**
   * @param picked the team member chosen in the chat, or null for "Auto".
   * @param live spoken: the user talked (answer briefly); onRole: who answers, before they do; onText: the reply as it is written.
   */
  async handle(input: string, picked: RoleId | null = null, live: { spoken?: boolean; onRole?: (role: RoleId) => void; onText?: (delta: string) => void } = {}): Promise<HandleResult> {
    const routed = routeRole(input, picked, this.last, (this.deps.now?.() ?? new Date()).getTime(), this.deps.people?.() ?? {});
    const role = routed.role;
    const text = routed.text;
    const cmd = matchLocalCommand(text);
    if (cmd) {
      if (cmd === 'new_conversation') {
        this.deps.sessions.reset();
        for (const s of this.roleSessions.values()) s.reset();
      }
      const out = await this.deps.runLocal(cmd);
      const { reply, followUp } = typeof out === 'string' ? { reply: out, followUp: undefined } : out;
      return { kind: 'local', command: cmd, reply, followUp, newConversation: cmd === 'new_conversation' };
    }

    const model = pickModel(text, this.deps.modelOverride());
    const sessions = this.sessionsFor(role);
    const decision = sessions.current();
    const now = this.deps.now?.() ?? new Date();
    this.last = { role, at: now.getTime() };
    live.onRole?.(role);
    this.busy = true;
    this.deps.onRequestStart?.();
    try {
      const level = this.deps.level?.();
      // a role's notes about the user go in front of the first message of a new conversation
      const notes = !decision.sessionId && role !== 'jarvis' ? this.deps.memory?.prefix(role) : '';
      // spoken questions get spoken-length answers: shorter to write, and to listen to
      const spoken = live.spoken ? ' [spoken: answer in at most 3 short, plain sentences; no lists or headings, unless asked for detail]' : '';
      const prefix = `${notes ? `${notes}\n` : ''}${timePrefix(now)}${level ? ` [level: ${level}]` : ''}${spoken}`;
      const res = await this.deps.brain.ask(`${prefix} ${text}`, decision.sessionId, model, {
        onProgress: this.deps.onProgress,
        role,
        onText: live.onText,
      });
      if (!res.is_error || res.session_id) sessions.record(res.session_id);
      if (!res.is_error && role !== 'jarvis') void this.deps.memory?.remember(role, text, res.reply).catch(() => undefined);
      const expensive = this.deps.usage.isExpensive(res.tokens_used, role);
      this.deps.usage.add({
        role,
        request: text,
        model: res.model ?? model,
        tokens: res.tokens_used,
        usage: res.usage,
        isError: res.is_error,
      });
      return {
        kind: 'brain',
        reply: res.reply,
        model,
        tokens: res.tokens_used,
        expensive,
        isError: res.is_error,
        limitReached: res.limit_reached,
        newConversation: decision.startedNew,
        role,
      };
    } finally {
      this.busy = false;
    }
  }
}
