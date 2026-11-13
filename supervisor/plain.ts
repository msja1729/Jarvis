/**
 * Everyday words for what Claude wants to do, for people who don't read commands:
 * "npm install axios" → "install the add-on axios from the internet". The command itself is still shown,
 * in small print, for those who want it. Also: the steps the team never takes on its own (team decides).
 */
import path from 'node:path';
import { inside, outsidePaths, SECRET, splitCommand } from './policy.js';
import type { PermissionRequest } from './policy.js';

const words = (s: string) => s.split(/\s+/).filter(Boolean);
/** The non-flag arguments after the first n words ("npm install -D a b" → a, b). */
const args = (p: string, n: number) => words(p).slice(n).filter((a) => !a.startsWith('-') && !/^\d?[<>]/.test(a) && !/^[$&]/.test(a)).map((a) => a.replace(/^["']|["']$/g, ''));
const list = (xs: string[], max = 3) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(xs.length === 2 ? ' and ' : ', '));
const fileWord = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.length} files (${list(xs.map((x) => path.basename(x)))})`);
const host = (cmd: string) => cmd.match(/https?:\/\/([^/\s"']+)/i)?.[1];

/** One part of a command, in everyday words. */
function one(p: string): string {
  const t = p.trim();
  const low = t.toLowerCase();
  // add-ons (packages)
  let m = t.match(/^(npm|pnpm|yarn|bun)\s+(install|i|add|ci)\b/i);
  if (m) {
    const pk = args(t, 2);
    return pk.length ? `install the add-on${pk.length > 1 ? 's' : ''} ${list(pk)} from the internet` : 'install the add-ons this project needs from the internet';
  }
  if (/^(pip|pip3|pipx|poetry|uv|conda)\s+(install|add)\b/i.test(t)) {
    const pk = args(t, 2).filter((a) => !/requirements/.test(a));
    return pk.length ? `install the Python add-on${pk.length > 1 ? 's' : ''} ${list(pk)} from the internet` : 'install the Python add-ons this project needs from the internet';
  }
  if (/^(npm|pnpm|yarn|bun|pip|pip3)\s+(remove|rm|uninstall|un)\b/i.test(t)) return `remove the add-on${args(t, 2).length > 1 ? 's' : ''} ${list(args(t, 2)) || ''}`.trim();
  if (/^(npm|pnpm|yarn|bun)\s+(update|upgrade|up)\b/i.test(t)) return 'update the add-ons to newer versions from the internet';
  if (/^(npm|pnpm|yarn)\s+publish\b/i.test(t)) return 'publish this package online for everyone to download';
  if (/^(winget|choco|scoop|brew|apt|apt-get|dnf|yum|pacman)\s+/i.test(t)) return 'install or remove a program on your computer';
  // git
  if (/\s(-v|--version|-version)\s*$/i.test(t) || /^\S+\s+version\s*$/i.test(t)) return 'check which version of a tool is installed';
  if (/^git\s+push\b/i.test(t)) return 'publish the code changes online (to GitHub or another server)';
  if (/^gh\s+(repo|release|pr|gist)\s+create\b/i.test(t)) return 'publish the code online on GitHub';
  if (/^gh\s+auth\b/i.test(t)) return 'check your GitHub sign-in';
  if (/^gh\b/i.test(t)) return 'use GitHub';
  if (/^git\s+init\b/i.test(t)) return 'start keeping track of code changes';
  if (/^git\s+(config|remote)\b/i.test(t)) return 'change the code-tracking settings of the project';
  if (/^git\s+commit\b/i.test(t)) return 'save a checkpoint of the code changes';
  if (/^git\s+(reset\s+--hard|clean|checkout\s+(--\s|\.)|restore\s+(?!--staged))/i.test(t)) return 'throw away code changes that were not saved';
  if (/^git\s+(rebase|filter-branch|update-ref)\b/i.test(t)) return 'rewrite the history of saved code changes';
  if (/^git\s+(pull|fetch|clone)\b/i.test(t)) return 'download code from the internet';
  if (/^git\s+branch\s+-[dD]\b/i.test(t)) return 'delete a branch of the code';
  if (/^git\s+stash\s+(drop|clear)\b/i.test(t)) return 'throw away put-aside code changes';
  if (/^git\b/i.test(t)) return 'look at or organise the code changes';
  // deleting, moving, folders
  m = t.match(/^(rm|del|erase|unlink|shred|remove-item)\b/i);
  if (m) {
    const fs = args(t, 1).filter((a) => !/^(-|\/)[a-z]$/i.test(a));
    return fs.length ? `delete ${fileWord(fs)}` : 'delete files';
  }
  if (/^(rmdir|rd)\b/i.test(t)) return `delete the folder ${args(t, 1)[0] ?? ''}`.trim();
  if (/^(mkdir|md|new-item)\b/i.test(t)) return `create the folder ${args(t, 1).filter((a) => !/^(directory|file|-itemtype)$/i.test(a))[0] ?? ''}`.trim();
  if (/^(mv|move|move-item|ren|rename|rename-item)\b/i.test(t)) return 'move or rename files';
  if (/^(cp|copy|copy-item|xcopy|robocopy)\b/i.test(t)) return 'copy files';
  // the internet, other computers
  if (/^(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm)\b/i.test(t)) return `download something from the internet${host(t) ? ` (${host(t)})` : ''}`;
  if (/^(ssh|scp|sftp|ftp|telnet|nc|ncat)\b/i.test(t)) return 'connect to another computer';
  // the computer itself
  if (/^(sudo|runas)\b/i.test(t)) return 'run a command as administrator';
  if (/^(reg|setx|set-executionpolicy)\b/i.test(t)) return 'change a Windows setting';
  if (/^(taskkill|kill|stop-process)\b/i.test(t)) return 'stop another program that is running';
  if (/^(shutdown|restart-computer|stop-computer)\b/i.test(t)) return 'shut down or restart the computer';
  if (/^(chmod|chown|icacls|takeown)\b/i.test(t)) return 'change who may open some files';
  if (/^(format|diskpart|mkfs)\b/i.test(t)) return 'change a disk (this can erase it)';
  if (/^(schtasks|crontab|new-service|sc\.exe)\b/i.test(t)) return 'set up something that runs on its own on your computer';
  // cloud
  if (/^(vercel|netlify|firebase|heroku)\b/i.test(t)) return 'publish the app online';
  if (/^(docker|kubectl)\b/i.test(t)) return 'use Docker containers';
  if (/^(aws|az|gcloud|terraform)\b/i.test(t)) return 'change cloud services';
  // checking and running the project
  if (/^((npm|pnpm|yarn|bun)\s+(test|t|run\s+test)|npx\s+(vitest|jest|mocha|playwright)|vitest|jest|pytest|python\s+-m\s+(pytest|unittest)|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|make\s+test)\b/i.test(t)) return "run the project's tests";
  if (/^((npm|pnpm|yarn|bun)\s+run\s+(build|compile)|tsc|npx\s+tsc|go\s+build|cargo\s+build|dotnet\s+build|mvn\s+compile)\b/i.test(t)) return 'build the project';
  if (/^((npm|pnpm|yarn|bun)\s+run\s+(lint|typecheck|type-check|check|format)|eslint|npx\s+(eslint|prettier|biome)|prettier|ruff|flake8|pylint|mypy|black)\b/i.test(t)) return 'check the code for mistakes';
  if (/^(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b/i.test(t)) return 'start the app to try it';
  if ((m = t.match(/^(node|python|python3|py|deno|bun|tsx|ts-node|npx)\s+([^\s-][^\s]*)/i))) return `run the program ${path.basename(m[2].replace(/^["']|["']$/g, ''))}`;
  if (/^(ls|dir|cat|type|head|tail|grep|rg|find|findstr|get-childitem|gci|get-content|gc|select-string|tree|wc|pwd|cd|echo|set-location|test-path)\b/i.test(t)) return 'look at files';
  if (/^(npm|pnpm|yarn|node|python|py|go|cargo|java|dotnet)\b.*\s(-v|--version|version)\s*$/i.test(t)) return 'check which version of a tool is installed';
  const prog = words(low)[0]?.replace(/^["']|["']$/g, '') ?? '';
  return prog ? `run the program "${path.basename(prog)}"` : 'run a command';
}

/** Pieces of a script that only glue it together (PowerShell pipes, variables, messages): not worth saying. */
const GLUE = /^(select-object|select|out-null|out-string|out-host|foreach-object|foreach|%|where-object|where|\?|sort-object|sort|measure-object|format-\w+|write-host|write-output|write-error|echo|exit|return|if|else|elseif|try|catch|finally|throw|set-strictmode|true|false|null)(\s|$)/i;
function tidy(p: string): string {
  return p
    .trim()
    .replace(/^\$[\w:]+\s*=\s*/, '') // $o = npm install … → npm install …
    .replace(/^[&.]\s+/, '') // & git … (a PowerShell call)
    .replace(/^\{+\s*|\s*\}+$/g, '')
    .trim();
}
const isGlue = (p: string) => !p || GLUE.test(p) || /^[$"'[{}@(]/.test(p) || /^[\w-]+:(\s|$)/.test(p) || /^\d/.test(p) || /^2?>/.test(p);

/** A whole command line in everyday words ("cd x && npm install a" → "install the add-on a from the internet"). */
export function plainCommand(cmd: string): string {
  const all = splitCommand(cmd)
    .map(tidy)
    .filter((p) => p && !/^(cd|set-location|pushd|popd)(\s|$)/i.test(p));
  const real = all.filter((p) => !isGlue(p));
  const parts = real.length ? real : all;
  const said: string[] = [];
  for (const p of parts) {
    const d = one(p);
    if (!said.includes(d) && !(d === 'look at files' && parts.length > 1)) said.push(d);
  }
  if (!said.length) return 'run a command';
  return said.length === 1 ? said[0] : `${said.slice(0, -1).join(', ')} and then ${said.at(-1)}`;
}

/**
 * The steps the team never takes on its own, even when the user asked them to decide everything
 * (the user's choice, 2026-11-13): publishing online, anything outside the project folder (including the
 * computer's own settings), and files that may hold passwords or keys. Returns why, or null.
 */
export function keptForUser(req: PermissionRequest, root: string): string | null {
  const input = req.input ?? {};
  const file = [input.file_path, input.notebook_path, input.path].find((v): v is string => typeof v === 'string');
  if (file && SECRET.test(file)) return 'it opens a file that may hold passwords or keys';
  if (file && !inside(root, file)) return 'it is outside the project folder';
  if (req.tool_name === 'Bash' || req.tool_name === 'PowerShell') {
    const cmd = typeof input.command === 'string' ? input.command : '';
    if (/\bgit\s+push\b|\b(npm|pnpm|yarn)\s+publish\b|\b(vercel|netlify|firebase|heroku)\b|\bgh\s+(release|pr|repo)\s+create\b/i.test(cmd)) return 'it publishes online';
    if (SECRET.test(cmd) || /(^|[\s"'\\/])(\.env(\.[\w-]+)?|id_(rsa|ed25519)|credentials[^\s]*)(\s|$|["'])/i.test(cmd)) return 'it touches a file that may hold passwords or keys';
    if (outsidePaths(cmd, root).length) return 'it reaches outside the project folder';
    if (/\b(sudo|runas|reg|setx|set-executionpolicy|shutdown|restart-computer|stop-computer|format|diskpart|mkfs|schtasks|crontab|new-service|sc\.exe|winget|choco|scoop|brew|apt|apt-get|taskkill|stop-process)\b/i.test(cmd)) return "it changes your computer, not just the project";
  }
  return null;
}
