/**
 * Watching Claude Code sessions the user starts themselves (VS Code, terminal):
 * Jarvis adds two clearly marked hooks to ~/.claude/settings.json, only when the
 * user switches this on, and removes exactly those when it is switched off.
 * Claude Code then runs a tiny script that tells Jarvis when a session finishes
 * ("Stop") or needs the user ("Notification"). Nothing else in the file is changed.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Every hook command Jarvis adds contains this marker, so it can find and remove only its own. */
export const HOOK_MARKER = 'jarvis-claude-hook';
const EVENTS = ['Stop', 'Notification'] as const;

type HookEntry = { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number }[] };
type Settings = { hooks?: Record<string, HookEntry[]>; [k: string]: unknown };

const isOurs = (e: HookEntry) => (e.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes(HOOK_MARKER));

export function withJarvisHooks(settings: Settings, command: string): Settings {
  const out: Settings = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  for (const ev of EVENTS) {
    const list = (out.hooks![ev] ?? []).filter((e) => !isOurs(e));
    list.push({ hooks: [{ type: 'command', command, timeout: 10 }] });
    out.hooks![ev] = list;
  }
  return out;
}

export function withoutJarvisHooks(settings: Settings): Settings {
  if (!settings.hooks) return settings;
  const hooks: Record<string, HookEntry[]> = {};
  for (const [ev, list] of Object.entries(settings.hooks)) {
    const kept = (Array.isArray(list) ? list : []).filter((e) => !isOurs(e));
    if (kept.length) hooks[ev] = kept;
  }
  const out: Settings = { ...settings, hooks };
  if (!Object.keys(hooks).length) delete out.hooks;
  return out;
}

export function hasJarvisHooks(settings: Settings): boolean {
  return EVENTS.every((ev) => (settings.hooks?.[ev] ?? []).some(isOurs));
}

/** The command Claude Code runs. It uses Jarvis's own runtime, so Node.js is not needed. */
export function hookCommand(runtime: string, script: string, endpointFile: string): string {
  const q = (s: string) => `"${s.replace(/\\/g, '/')}"`;
  // Claude Code runs hooks in a POSIX shell (Git Bash on Windows); the marker is the script's name.
  return `ELECTRON_RUN_AS_NODE=1 ${q(runtime)} ${q(script)} ${q(endpointFile)}`;
}

function read(file: string): Settings {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Settings;
  } catch {
    throw new Error(`Your Claude Code settings file (${file}) is not valid JSON, so Jarvis did not change it.`);
  }
}

function write(file: string, settings: Settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // keep one copy of the user's original file, the first time Jarvis touches it
  const backup = `${file}.before-jarvis`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const tmp = `${file}.jarvis-tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function installHooks(settingsFile: string, command: string): void {
  write(settingsFile, withJarvisHooks(read(settingsFile), command));
}

export function removeHooks(settingsFile: string): void {
  if (!fs.existsSync(settingsFile)) return;
  const s = read(settingsFile);
  if (!s.hooks || !Object.values(s.hooks).some((l) => Array.isArray(l) && l.some(isOurs))) return;
  write(settingsFile, withoutJarvisHooks(s));
}

export function hooksInstalled(settingsFile: string): boolean {
  try {
    return hasJarvisHooks(read(settingsFile));
  } catch {
    return false;
  }
}
