/** Shared types for apps, abilities, and ability settings (SPEC 6.3). */

export type AbilityGroup = 'read' | 'write' | 'act' | 'destructive';
export type AbilitySetting = 'off' | 'ask' | 'allowed';

export const GROUP_DEFAULTS: Record<AbilityGroup, AbilitySetting> = {
  read: 'allowed',
  write: 'ask',
  act: 'ask',
  destructive: 'ask',
};

export interface JsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface AbilityDef {
  /** Machine name, e.g. "send_email". Becomes part of the tool name. */
  name: string;
  /** Human label for the Tool Hub, e.g. "Send email". */
  title: string;
  /** One short sentence shown to Claude (T4). */
  description: string;
  /** Missing group is treated as "act" (SPEC 6.3, criterion 30). */
  group?: AbilityGroup;
  inputSchema: JsonSchema;
  /** Progress label shown while running, e.g. "Reading Gmail". */
  progress?: string;
  /**
   * Built-in list abilities that enforce their own per-item limits (SPEC 5 table)
   * may raise the generic 4,000-char cap. Ignored for user-added (third-party) apps.
   */
  resultLimit?: number;
  /**
   * Built-in, local-only abilities (e.g. drawing on Jarvis's own whiteboard) may
   * start with a different default than their group. Never "allowed" for destructive.
   */
  defaultSetting?: AbilitySetting;
}

export interface AppDef {
  /** Short stable id, e.g. "gmail". Lowercase letters, digits, underscore. */
  id: string;
  name: string;
  description: string;
  kind: 'builtin' | 'mcp';
  /** On without any setup (screen, whiteboard, recorder). Others start off until connected. */
  defaultEnabled?: boolean;
  abilities: AbilityDef[];
  /** For user-added MCP apps. auth: "oauth" = browser sign-in, "key" = API key/token, "none". */
  mcp?: { url?: string; command?: string; args?: string[]; auth?: 'oauth' | 'key' | 'none' };
}

export interface AppSettings {
  enabled: boolean;
  abilities: Record<string, AbilitySetting>;
}

export interface JarvisSettings {
  apps: Record<string, AppSettings>;
  /** User-added apps (definitions are stored, credentials are not). */
  customApps: AppDef[];
  modelOverride: 'haiku' | 'sonnet' | null;
  /** Push-to-talk hotkey (Electron accelerator); null = platform default. */
  pttHotkey?: string | null;
  /** OAuth client IDs for Google / Microsoft sign-in (not secret). */
  oauthClients: Record<string, { clientId: string }>;
  voiceOutput: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ToolResult {
  text: string;
  isError: boolean;
  /** Images (already scaled, T7) as base64 PNG/JPEG. */
  images?: { data: string; mimeType: string }[];
}

/** What an app executor returns before trimming. */
export interface RawResult {
  text: string;
  images?: { data: string; mimeType: string }[];
}

export interface AppExecutor {
  call(ability: string, input: Record<string, unknown>): Promise<RawResult>;
}

export interface ConfirmRequest {
  appId: string;
  appName: string;
  ability: string;
  abilityTitle: string;
  group: AbilityGroup;
  input: Record<string, unknown>;
  /** Plain-language description of exactly what will happen. */
  summary: string;
}

export type Confirmer = (req: ConfirmRequest) => Promise<boolean>;

export const TOOL_SEPARATOR = '__';

export function toolName(appId: string, ability: string): string {
  return `${appId}${TOOL_SEPARATOR}${ability}`;
}

export function parseToolName(name: string): { appId: string; ability: string } | null {
  const i = name.indexOf(TOOL_SEPARATOR);
  if (i <= 0) return null;
  return { appId: name.slice(0, i), ability: name.slice(i + TOOL_SEPARATOR.length) };
}
