/** Coding supervisor tools for Jarvis's own brain: start, steer, answer, check, stop. */
import fs from 'node:fs';
import path from 'node:path';
import type { AppExecutor, RawResult } from '../../gateway/types.js';
import { shortTask, type Supervisor } from '../../supervisor/supervisor.js';

export interface CodingDeps {
  supervisor: Supervisor;
  /** Ryan's Projects folder (Team/Project Manager/Projects): every new project gets its own folder here. */
  projectsDir(): string;
  /**
   * The popup that asks the user to name a new project. The typed name; null if they cancelled;
   * 'timeout' if nobody answered (then Ryan's suggestion is used, so nothing ever waits for ever).
   */
  askProjectName(suggested: string, task: string, where: string): Promise<string | null | 'timeout'>;
  /** Folder picker, only for a project the user already has somewhere else. Null if cancelled. */
  pickFolder(task: string): Promise<string | null>;
}

/** A name Windows accepts as a folder name ("My app: v2?" → "My app v2"). */
export function folderName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .replace(/^(con|prn|aux|nul|com\d|lpt\d)$/i, '$1 project')
    .slice(0, 60)
    .trim();
}

/** A first suggestion from the task ("Build a study planner app for students" → "Study planner app"). */
export function nameFromTask(task: string): string {
  const words = task
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (words.length && /^(please|build|make|create|write|develop|start|add|code|a|an|the|new|me|my|v\d+)$/i.test(words[0])) words.shift();
  const stop = words.findIndex((w, i) => i > 0 && /^(for|with|that|which|in|using|to|so|and)$/i.test(w));
  const name = folderName(words.slice(0, stop > 0 ? Math.min(stop, 5) : 4).join(' '));
  return name ? name[0].toUpperCase() + name.slice(1) : 'New project';
}

export class CodingExecutor implements AppExecutor {
  constructor(private readonly deps: CodingDeps) {}

  /** Where the project lives: Ryan's Projects/<name> (named by the user), or a folder the user already has. */
  private async folderFor(task: string, input: Record<string, unknown>): Promise<string> {
    if (input.existing_folder === true) {
      const picked = await this.deps.pickFolder(task);
      if (!picked) throw new Error('The user cancelled choosing the project folder.');
      return picked;
    }
    const root = this.deps.projectsDir();
    const given = folderName(input.project);
    // an existing project (its spec is already there): carry on in it, no question
    if (given && fs.existsSync(path.join(root, given))) return path.join(root, given);
    const suggested = given || nameFromTask(task);
    const answer = await this.deps.askProjectName(suggested, shortTask(task, 80), root);
    if (answer === null) throw new Error('The user cancelled naming the project, so nothing was started. Ask them what to call it.');
    const name = (answer === 'timeout' ? '' : folderName(answer)) || suggested;
    const folder = path.join(root, name);
    fs.mkdirSync(folder, { recursive: true });
    return folder;
  }

  async call(ability: string, input: Record<string, unknown>): Promise<RawResult> {
    const sup = this.deps.supervisor;
    const text = typeof input.text === 'string' ? input.text.trim().slice(0, 4000) : '';
    switch (ability) {
      case 'start': {
        const task = typeof input.task === 'string' ? input.task.trim().slice(0, 4000) : '';
        if (!task) throw new Error('Say what Claude should build or fix.');
        if (sup.active) throw new Error(`A coding task is already running. ${sup.status()}`);
        const folder = await this.folderFor(task, input);
        const where = `The project folder is ${folder}: the spec and every code file belong there.`;
        return { text: `${sup.start(task, folder, { teamDecides: input.team_decides === true })} ${where} Tell the user in one short sentence; do not wait for it to finish.` };
      }
      case 'tell':
        if (!text) throw new Error('Say what to tell Claude.');
        return { text: sup.tell(text) };
      case 'answer': {
        if (!text) throw new Error('Say the answer.');
        const r = sup.answerFromText(`tell claude ${text}`);
        if (r) return { text: r };
        const pending = sup.view()?.pending[0];
        if (!pending) return { text: 'Claude is not waiting for an answer right now.' };
        return { text: `That did not sound like a clear yes or no. ${sup.describe(pending)}` };
      }
      case 'team_decides':
        return { text: sup.setTeamDecides(input.on !== false) };
      case 'status':
        return { text: sup.status() };
      case 'stop':
        return { text: sup.stop() };
      default:
        throw new Error(`unknown coding ability ${ability}`);
    }
  }
}
