/**
 * Uninstall: put the computer back as if Jarvis had never been installed.
 * The Windows uninstaller runs it through uninstall-cli.ts (Electron as plain Node) just before it
 * removes the app's files; on macOS, Settings → Uninstall runs it. This module only exports
 * functions: importing it never deletes anything. It removes:
 *  - every Jarvis entry in the system keychain (app keys, Google/Microsoft sign-ins),
 *  - the Claude Code hooks Jarvis added to ~/.claude/settings.json (if the user turned them on),
 *  - Claude Code's saved sessions for Jarvis's own working folders (~/.claude/projects/…-Jarvis-brain-cwd and …-Jarvis-Team-*),
 *  - the Jarvis folder: settings, chats, memory, team folders, voices and speech models.
 * It never touches Claude Code itself or the user's own projects.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeHooks } from '../supervisor/hooks.js';
import { SERVICE } from '../security/secrets.js';

export interface Keychain {
  list(service: string): string[];
  remove(service: string, account: string): void;
}

export interface CleanupOptions {
  home: string;
  /** The Jarvis folder (Electron's userData). */
  userData: string;
  keychain?: Keychain;
  service?: string;
  /** Leave the Jarvis folder for the uninstaller to delete (it may still be in use). */
  keepUserData?: boolean;
}

/** How Claude Code names its folder for a working directory: every non-letter/digit becomes "-". */
export const claudeProjectName = (dir: string) => dir.replace(/[^a-zA-Z0-9]/g, '-');

export async function realKeychain(): Promise<Keychain> {
  const { Entry, findCredentials } = await import('@napi-rs/keyring');
  return {
    list: (service) => findCredentials(service).map((c) => c.account),
    remove: (service, account) => {
      try {
        new Entry(service, account).deletePassword();
      } catch {
        /* already gone */
      }
    },
  };
}

export async function uninstallCleanup(o: CleanupOptions): Promise<string[]> {
  const done: string[] = [];
  const service = o.service ?? SERVICE;
  // 1. keychain
  try {
    const kc = o.keychain ?? (await realKeychain());
    const accounts = kc.list(service);
    for (const a of accounts) kc.remove(service, a);
    if (accounts.length) done.push(`removed ${accounts.length} keychain entr${accounts.length === 1 ? 'y' : 'ies'}`);
  } catch (err) {
    done.push(`keychain: ${String(err)}`);
  }
  // 2. Claude Code hooks (only Jarvis's own entries; the user's other hooks stay)
  const claudeDir = path.join(o.home, '.claude');
  try {
    const settings = path.join(claudeDir, 'settings.json');
    const before = fs.existsSync(settings) ? fs.readFileSync(settings, 'utf8') : '';
    removeHooks(settings);
    if (fs.existsSync(settings) && fs.readFileSync(settings, 'utf8') !== before) done.push('removed Jarvis hooks from Claude Code settings');
  } catch (err) {
    done.push(`hooks: ${String(err)}`);
  }
  // 3. Claude Code's saved sessions for Jarvis's own working folder
  try {
    const projects = path.join(claudeDir, 'projects');
    const ours = claudeProjectName(path.join(o.userData, 'brain-cwd')).toLowerCase();
    // experts work in their own team folders (Team/PA, Team/Doctor…), so their sessions are saved under those
    const team = `${claudeProjectName(path.join(o.userData, 'Team')).toLowerCase()}-`;
    if (fs.existsSync(projects)) {
      for (const name of fs.readdirSync(projects)) {
        const n = name.toLowerCase();
        if (n !== ours && !n.startsWith(team)) continue;
        fs.rmSync(path.join(projects, name), { recursive: true, force: true });
        done.push(`removed Claude Code sessions ${name}`);
      }
    }
  } catch (err) {
    done.push(`sessions: ${String(err)}`);
  }
  // 4. the Jarvis folder
  if (!o.keepUserData && fs.existsSync(o.userData)) {
    try {
      fs.rmSync(o.userData, { recursive: true, force: true, maxRetries: 3 });
      done.push(`removed ${o.userData}`);
    } catch (err) {
      done.push(`folder: ${String(err)}`);
    }
  }
  return done;
}

/** The Jarvis folder where Electron keeps it for an installed app. */
export function defaultUserData(platform = process.platform, home = os.homedir()): string {
  if (platform === 'win32') return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Jarvis');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Jarvis');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Jarvis');
}
