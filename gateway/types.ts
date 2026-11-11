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
   * Built-in, local-only abilities (e.g. saving a file in a team member's own folder) may
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
  /** On without any setup (screen, recorder, team folders). Others start off until connected. */
  defaultEnabled?: boolean;
  abilities: AbilityDef[];
  /** For user-added MCP apps. auth: "oauth" = browser sign-in, "key" = API key/token, "none". */
  mcp?: { url?: string; command?: string; args?: string[]; auth?: 'oauth' | 'key' | 'none' };
}

export interface AppSettings {
  enabled: boolean;
  abilities: Record<string, AbilitySetting>;
}

export const EXPLAIN_LEVELS = ['auto', 'eli5', 'student', 'professional'] as const;
export type ExplainLevel = (typeof EXPLAIN_LEVELS)[number];

export interface JarvisSettings {
  apps: Record<string, AppSettings>;
  /** User-added apps (definitions are stored, credentials are not). */
  customApps: AppDef[];
  modelOverride: 'haiku' | 'sonnet' | null;
  /** Natural voice (Kokoro voice id) and speaking speed. */
  ttsVoice?: string;
  ttsSpeed?: number;
  /** Push-to-talk hotkey (Electron accelerator); null = platform default. */
  pttHotkey?: string | null;
  /** Coding supervisor: how much Jarvis may approve on its own, update interval (minutes, 0 = milestones only), speak updates, last project folder. */
  supervisor?: { autonomy?: 'careful' | 'balanced' | 'handsoff'; updateEvery?: number; speak?: boolean; lastFolder?: string; watchOwn?: boolean };
  /** PA: the morning plan time ("08:30", null = off) and the last day it ran. */
  pa?: { planAt?: string | null; lastPlan?: string };
  /** Shortcut that shows/hides the voice card while Jarvis answers; null = default. */
  voiceCardHotkey?: string | null;
  /** OAuth client IDs for Google / Microsoft sign-in (not secret). */
  oauthClients: Record<string, { clientId: string }>;
  voiceOutput: boolean;
  /** Natural voice chosen for each team role (Jarvis itself uses ttsVoice). */
  roleVoices?: Record<string, string>;
  /** Who may use each app (app id → team members), chosen in the Tool Hub; missing = the usual members. */
  appRoles?: Record<string, string[]>;
  /** Names the user gave team members ("Sara" for the Doctor). */
  roleNames?: Record<string, string>;
  /** Pause music and videos while you talk to the team and while they speak (default on). */
  pauseMedia?: boolean;
  /** Meeting recordings also record the screen (video + pictures of what was shown). Default on. */
  recordScreen?: boolean;
  /** Keep a meeting's video and pictures after its notes are written. Default off (they are deleted). */
  keepMeetingMedia?: boolean;
  /** First-run welcome finished (setup, tools, voices, meeting the team). */
  onboarded?: boolean;
  /** How names should sound when spoken (name → "say it like" spelling), e.g. the user's own name. */
  pronunciations?: Record<string, string>;
  /** What the team calls the user, chosen during setup. */
  userName?: string;
  /** Keep chat history on this computer (default on). */
  keepHistory?: boolean;
  /** How Jarvis pitches explanations: auto (guess from the question), eli5, student or professional. */
  explainLevel?: ExplainLevel;
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

/** Who is calling a tool: the team member (jarvis, pa, doctor…) and whether a teammate consulted them. */
export interface CallContext {
  role: string;
  consult?: boolean;
}

export interface AppExecutor {
  call(ability: string, input: Record<string, unknown>, ctx?: CallContext): Promise<RawResult>;
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
