/**
 * The exact `claude` flags for every run (SPEC 4.4, PLAN section 2).
 * This is the only place CLI flags are built.
 */
import { JARVIS_SYSTEM_PROMPT } from './system-prompt.js';
import { CLI_MODEL, ModelChoice } from './brain.js';

export const DEFAULT_MAX_TURNS = 8;
export const GATEWAY_SERVER_NAME = 'jarvis';
/** The experts' permission-prompt tool: Jarvis decides (or asks the user) for Claude Code's own tools. */
export const EXPERT_APPROVE_SERVER = 'jarvis_approve';
export const EXPERT_APPROVE_TOOL = `mcp__${EXPERT_APPROVE_SERVER}__approve`;
/**
 * The Claude Code tools experts get. Only these: every tool's description is sent with every request,
 * and the full default set costs about 37,000 tokens a request against about 7,000 for this one.
 */
export const EXPERT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash', 'TodoWrite'];
/** Experts with Claude Code's tools need more steps (read, write, check). */
export const TOOLS_MAX_TURNS = 16;

export interface GatewayLaunch {
  /** Executable that runs the shim (Electron binary or node). */
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface RunArgs {
  prompt: string;
  model: ModelChoice;
  sessionId: string | null;
  gateway: GatewayLaunch | null;
  maxTurns?: number;
  /** A team role's fixed system prompt; Jarvis's own when not given. */
  systemPrompt?: string;
  /** Stream the reply as it is written (for speaking early). */
  partial?: boolean;
  /**
   * Claude Code's own tools too (an expert at work in their folder). Every permission prompt goes to
   * `approve` (Jarvis); permission checks are never skipped.
   */
  builtinTools?: { approve: GatewayLaunch; addDirs: string[] };
}

export function mcpConfigJson(gateway: GatewayLaunch | null, approve?: GatewayLaunch): string {
  const mcpServers: Record<string, unknown> = gateway
    ? { [GATEWAY_SERVER_NAME]: { type: 'stdio', command: gateway.command, args: gateway.args, env: gateway.env } }
    : {};
  if (approve) mcpServers[EXPERT_APPROVE_SERVER] = { type: 'stdio', command: approve.command, args: approve.args, env: approve.env };
  return JSON.stringify({ mcpServers });
}

export function buildArgs(r: RunArgs): string[] {
  const tools = r.builtinTools;
  const args = [
    '-p',
    r.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    CLI_MODEL[r.model] ?? r.model,
    '--max-turns',
    String(r.maxTurns ?? (tools ? TOOLS_MAX_TURNS : DEFAULT_MAX_TURNS)),
    // the front desk has no built-in tools; experts get a chosen set of Claude Code's
    '--tools',
    tools ? EXPERT_TOOLS.join(',') : '',
    '--system-prompt',
    r.systemPrompt ?? JARVIS_SYSTEM_PROMPT,
    '--mcp-config',
    mcpConfigJson(r.gateway, tools?.approve),
    '--strict-mcp-config',
    '--allowedTools',
    // Jarvis's own tools are checked by the Gateway; every built-in tool goes to the approve tool
    `mcp__${GATEWAY_SERVER_NAME}`,
    ...(tools
      ? ['--permission-mode', 'manual', '--permission-prompt-tool', EXPERT_APPROVE_TOOL, ...tools.addDirs.flatMap((d) => ['--add-dir', d])]
      : ['--permission-mode', 'dontAsk', '--permission-prompts', 'none']),
    // the user's own Claude settings (allow rules, hooks) never apply: Jarvis decides
    '--setting-sources',
    '',
    '--disable-slash-commands',
  ];
  if (r.partial) args.push('--include-partial-messages');
  if (r.sessionId) args.push('--resume', r.sessionId);
  return args;
}
