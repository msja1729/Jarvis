/**
 * Team: one role asks another (one hop: the one asked cannot ask anyone else), or several at the same time.
 * Each one asked answers in a fresh conversation of its own and only reads (see judgeExpert's consult rule),
 * so answers given at the same time never touch the same files or conversation.
 */
import type { AppExecutor, RawResult } from '../../gateway/types.js';
import { isRole, roleById, RoleId } from '../../roles/roles.js';

export interface TeamDeps {
  /** Runs the question as that role, without the team tool. Returns its answer. */
  consult(role: RoleId, question: string): Promise<{ reply: string; isError: boolean; name?: string }>;
  /** Shown while waiting, e.g. "Asking the Doctor…". */
  onAsk?(role: RoleId): void;
}

/** At most this many teammates are asked at once (each answer is a full Claude run). */
export const MAX_AT_ONCE = 3;

export class TeamExecutor implements AppExecutor {
  constructor(private readonly deps: TeamDeps) {}

  async call(ability: string, input: Record<string, unknown>): Promise<RawResult> {
    if (ability === 'ask') {
      const { role, question } = this.read(input);
      this.deps.onAsk?.(role);
      const r = await this.deps.consult(role, question);
      const name = r.name ?? roleById(role).name;
      if (r.isError) throw new Error(`${name} could not answer: ${r.reply.slice(0, 300)}`);
      return { text: `${name} says: ${r.reply}` };
    }
    if (ability === 'ask_several') {
      const list = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : [];
      // one question per teammate: two for the same person are put together (one run each)
      const byRole = new Map<RoleId, string[]>();
      for (const q of list) {
        const { role, question } = this.read(q ?? {});
        byRole.set(role, [...(byRole.get(role) ?? []), question]);
      }
      if (byRole.size === 0) throw new Error('Say who to ask and what.');
      if (byRole.size > MAX_AT_ONCE) throw new Error(`Ask at most ${MAX_AT_ONCE} teammates at once.`);
      const asks = [...byRole].map(([role, qs]) => ({ role, question: qs.length === 1 ? qs[0] : qs.map((q, i) => `${i + 1}. ${q}`).join('\n\n') }));
      for (const a of asks) this.deps.onAsk?.(a.role);
      // all at the same time; one teammate failing does not lose the others' answers
      const answers = await Promise.all(
        asks.map(async (a) => {
          const r = await this.deps.consult(a.role, a.question).catch((err: unknown) => ({ reply: err instanceof Error ? err.message : String(err), isError: true, name: undefined }));
          const name = r.name ?? roleById(a.role).name;
          return r.isError ? `${name} could not answer: ${r.reply.slice(0, 300)}` : `${name} says: ${r.reply}`;
        }),
      );
      return { text: answers.join('\n\n---\n\n') };
    }
    throw new Error(`unknown team ability ${ability}`);
  }

  private read(input: Record<string, unknown>): { role: RoleId; question: string } {
    const role = input.role;
    const question = typeof input.question === 'string' ? input.question.trim().slice(0, 4000) : '';
    if (!isRole(role) || role === 'jarvis') throw new Error('Pick a teammate: pa, pm, doctor or finance.');
    if (!question) throw new Error('Say what to ask.');
    return { role, question };
  }
}
