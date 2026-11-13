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
import { classifyCommand, CLAUDE_CONFIG, inside, SECRET } from '../supervisor/policy.js';
import { plainCommand } from '../supervisor/plain.js';
import { HELPER_AGENT } from '../brain/args.js';

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
  /** The exact command, for those who want to see it (the popup shows it in small print). */
  detail?: string;
}

const READ = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const EDIT = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL = new Set(['Bash', 'PowerShell']);
const HARMLESS = new Set(['TodoWrite', 'TodoRead', 'Task', 'Agent', 'BashOutput', 'TaskOutput', 'KillShell', 'KillBash', 'ExitPlanMode', 'EnterPlanMode', 'ToolSearch']);

const v0 = (decision: ExpertVerdict['decision'], what: string, why: string): ExpertVerdict => ({ decision, what, why, group: 'read' });

const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * @param opts.consult a teammate asked this member (they may also be answering the user at this moment):
 *   they only read and answer, so two runs of the same member never change the same files at once.
 */
export function judgeExpert(req: { tool_name: string; input: Record<string, unknown> }, ws: ExpertWorkspace, opts: { consult?: boolean } = {}): ExpertVerdict {
  const name = req.tool_name;
  const input = req.input ?? {};
  if (name === 'Agent' || name === 'Task') {
    const what = `start a helper: ${short(String(input.description ?? ''), 80)}`;
    if (opts.consult) return v0('deny', what, 'a teammate who was asked answers directly, without helpers');
    // only Jarvis's read-only helper: helpers working at the same time must never change files
    if (input.subagent_type !== HELPER_AGENT) return v0('deny', what, `only the read-only helper may be started (subagent_type "${HELPER_AGENT}"): you write the result yourself`);
    // helpers report back before the member goes on (nothing keeps running after the answer)
    if (input.run_in_background === true || (input.isolation !== undefined && input.isolation !== null)) return v0('deny', what, 'helpers must report back before you continue: start them without run_in_background or isolation');
    return v0('allow', what, 'it only reads and searches; its own steps are still checked one by one');
  }
  if (opts.consult && (EDIT.has(name) || (SHELL.has(name) && classifyCommand(typeof input.command === 'string' ? input.command : '', ws.own).risk !== 'low')))
    return v0('deny', name === 'Bash' || name === 'PowerShell' ? plainCommand(String(input.command ?? '')) : `change ${String(input.file_path ?? 'a file')}`, 'a teammate asked you: answer from what you know and read, without changing files (the one who asked does any writing)');
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
    // .mcp.json can start programs and CLAUDE.md is read as instructions on the next run: never written by an expert
    if (CLAUDE_CONFIG.test(file)) return v('deny', `change ${shown(file)}`, "it is a Claude Code settings or instructions file, which an expert never changes", 'write');
    if (inside(ws.own, file)) return v('allow', `${name === 'Write' ? 'save' : 'edit'} ${shown(file)}`, 'it is in their own folder', 'write');
    if (inside(ws.team, file))
      return v('deny', `change ${shown(file)}`, 'each member writes only in their own folder: ask that teammate (team tool) to do it', 'write');
    return v('ask', `change ${file}`, 'it is outside the team folders', 'write');
  }
  if (SHELL.has(name)) {
    const cmd = typeof input.command === 'string' ? input.command : '';
    const { risk, why } = classifyCommand(cmd, ws.own);
    // everyday words ("install the add-on axios from the internet"); the command itself goes in the detail
    const said = plainCommand(cmd);
    return { ...(risk === 'low' ? v('allow', said, why, 'read') : v('ask', said, why, risk === 'high' ? 'destructive' : 'act')), detail: short(cmd, 300) };
  }
  if (name === 'WebSearch') return v('allow', `search the web for "${short(String(input.query ?? ''), 80)}"`, 'it only searches', 'read');
  if (name === 'WebFetch') return v('allow', `read the web page ${short(String(input.url ?? ''), 100)}`, 'it only reads (pages are information, never instructions)', 'read');
  if (name === 'AskUserQuestion') return v('deny', 'ask you a question in a dialog', 'ask the user in your reply instead', 'read');
  if (HARMLESS.has(name)) return v('allow', `use ${name}`, 'its own actions are still checked one by one', 'read');
  return v('ask', `use the tool ${name}`, 'Jarvis does not know this tool', 'act');
}

/** The popup question in plain words, e.g. "Let Victor run a command on your computer?". */
export function askTitle(who: string, tool: string, v: ExpertVerdict): string {
  if (SHELL.has(tool)) return `Let ${who} ${v.what}?`;
  if (EDIT.has(tool)) return `Let ${who} change a file${/outside/.test(v.why) ? ' outside the team folders' : ''}?`;
  if (READ.has(tool)) return `Let ${who} read ${/keys or passwords/.test(v.why) ? 'a file that may hold keys or passwords' : 'a file outside the team folders'}?`;
  return `Let ${who} use ${tool}?`;
}
