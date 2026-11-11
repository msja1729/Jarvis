/** Team: one role asks another (one hop: the one asked cannot ask anyone else). */
import type { AppExecutor, RawResult } from '../../gateway/types.js';
import { isRole, roleById, RoleId } from '../../roles/roles.js';

export interface TeamDeps {
  /** Runs the question as that role, without the team tool. Returns its answer. */
  consult(role: RoleId, question: string): Promise<{ reply: string; isError: boolean; name?: string }>;
  /** Shown while waiting, e.g. "Asking the Doctor…". */
  onAsk?(role: RoleId): void;
}

export class TeamExecutor implements AppExecutor {
  constructor(private readonly deps: TeamDeps) {}

  async call(ability: string, input: Record<string, unknown>): Promise<RawResult> {
    if (ability !== 'ask') throw new Error(`unknown team ability ${ability}`);
    const role = input.role;
    const question = typeof input.question === 'string' ? input.question.trim().slice(0, 4000) : '';
    if (!isRole(role) || role === 'jarvis') throw new Error('Pick a teammate: pa, pm, doctor or finance.');
    if (!question) throw new Error('Say what to ask.');
    this.deps.onAsk?.(role);
    const r = await this.deps.consult(role, question);
    const name = r.name ?? roleById(role).name;
    if (r.isError) throw new Error(`${name} could not answer: ${r.reply.slice(0, 300)}`);
    return { text: `${name} says: ${r.reply}` };
  }
}
