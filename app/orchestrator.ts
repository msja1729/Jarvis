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
  now?: () => Date;
}

export class Orchestrator {
  private busy = false;

  constructor(private readonly deps: OrchestratorDeps) {}

  get isBusy(): boolean {
    return this.busy;
  }

  async handle(text: string): Promise<HandleResult> {
    const cmd = matchLocalCommand(text);
    if (cmd) {
      if (cmd === 'new_conversation') this.deps.sessions.reset();
      const out = await this.deps.runLocal(cmd);
      const { reply, followUp } = typeof out === 'string' ? { reply: out, followUp: undefined } : out;
      return { kind: 'local', command: cmd, reply, followUp, newConversation: cmd === 'new_conversation' };
    }

    const model = pickModel(text, this.deps.modelOverride());
    const decision = this.deps.sessions.current();
    const now = this.deps.now?.() ?? new Date();
    this.busy = true;
    this.deps.onRequestStart?.();
    try {
      const level = this.deps.level?.();
      const prefix = level ? `${timePrefix(now)} [level: ${level}]` : timePrefix(now);
      const res = await this.deps.brain.ask(`${prefix} ${text}`, decision.sessionId, model, {
        onProgress: this.deps.onProgress,
      });
      if (!res.is_error || res.session_id) this.deps.sessions.record(res.session_id);
      this.deps.usage.add({
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
        expensive: this.deps.usage.isExpensive(res.tokens_used),
        isError: res.is_error,
        limitReached: res.limit_reached,
        newConversation: decision.startedNew,
      };
    } finally {
      this.busy = false;
    }
  }
}
