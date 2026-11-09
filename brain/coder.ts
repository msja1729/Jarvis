/**
 * Coding supervisor processes (the only other place, besides claude-cli.ts, that starts `claude`):
 *
 * 1. The coding session: Claude Code working in the user's project folder, in the
 *    background. Every permission prompt and every question it asks goes to Jarvis
 *    through --permission-prompt-tool. It never skips permission checks: the mode
 *    is forced to "manual" whatever the user's own settings say.
 * 2. The advisor: a short, tool-less Haiku call that recommends an answer and says why.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { sanitizeEnv } from './env.js';
import type { GatewayLaunch } from './args.js';

export const SUPERVISOR_SERVER = 'jarvis_supervisor';
export const APPROVE_TOOL = `mcp__${SUPERVISOR_SERVER}__approve`;
/** How long Claude Code waits for an answer from the user (1 hour). */
export const ANSWER_WAIT_MS = 60 * 60 * 1000;

export interface CodeRunArgs {
  task: string;
  resume: string | null;
  /** How to start the supervisor shim (stdio MCP server). */
  shim: GatewayLaunch;
  model?: string;
}

/** The exact flags for a coding session. Permission checks are never skipped: the mode is always "manual". */
export function codeArgs(r: CodeRunArgs): string[] {
  const mcp = JSON.stringify({ mcpServers: { [SUPERVISOR_SERVER]: { type: 'stdio', command: r.shim.command, args: r.shim.args, env: r.shim.env } } });
  const args = ['-p', r.task, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'manual', '--permission-prompt-tool', APPROVE_TOOL, '--mcp-config', mcp];
  if (r.model) args.push('--model', r.model);
  if (r.resume) args.push('--resume', r.resume);
  return args;
}

/** What the supervisor hears from a running session. */
export type CodeEvent =
  | { type: 'session'; sessionId: string; model?: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; text: string; isError: boolean }
  | { type: 'result'; text: string; isError: boolean; subtype: string; tokens: number }
  | { type: 'exit'; code: number | null; stderr: string };

export function parseCodeLine(line: string): CodeEvent[] {
  const t = line.trim();
  if (!t.startsWith('{')) return [];
  let ev: any;
  try {
    ev = JSON.parse(t);
  } catch {
    return [];
  }
  const out: CodeEvent[] = [];
  if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) out.push({ type: 'session', sessionId: ev.session_id, model: ev.model });
  if (ev.type === 'assistant') {
    for (const b of ev.message?.content ?? []) {
      if (b.type === 'text' && b.text?.trim()) out.push({ type: 'text', text: b.text });
      if (b.type === 'tool_use' && b.name) out.push({ type: 'tool', name: b.name, input: b.input ?? {} });
    }
  }
  if (ev.type === 'user') {
    for (const b of ev.message?.content ?? []) {
      if (b.type !== 'tool_result') continue;
      const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((c: { text?: string }) => c.text ?? '').join('\n') : '';
      out.push({ type: 'tool_result', text: text.slice(0, 4000), isError: Boolean(b.is_error) });
    }
  }
  if (ev.type === 'result') {
    const u = ev.usage ?? {};
    out.push({
      type: 'result',
      text: typeof ev.result === 'string' ? ev.result : '',
      isError: Boolean(ev.is_error),
      subtype: String(ev.subtype ?? ''),
      tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    });
  }
  return out;
}

export interface RunHandle {
  stop(): void;
  done: Promise<void>;
}

export interface CoderOptions {
  /** Path to the claude executable (or node, for the test stub). */
  command: string;
  prefixArgs?: string[];
  baseEnv?: NodeJS.ProcessEnv;
}

export class Coder {
  constructor(private readonly opts: CoderOptions) {}

  /** Starts (or resumes) a coding session in `cwd`; events stream to onEvent. */
  run(args: CodeRunArgs, cwd: string, onEvent: (e: CodeEvent) => void): RunHandle {
    // JARVIS_SUPERVISED: Jarvis already reports this session, so its own Claude Code hook stays quiet
    const { env } = sanitizeEnv(this.opts.baseEnv ?? process.env, { MCP_TOOL_TIMEOUT: String(ANSWER_WAIT_MS), JARVIS_SUPERVISED: '1' });
    const child = spawn(this.opts.command, [...(this.opts.prefixArgs ?? []), ...codeArgs(args)], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => {
      if (stderr.length < 4000) stderr += d;
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      for (const e of parseCodeLine(line)) onEvent(e);
    });
    const done = new Promise<void>((resolve) => {
      child.on('error', (err) => {
        stderr += String(err);
      });
      child.on('close', (code) => {
        onEvent({ type: 'exit', code, stderr: stderr.trim() });
        resolve();
      });
    });
    return { stop: () => child.kill(), done };
  }

  /** One short, tool-less Haiku call. Returns its text reply, or null if it failed. */
  async advise(prompt: string, system: string, cwd: string): Promise<string | null> {
    const { env } = sanitizeEnv(this.opts.baseEnv ?? process.env);
    const args = [
      ...(this.opts.prefixArgs ?? []),
      '-p',
      prompt,
      '--output-format',
      'json',
      '--model',
      'haiku',
      '--max-turns',
      '1',
      '--tools',
      '',
      '--system-prompt',
      system,
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--setting-sources',
      '',
      '--disable-slash-commands',
      '--no-session-persistence',
    ];
    return new Promise((resolve) => {
      const child = spawn(this.opts.command, args, { cwd, env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      let out = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d: string) => (out += d));
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on('error', () => resolve(null));
      child.on('close', () => {
        clearTimeout(timer);
        try {
          const j = JSON.parse(out);
          resolve(typeof j.result === 'string' && !j.is_error ? j.result : null);
        } catch {
          resolve(null);
        }
      });
    });
  }
}
