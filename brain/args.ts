/**
 * The exact `claude` flags for every run (SPEC 4.4, PLAN section 2).
 * This is the only place CLI flags are built.
 */
import { JARVIS_SYSTEM_PROMPT } from './system-prompt.js';
import { CLI_MODEL, ModelChoice } from './brain.js';

export const DEFAULT_MAX_TURNS = 8;
export const GATEWAY_SERVER_NAME = 'jarvis';
/** Jarvis's permission-prompt tool: Jarvis decides (or asks the user) for connector tools and Claude Code's own tools. */
export const EXPERT_APPROVE_SERVER = 'jarvis_approve';
export const EXPERT_APPROVE_TOOL = `mcp__${EXPERT_APPROVE_SERVER}__approve`;
/**
 * The Claude Code tools experts get. Only these: every tool's description is sent with every request,
 * and the full default set costs about 37,000 tokens a request against about 7,000 for this one.
 */
export const EXPERT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash', 'TodoWrite'];
/** Experts with Claude Code's tools need more steps (read, write, check). */
export const TOOLS_MAX_TURNS = 16;
/**
 * Claude Code's tool search: the tools of the apps in the user's Claude account are loaded only when needed
 * (Gmail alone has about 30 tools, some 30,000 tokens a request if they were all sent every time).
 */
export const TOOL_SEARCH = 'ToolSearch';
/** Environment for every run: wait for the Claude account's apps to connect, and load their tools on demand. */
export const CONNECTOR_ENV = { MCP_CONNECTION_NONBLOCKING: 'false', ENABLE_TOOL_SEARCH: 'true' } as const;

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
   * Jarvis's permission-prompt tool. With it, every tool that is not Jarvis's own (apps from the user's
   * Claude account, and an expert's Claude Code tools) asks Jarvis first; permission checks are never skipped.
   */
  approve?: GatewayLaunch | null;
  /** Claude Code's own tools too (an expert at work in their folder). */
  builtinTools?: { addDirs: string[] };
  /** MCP servers this run must not see (connectors the member may not use, the user's own servers): mcp__<key>. */
  hidden?: string[];
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
  const approve = r.approve ?? null;
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
    // the front desk has only tool search; experts also get a chosen set of Claude Code's tools
    '--tools',
    [...(tools ? EXPERT_TOOLS : []), TOOL_SEARCH].join(','),
    '--system-prompt',
    r.systemPrompt ?? JARVIS_SYSTEM_PROMPT,
    // no --strict-mcp-config: it would also turn off the apps in the user's Claude account (connectors).
    // Everything else Claude Code would load is hidden below (r.hidden), and nothing runs without Jarvis.
    '--mcp-config',
    mcpConfigJson(r.gateway, approve ?? undefined),
    '--allowedTools',
    // Jarvis's own tools are checked by the Gateway; finding a tool is harmless; everything else asks Jarvis
    `mcp__${GATEWAY_SERVER_NAME},${TOOL_SEARCH}`,
    ...(r.hidden?.length ? ['--disallowedTools', r.hidden.join(',')] : []),
    ...(approve
      ? ['--permission-mode', 'manual', '--permission-prompt-tool', EXPERT_APPROVE_TOOL]
      : ['--permission-mode', 'dontAsk', '--permission-prompts', 'none']),
    ...(tools ? tools.addDirs.flatMap((d) => ['--add-dir', d]) : []),
    // the user's own Claude settings (allow rules, hooks) never apply: Jarvis decides
    '--setting-sources',
    '',
    '--disable-slash-commands',
  ];
  if (r.partial) args.push('--include-partial-messages');
  if (r.sessionId) args.push('--resume', r.sessionId);
  return args;
}
