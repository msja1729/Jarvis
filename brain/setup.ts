/** First-launch checks (SPEC 4.3, criterion 2). */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sanitizeEnv } from './env.js';

export type SetupStep =
  | { step: 'install'; instructions: string }
  | { step: 'login'; instructions: string }
  | { step: 'ready'; command: string };

export function installInstructions(platform = process.platform): string {
  return platform === 'win32'
    ? 'Install Claude Code: open PowerShell and run\n  irm https://claude.ai/install.ps1 | iex\nThen restart Jarvis.'
    : 'Install Claude Code: open Terminal and run\n  curl -fsSL https://claude.ai/install.sh | bash\nThen restart Jarvis.';
}

export const LOGIN_INSTRUCTIONS =
  'Log in to Claude Code with your Claude Pro account: open a terminal, run\n  claude auth login\nand finish the sign-in in your browser. Then click "Check again".';

/** Candidate locations for the claude executable. */
export function candidatePaths(platform = process.platform, home = os.homedir()): string[] {
  const exe = platform === 'win32' ? 'claude.exe' : 'claude';
  const list = [path.join(home, '.local', 'bin', exe)];
  if (platform === 'darwin') list.push('/opt/homebrew/bin/claude', '/usr/local/bin/claude');
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) list.push(path.join(dir, exe));
  }
  return list;
}

export function findClaude(platform = process.platform): string | null {
  const override = process.env.JARVIS_CLAUDE_PATH;
  if (override && fs.existsSync(override)) return override;
  for (const p of candidatePaths(platform)) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* not here */
    }
  }
  return null;
}

function run(command: string, args: string[], prefix: string[] = []): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...prefix, ...args], { env: sanitizeEnv(process.env).env, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve({ code: -1, out }));
    child.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

/**
 * Reads only `loggedIn` and `authMethod` from `claude auth status`.
 * Jarvis never stores the output (SPEC 7: never read or store the Claude login).
 */
export async function isLoggedIn(command: string, prefix: string[] = []): Promise<boolean> {
  const { code, out } = await run(command, ['auth', 'status'], prefix);
  if (code !== 0) return false;
  try {
    const { loggedIn, authMethod } = JSON.parse(out) as { loggedIn?: boolean; authMethod?: string };
    return loggedIn === true && authMethod !== 'api_key';
  } catch {
    return false;
  }
}

export async function checkSetup(prefix: string[] = [], command = findClaude()): Promise<SetupStep> {
  if (!command) return { step: 'install', instructions: installInstructions() };
  if (!(await isLoggedIn(command, prefix))) return { step: 'login', instructions: LOGIN_INSTRUCTIONS };
  return { step: 'ready', command };
}

/** Opens a visible terminal running one command, for the user to watch (install or sign in). */
function openTerminal(command: string): boolean {
  const { env } = sanitizeEnv(process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.platform === 'win32') {
    // detached: Windows gives the child its own console window, which stays open (-NoExit)
    spawn('powershell.exe', ['-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { detached: true, stdio: 'ignore', env }).unref();
  } else if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script ${JSON.stringify(command)}\ntell application "Terminal" to activate`;
    spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore', env }).unref();
  } else {
    spawn('x-terminal-emulator', ['-e', `bash -lc ${JSON.stringify(`${command}; exec bash`)}`], { detached: true, stdio: 'ignore', env }).unref();
  }
  return true;
}

/** Runs Anthropic's official Claude Code installer in a terminal the user can see. */
export function openInstallTerminal(platform = process.platform): boolean {
  return openTerminal(platform === 'win32' ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash');
}

/** Runs `claude auth login` in a terminal: the user signs in in their browser; Jarvis never sees the login. */
export function openLoginTerminal(platform = process.platform): boolean {
  const exe = findClaude(platform);
  if (!exe) throw new Error('Install Claude Code first.');
  return openTerminal(platform === 'win32' ? `& '${exe.replace(/'/g, "''")}' auth login` : `'${exe.replace(/'/g, "'\\''")}' auth login`);
}
