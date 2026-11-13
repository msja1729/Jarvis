/**
 * ClaudeCLIBrain: runs `claude -p` headless and reads its stream-json output.
 * This is the ONLY module that starts `claude` (criterion 7).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import type { AskOptions, Brain, BrainResult, ModelChoice } from './brain.js';
import { buildArgs, CONNECTOR_ENV, GatewayLaunch, mcpConfigJson, TOOL_SEARCH } from './args.js';
import { ConnectorSnapshot, snapshotFromInit } from '../connectors/connectors.js';
import { sanitizeEnv } from './env.js';
import { applyLine, looksLikeLimit, newStreamState, progressLabel } from './stream.js';

export interface ClaudeCLIBrainOptions {
  /** Path to the claude executable (or node, for the test stub). */
  command: string;
  /** Args placed before the CLI flags (the stub script path in tests). */
  prefixArgs?: string[];
  /** Working directory owned by Jarvis, so no project CLAUDE.md is loaded. */
  cwd: string;
  /** Returns how to start the Gateway shim for this run (fresh settings each run), for a team role. */
  gateway: (role?: string, consult?: boolean) => GatewayLaunch | null;
  /**
   * Where a team member works and whether they get Claude Code's own tools: their own folder as the
   * working directory, teammates' folders readable. null = the default (Jarvis's own working folder,
   * no built-in tools).
   */
  workspace?: (role?: string, consult?: boolean) => { cwd: string; addDirs: string[] } | null;
  /** Jarvis's permission-prompt tool for this run: every tool that is not Jarvis's own asks it first. */
  approve?: (role?: string, consult?: boolean) => GatewayLaunch | null;
  /** MCP servers this run must not see (connectors the member may not use, the user's own servers). */
  hidden?: (role?: string, consult?: boolean) => string[];
  /** What this run learned about the apps in the user's Claude account (from Claude Code's start-up report). */
  onConnectors?: (snap: ConnectorSnapshot) => void;
  /** The fixed system prompt for a team role. */
  systemPrompt?: (role?: string) => string;
  /** Tool name (without mcp__jarvis__) → progress label. */
  progressFor?: (tool: string) => string | undefined;
  maxTurns?: number;
  /** Called once if API-key variables had to be removed. */
  onEnvScrubbed?: (removed: string[]) => void;
  baseEnv?: NodeJS.ProcessEnv;
}

export const LIMIT_MESSAGE = 'Usage limit reached on your Claude plan.';

export class ClaudeCLIBrain implements Brain {
  private warned = false;

  constructor(private readonly opts: ClaudeCLIBrainOptions) {}

  async ask(text: string, session_id: string | null, model: ModelChoice, ask: AskOptions = {}): Promise<BrainResult> {
    const ws = this.opts.workspace?.(ask.role, ask.consult) ?? null;
    const cwd = ws?.cwd ?? this.opts.cwd;
    const args = [
      ...(this.opts.prefixArgs ?? []),
      ...buildArgs({
        prompt: text,
        model,
        sessionId: session_id,
        gateway: this.opts.gateway(ask.role, ask.consult),
        maxTurns: this.opts.maxTurns,
        systemPrompt: this.opts.systemPrompt?.(ask.role),
        partial: Boolean(ask.onText),
        builtinTools: ws ? { addDirs: ws.addDirs } : undefined,
        approve: this.opts.approve?.(ask.role, ask.consult) ?? null,
        hidden: this.opts.hidden?.(ask.role, ask.consult),
        // a consulted teammate answers directly: no helpers of their own
        helpers: Boolean(ws) && !ask.consult,
      }),
    ];
    const { env, removed } = sanitizeEnv(this.opts.baseEnv ?? process.env, { MCP_TOOL_TIMEOUT: '300000', ...CONNECTOR_ENV });
    if (removed.length && !this.warned) {
      this.warned = true;
      this.opts.onEnvScrubbed?.(removed);
    }
    fs.mkdirSync(cwd, { recursive: true });

    const child = spawn(this.opts.command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const abort = () => child.kill();
    ask.signal?.addEventListener('abort', abort, { once: true });

    const state = newStreamState();
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => {
      if (stderr.length < 4000) stderr += d;
    });

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      for (const tool of applyLine(state, line, ask.onText, ask.onNote)) {
        ask.onProgress?.(progressLabel(tool, this.opts.progressFor ?? (() => undefined)));
      }
    });

    const exitCode: number | null = await new Promise((resolve) => {
      child.on('error', (err) => {
        stderr += String(err);
        resolve(-1);
      });
      child.on('close', (code) => resolve(code));
    });
    ask.signal?.removeEventListener('abort', abort);
    if (state.init) this.opts.onConnectors?.(snapshotFromInit(state.init));

    const r = state.result;
    const errorText = r?.text || state.lastAssistantText || stderr.trim();
    const limit = state.rateLimited || (Boolean(r?.isError || exitCode !== 0) && looksLikeLimit(errorText));

    if (limit) {
      return {
        reply: `${LIMIT_MESSAGE}\n${errorText}`.trim(),
        session_id: state.sessionId ?? session_id,
        tokens_used: r?.usage.total ?? 0,
        usage: r?.usage,
        is_error: true,
        limit_reached: true,
        model: state.model ?? undefined,
      };
    }
    if (!r) {
      return {
        reply: errorText || `claude exited with code ${exitCode}`,
        session_id: state.sessionId ?? session_id,
        tokens_used: 0,
        is_error: true,
        model: state.model ?? undefined,
      };
    }
    let reply = r.text;
    if (r.subtype === 'error_max_turns') reply ||= 'I stopped after the maximum number of steps. Try a simpler request.';
    return {
      reply: reply || errorText,
      session_id: state.sessionId,
      tokens_used: r.usage.total,
      usage: r.usage,
      is_error: r.isError,
      model: state.model ?? undefined,
    };
  }
}

/**
 * Asks Claude Code which apps the user's Claude account has and whether each is signed in, without a
 * conversation: it starts `claude` the way a request would and stops it at its start-up report, before
 * anything is sent to the model. Resolves null if it could not tell (not signed in, timed out).
 */
export function probeConnectors(opts: { command: string; prefixArgs?: string[]; cwd: string; baseEnv?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<ConnectorSnapshot | null> {
  const args = [
    ...(opts.prefixArgs ?? []),
    '-p',
    'Reply with OK.',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    'haiku',
    '--max-turns',
    '1',
    '--tools',
    TOOL_SEARCH,
    '--mcp-config',
    mcpConfigJson(null),
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--setting-sources',
    '',
    '--disable-slash-commands',
  ];
  const { env } = sanitizeEnv(opts.baseEnv ?? process.env, { ...CONNECTOR_ENV });
  fs.mkdirSync(opts.cwd, { recursive: true });
  return new Promise((resolve) => {
    let done = false;
    const child = spawn(opts.command, args, { cwd: opts.cwd, env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const finish = (snap: ConnectorSnapshot | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(snap);
    };
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? 45_000);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      const state = newStreamState();
      applyLine(state, line);
      if (state.init) finish(snapshotFromInit(state.init));
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
  });
}
