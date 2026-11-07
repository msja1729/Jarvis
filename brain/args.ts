/**
 * The exact `claude` flags for every run (SPEC 4.4, PLAN section 2).
 * This is the only place CLI flags are built.
 */
import { JARVIS_SYSTEM_PROMPT } from './system-prompt.js';
import type { ModelChoice } from './brain.js';

export const DEFAULT_MAX_TURNS = 8;
export const GATEWAY_SERVER_NAME = 'jarvis';

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
}

export function mcpConfigJson(gateway: GatewayLaunch | null): string {
  const mcpServers = gateway
    ? { [GATEWAY_SERVER_NAME]: { type: 'stdio', command: gateway.command, args: gateway.args, env: gateway.env } }
    : {};
  return JSON.stringify({ mcpServers });
}

export function buildArgs(r: RunArgs): string[] {
  const args = [
    '-p',
    r.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    r.model,
    '--max-turns',
    String(r.maxTurns ?? DEFAULT_MAX_TURNS),
    '--tools',
    '',
    '--system-prompt',
    JARVIS_SYSTEM_PROMPT,
    '--mcp-config',
    mcpConfigJson(r.gateway),
    '--strict-mcp-config',
    '--allowedTools',
    `mcp__${GATEWAY_SERVER_NAME}`,
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--setting-sources',
    '',
    '--disable-slash-commands',
  ];
  if (r.sessionId) args.push('--resume', r.sessionId);
  return args;
}
