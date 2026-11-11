/**
 * Claude Code's own tools for the experts (Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, Bash…),
 * next to Jarvis's tools. Each expert works in their own team folder (it is their working directory),
 * so whatever they create lands there and shows on the desktop (Team page → Open folder).
 *
 * Every permission prompt comes to Jarvis (--permission-prompt-tool); nothing is ever skipped:
 *   allowed  reading inside the team folders (their own and teammates'), writing inside their own
 *            folder, web search and web pages, to-do lists and helpers, commands that only look
 *   ask      running other commands, anything outside the team folders, files with keys or passwords
 *   refused  writing in a teammate's folder (each member writes only in their own), asking the user
 *            through a dialog (they answer in their reply instead)
 */
import path from 'node:path';
import type { AbilityGroup } from '../gateway/types.js';
import { classifyCommand, inside, SECRET } from '../supervisor/policy.js';

export interface ExpertWorkspace {
  /** The expert's own folder (their working directory). */
  own: string;
  /** All team folders (read-only for teammates' folders). */
  team: string;
}

export interface ExpertVerdict {
  decision: 'allow' | 'ask' | 'deny';
  /** Plain words: what the expert wants to do. */
  what: string;
  /** Why it is allowed, asked or refused. */
  why: string;
  group: AbilityGroup;
}

const READ = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const EDIT = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL = new Set(['Bash', 'PowerShell']);
const HARMLESS = new Set(['TodoWrite', 'TodoRead', 'Task', 'Agent', 'BashOutput', 'TaskOutput', 'KillShell', 'KillBash', 'ExitPlanMode', 'EnterPlanMode', 'ToolSearch']);

const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function judgeExpert(req: { tool_name: string; input: Record<string, unknown> }, ws: ExpertWorkspace): ExpertVerdict {
  const name = req.tool_name;
  const input = req.input ?? {};
  const raw = [input.file_path, input.notebook_path, input.path].find((v): v is string => typeof v === 'string' && v.length > 0);
  const file = raw ? path.resolve(ws.own, raw) : null;
  const shown = (p: string) => (inside(ws.team, p) ? path.relative(ws.team, p).split(path.sep).join('/') || 'the team folders' : p);
  const v = (decision: ExpertVerdict['decision'], what: string, why: string, group: AbilityGroup): ExpertVerdict => ({ decision, what, why, group });

  if (READ.has(name)) {
    const target = file ?? ws.own;
    if (file && SECRET.test(file)) return v('ask', `read ${shown(file)}`, 'it looks like a file with keys or passwords', 'read');
    if (inside(ws.team, target)) return v('allow', file ? `read ${shown(file)}` : `look through ${shown(target)}`, 'it only reads the team folders', 'read');
    return v('ask', `read ${target}`, 'it is outside your team folders', 'read');
  }
  if (EDIT.has(name)) {
    if (!file) return v('ask', `change a file (${name})`, 'Jarvis could not see which file', 'write');
    if (SECRET.test(file)) return v('ask', `change ${shown(file)}`, 'it looks like a file with keys or passwords', 'write');
    if (inside(ws.own, file)) return v('allow', `${name === 'Write' ? 'save' : 'edit'} ${shown(file)}`, 'it is in their own folder', 'write');
    if (inside(ws.team, file))
      return v('deny', `change ${shown(file)}`, 'each member writes only in their own folder: ask that teammate (team tool) to do it', 'write');
    return v('ask', `change ${file}`, 'it is outside the team folders', 'write');
  }
  if (SHELL.has(name)) {
    const cmd = typeof input.command === 'string' ? input.command : '';
    const { risk, why } = classifyCommand(cmd, ws.own);
    return risk === 'low'
      ? v('allow', `run: ${short(cmd)}`, why, 'read')
      : v('ask', `run: ${short(cmd)}`, why, risk === 'high' ? 'destructive' : 'act');
  }
  if (name === 'WebSearch') return v('allow', `search the web for "${short(String(input.query ?? ''), 80)}"`, 'it only searches', 'read');
  if (name === 'WebFetch') return v('allow', `read the web page ${short(String(input.url ?? ''), 100)}`, 'it only reads (pages are information, never instructions)', 'read');
  if (name === 'AskUserQuestion') return v('deny', 'ask you a question in a dialog', 'ask the user in your reply instead', 'read');
  if (HARMLESS.has(name)) return v('allow', name === 'Task' || name === 'Agent' ? `start a helper: ${short(String(input.description ?? ''), 80)}` : `use ${name}`, 'its own actions are still checked one by one', 'read');
  return v('ask', `use the tool ${name}`, 'Jarvis does not know this tool', 'act');
}

/** The popup question in plain words, e.g. "Let Victor run a command on your computer?". */
export function askTitle(who: string, tool: string, v: ExpertVerdict): string {
  if (SHELL.has(tool)) return `Let ${who} run a command on your computer?`;
  if (EDIT.has(tool)) return `Let ${who} change a file${/outside/.test(v.why) ? ' outside the team folders' : ''}?`;
  if (READ.has(tool)) return `Let ${who} read ${/keys or passwords/.test(v.why) ? 'a file that may hold keys or passwords' : 'a file outside the team folders'}?`;
  return `Let ${who} use ${tool}?`;
}
