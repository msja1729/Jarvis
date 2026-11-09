/** Reminders and the project board, for the PA and the Project Manager. */
import type { AppExecutor, RawResult } from '../../gateway/types.js';
import { BoardStore, ReminderStore } from '../../supervisor/reminders.js';

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export class RemindersExecutor implements AppExecutor {
  constructor(
    private readonly store: ReminderStore,
    private readonly onChange: () => void = () => undefined,
  ) {}

  async call(ability: string, input: Record<string, unknown>): Promise<RawResult> {
    if (ability === 'add') {
      const r = this.store.add(str(input.text) ?? '', str(input.at) ?? '');
      this.onChange();
      return { text: `Reminder set (id ${r.id}) for ${new Date(r.at).toString().slice(0, 21)}: ${r.text}` };
    }
    if (ability === 'list') {
      const list = this.store.upcoming();
      return { text: list.length ? list.map((r) => `[${r.id}] ${r.at}: ${r.text}`).join('\n') : 'No upcoming reminders.' };
    }
    if (ability === 'cancel') {
      const ok = this.store.cancel(str(input.id) ?? '');
      this.onChange();
      return { text: ok ? 'Reminder cancelled.' : 'No reminder with that id.' };
    }
    throw new Error(`unknown reminders ability ${ability}`);
  }
}

export class BoardExecutor implements AppExecutor {
  constructor(
    private readonly store: BoardStore,
    private readonly onChange: () => void = () => undefined,
  ) {}

  async call(ability: string, input: Record<string, unknown>): Promise<RawResult> {
    switch (ability) {
      case 'list':
        return { text: BoardStore.describe(this.store.list({ project: str(input.project), status: str(input.status) })) };
      case 'add': {
        const t = this.store.add({ title: str(input.title) ?? '', project: str(input.project), status: str(input.status), due: str(input.due), notes: str(input.notes) });
        this.onChange();
        return { text: `Added: ${BoardStore.describe([t])}` };
      }
      case 'update': {
        const t = this.store.update(str(input.id) ?? '', { title: str(input.title), project: str(input.project), status: str(input.status), due: str(input.due), notes: str(input.notes) });
        this.onChange();
        return { text: `Updated: ${BoardStore.describe([t])}` };
      }
      case 'remove': {
        const ok = this.store.remove(str(input.id) ?? '');
        this.onChange();
        return { text: ok ? 'Task removed.' : 'No task with that id.' };
      }
      default:
        throw new Error(`unknown board ability ${ability}`);
    }
  }
}
