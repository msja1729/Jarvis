/**
 * Coding supervisor rules: which of Claude Code's requests Jarvis may approve on
 * its own, and which must go to the user (with Jarvis's advice).
 *
 * Risk levels:
 *   low    - reading, editing files inside the project, running tests/builds/lint
 *   medium - anything unknown, writing via shell redirection, running scripts
 *   high   - deleting, pushing, installing, network access, anything outside the
 *            project folder, secret files. Always goes to the user, at every level.
 *
 * Autonomy (chosen by the user):
 *   careful  - Jarvis approves only reading; everything else goes to the user
 *   balanced - Jarvis approves low risk; medium and high go to the user (default)
 *   handsoff - Jarvis approves low and medium; high goes to the user
 */
import path from 'node:path';

export const AUTONOMY = ['careful', 'balanced', 'handsoff'] as const;
export type Autonomy = (typeof AUTONOMY)[number];
export type Risk = 'low' | 'medium' | 'high';

export interface PermissionRequest {
  tool_name: string;
  input: Record<string, unknown>;
}

export interface Verdict {
  decision: 'allow' | 'ask';
  risk: Risk;
  /** Plain-language description of what Claude wants to do. */
  what: string;
  /** Why it is that risk level. */
  why: string;
  readOnly: boolean;
}

/** Keys, passwords and tokens. */
export const SECRET = /(^|[\\/])(\.env(\.[\w-]+)?|[^\\/]*\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.?(netrc|npmrc|pypirc)|[^\\/]*credentials[^\\/]*|secrets?\.(json|ya?ml|toml))$/i;

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoRead', 'TodoWrite', 'BashOutput', 'TaskOutput', 'ListMcpResourcesTool', 'ReadMcpResourceTool']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

export function inside(root: string, p: string): boolean {
  const abs = path.resolve(root, p);
  const r = path.resolve(root);
  const norm = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
  return norm(abs) === norm(r) || norm(abs).startsWith(norm(r + path.sep));
}

/** Words that make a shell command high risk wherever they appear. */
const HIGH: [RegExp, string][] = [
  [/(^|\s)(rm|del|erase|rmdir|rd|unlink|shred)(\s|$)/i, 'it deletes files'],
  [/\bremove-item\b|\bclear-content\b/i, 'it deletes files'],
  [/\bgit\s+(push|reset\s+--hard|clean|rebase|filter-branch|update-ref)\b|\bgit\s+checkout\s+(--\s|\.)|\bgit\s+branch\s+-[dD]\b|\bgit\s+stash\s+(drop|clear)\b|--force\b|\s-f\s.*\bpush\b/i, 'it changes git history or the remote'],
  [/\b(npm|pnpm|yarn|bun)\s+(install|i|add|remove|rm|uninstall|update|upgrade|publish|link)\b|\bnpx\s+(--yes|-y)\b|\b(pip|pip3|pipx|poetry|uv|conda)\s+(install|add|remove|uninstall)\b|\b(cargo|go)\s+(install|get)\b|\b(gem|choco|winget|scoop|brew|apt|apt-get|dnf|yum|pacman)\s+\w+/i, 'it installs or removes software'],
  [/\b(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm|ssh|scp|sftp|ftp|nc|ncat|telnet)\b|https?:\/\//i, 'it uses the network'],
  [/\b(sudo|runas|chmod|chown|icacls|takeown|reg|setx|shutdown|restart-computer|stop-computer|format|diskpart|mkfs|taskkill|stop-process|kill)\b/i, 'it changes system settings or other programs'],
  [/\b(set-executionpolicy|new-service|sc\.exe|schtasks|crontab)\b/i, 'it changes system settings'],
  [/\b(docker|kubectl|terraform|aws|az|gcloud|vercel|netlify|firebase|heroku)\b/i, 'it touches cloud or container systems'],
];

/** Commands that only look at things or run the project's own checks. */
const LOW: RegExp[] = [
  /^(ls|dir|pwd|cd|echo|cat|type|head|tail|less|more|wc|sort|uniq|tree|which|where|whoami|date|test|true|false|get-childitem|gci|get-content|gc|get-location|select-string|sls|test-path)\b/i,
  /^(grep|rg|egrep|fgrep|findstr|ag|ack)\b/i,
  /^find\b(?!.*\s-(delete|exec|execdir|ok)\b)/i,
  /^git\s+(status|diff|log|show|blame|branch(\s+(-a|-r|--list|-v+))*\s*$|rev-parse|ls-files|remote\s+-v|describe|shortlog|tag\s*$|stash\s+list)\b/i,
  /^git\s+(add|switch|checkout\s+-b|restore\s+--staged)\b/i, // commit is left to the user (medium)
  /^(node|npm|npx|pnpm|yarn|python|python3|py|pip|go|cargo|rustc|java|javac|dotnet|deno|bun|tsc|git)\s+(-v|--version|version)\s*$/i,
  // only well-known check scripts; a script called e.g. "deploy" could do anything
  /^(npm|pnpm|yarn|bun)\s+(test|t|ls|list|outdated|why|run\s+(test|build|lint|typecheck|type-check|check|format:check|compile)(:[\w-]+)?)(\s|$)/i,
  /^npx\s+(tsc|vitest|jest|eslint|prettier|mocha|ava|playwright\s+test|tsx|ts-node|biome|stylelint)\b/i,
  /^(tsc|vitest|jest|eslint|prettier|mocha|pytest|ruff|mypy|black\s+--check|flake8|pylint|go\s+(test|build|vet|fmt)|cargo\s+(test|build|check|clippy|fmt)|mvn\s+(test|compile|verify)|gradle\w*\s+(test|build)|dotnet\s+(test|build)|make\s+test)\b/i,
  /^(python|python3|py)\s+-m\s+(pytest|unittest|mypy|ruff|black\s+--check|compileall)\b/i,
];

function splitCommand(cmd: string): string[] {
  return cmd
    .split(/&&|\|\||;|\||\r?\n/)
    .map((s) => s.trim().replace(/^\(+\s*/, '').replace(/\s*\)+$/, '')) // (a && b) grouping
    .filter(Boolean);
}

/** Absolute paths in a command that point outside the project. */
function outsidePaths(cmd: string, root: string): string[] {
  const found = cmd.match(/(?:[A-Za-z]:[\\/][^\s"'`;|&<>]*|(?<![\w.~-])\/(?:[\w.-]+\/?)+|~[\\/][^\s"'`;|&<>]*)/g) ?? [];
  return found.filter((p) => !p.startsWith('/dev/null') && !(p.startsWith('/') && p.length <= 2) && !inside(root, p.replace(/^~/, process.env.USERPROFILE ?? process.env.HOME ?? '~')));
}

export function classifyCommand(cmd: string, root: string): { risk: Risk; why: string } {
  const text = cmd.trim();
  for (const [re, why] of HIGH) if (re.test(text)) return { risk: 'high', why };
  if (outsidePaths(text, root).length) return { risk: 'high', why: 'it reaches outside your project folder' };
  if (/(^|[^>])>>?\s*\S|\btee\b|\bset-content\b|\badd-content\b|\bout-file\b/i.test(text)) return { risk: 'medium', why: 'it writes files from the command line' };
  if (/\$\(|`|<\(/.test(text)) return { risk: 'medium', why: 'it runs a command inside another command' };
  const parts = splitCommand(text);
  if (parts.length && parts.every((p) => LOW.some((re) => re.test(p)))) return { risk: 'low', why: 'it only looks at files or runs your project\'s checks' };
  return { risk: 'medium', why: 'it runs a program Jarvis does not recognise as safe' };
}

const allowedAt = (risk: Risk, readOnly: boolean, autonomy: Autonomy) =>
  risk === 'high' ? false : autonomy === 'careful' ? readOnly && risk === 'low' : autonomy === 'balanced' ? risk === 'low' : true;

/** Claude often writes `cd "<project>" && npm test`; the user only needs to see `npm test`. */
export function withoutCdToRoot(cmd: string, root: string): string {
  const m = cmd.match(/^\s*(?:cd|Set-Location)\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)\s*/i);
  if (!m) return cmd;
  const dir = m[1] ?? m[2] ?? m[3];
  const norm = (s: string) => path.resolve(s).replace(/[\\/]+$/, '').toLowerCase();
  return norm(dir) === norm(root) ? cmd.slice(m[0].length) : cmd;
}

const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Decides whether Jarvis may approve a request itself or must ask the user. */
export function judge(req: PermissionRequest, root: string, autonomy: Autonomy): Verdict {
  const name = req.tool_name;
  const input = req.input ?? {};
  const file = [input.file_path, input.notebook_path, input.path].find((v): v is string => typeof v === 'string');
  const rel = (p: string) => {
    const r = path.relative(root, path.resolve(root, p));
    return r.startsWith('..') ? p : r.split(path.sep).join('/');
  };
  const out = (risk: Risk, what: string, why: string, readOnly: boolean): Verdict => ({ decision: allowedAt(risk, readOnly, autonomy) ? 'allow' : 'ask', risk, what, why, readOnly });

  if (READ_TOOLS.has(name)) {
    if (file && SECRET.test(file)) return out('high', `read ${rel(file)}`, 'it looks like a file with keys or passwords', true);
    if (file && !inside(root, file)) return out('medium', `read ${file}`, 'it is outside your project folder', true);
    return out('low', file ? `read ${rel(file)}` : `look through the project (${name})`, 'it only reads', true);
  }
  if (EDIT_TOOLS.has(name)) {
    if (!file) return out('medium', `edit a file (${name})`, 'Jarvis could not see which file', false);
    if (!inside(root, file)) return out('high', `change ${file}`, 'it is outside your project folder', false);
    if (SECRET.test(file)) return out('high', `change ${rel(file)}`, 'it looks like a file with keys or passwords', false);
    if (/(^|[\\/])\.git([\\/]|$)/.test(rel(file))) return out('high', `change ${rel(file)}`, 'it is inside git\'s own folder', false);
    return out('low', `${name === 'Write' ? 'write' : 'edit'} ${rel(file)}`, 'it changes a file inside your project', false);
  }
  if (SHELL_TOOLS.has(name)) {
    const cmd = typeof input.command === 'string' ? input.command : '';
    const { risk, why } = classifyCommand(cmd, root);
    return out(risk, `run: ${short(withoutCdToRoot(cmd, root))}`, why, false);
  }
  if (name === 'WebSearch') return out('low', `search the web for "${short(String(input.query ?? ''), 80)}"`, 'it only searches', true);
  if (name === 'WebFetch') return out('medium', `open the web page ${short(String(input.url ?? ''), 100)}`, 'web pages can contain misleading instructions', true);
  if (name === 'Task' || name === 'Agent') return out('low', `start a helper for: ${short(String(input.description ?? input.prompt ?? ''), 80)}`, 'its own actions are still checked one by one', true);
  if (name === 'KillShell' || name === 'KillBash') return out('low', 'stop a command it started', 'it only stops its own command', false);
  return out('medium', `use the tool ${name}`, 'Jarvis does not know this tool', false);
}
