/** Coding supervisor tools for Jarvis's own brain: start, steer, answer, check, stop. */
import type { AppExecutor, RawResult } from '../../gateway/types.js';
import type { Supervisor } from '../../supervisor/supervisor.js';

export interface CodingDeps {
  supervisor: Supervisor;
  /** Folder picker (the user's go-ahead). Null if cancelled. */
  pickFolder(task: string): Promise<string | null>;
}

export class CodingExecutor implements AppExecutor {
  constructor(private readonly deps: CodingDeps) {}

  async call(ability: string, input: Record<string, unknown>): Promise<RawResult> {
    const sup = this.deps.supervisor;
    const text = typeof input.text === 'string' ? input.text.trim().slice(0, 4000) : '';
    switch (ability) {
      case 'start': {
        const task = typeof input.task === 'string' ? input.task.trim().slice(0, 4000) : '';
        if (!task) throw new Error('Say what Claude should build or fix.');
        if (sup.active) throw new Error(`A coding task is already running. ${sup.status()}`);
        const folder = await this.deps.pickFolder(task);
        if (!folder) throw new Error('The user cancelled choosing the project folder.');
        return { text: `${sup.start(task, folder, { teamDecides: input.team_decides === true })} Tell the user in one short sentence; do not wait for it to finish.` };
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
