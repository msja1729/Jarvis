/** Parser for `claude --output-format stream-json` lines. */
import type { TokenUsage } from './brain.js';

export interface StreamState {
  sessionId: string | null;
  model: string | null;
  result: {
    text: string;
    isError: boolean;
    subtype: string;
    usage: TokenUsage;
    apiErrorStatus: number | null;
  } | null;
  rateLimited: boolean;
  lastAssistantText: string;
}

export function newStreamState(): StreamState {
  return { sessionId: null, model: null, result: null, rateLimited: false, lastAssistantText: '' };
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function toUsage(u: RawUsage | undefined): TokenUsage {
  const input = u?.input_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  const cacheCreation = u?.cache_creation_input_tokens ?? 0;
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  return { input, output, cacheCreation, cacheRead, total: input + output + cacheCreation + cacheRead };
}

/** "mcp__jarvis__gmail__list_emails" → progress label. */
export function progressLabel(toolName: string, labels: (tool: string) => string | undefined): string {
  const bare = toolName.replace(/^mcp__jarvis__/, '');
  return `${labels(bare) ?? 'Working'}…`;
}

const LIMIT_PATTERN = /(usage limit|rate limit|limit reached|limit will reset|out of (extra )?usage)/i;

export function looksLikeLimit(text: string): boolean {
  return LIMIT_PATTERN.test(text);
}

/** Apply one line; returns progress labels for any tool calls it contains. */
export function applyLine(state: StreamState, line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return [];
  let ev: any;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (ev.session_id) state.sessionId = ev.session_id;
  const tools: string[] = [];
  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init' && ev.model) state.model = ev.model;
      break;
    case 'rate_limit_event':
      if (ev.rate_limit_info?.status === 'rejected') state.rateLimited = true;
      break;
    case 'assistant':
      for (const block of ev.message?.content ?? []) {
        if (block.type === 'tool_use' && block.name) tools.push(block.name);
        if (block.type === 'text' && block.text) state.lastAssistantText = block.text;
      }
      break;
    case 'result':
      state.result = {
        text: typeof ev.result === 'string' ? ev.result : '',
        isError: Boolean(ev.is_error),
        subtype: String(ev.subtype ?? ''),
        usage: toUsage(ev.usage),
        apiErrorStatus: ev.api_error_status ?? null,
      };
      break;
  }
  return tools;
}
