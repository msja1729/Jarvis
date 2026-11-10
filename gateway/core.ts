/**
 * GatewayCore: the only place tools are listed and executed (SPEC 6.3, section 7).
 *
 *   on tool call (app, ability, input):
 *     setting = settings[app][ability]
 *     OFF  -> "blocked: <ability> is off for <app>"
 *     ASK  -> popup; No -> "user declined"
 *     forward, log, return trim(result)
 */
import { ActivityLog } from './activity-log.js';
import { SettingsStore, groupOf } from './settings.js';
import { MAX_RESULT_CHARS, capText } from './trim.js';
import { checkAttachment } from './image-guard.js';
import {
  AppDef,
  AppExecutor,
  CallContext,
  ConfirmRequest,
  Confirmer,
  ToolDef,
  ToolResult,
  parseToolName,
  toolName,
} from './types.js';

export interface GatewayDeps {
  /** All known apps (built-in + user-added). Called fresh on every list/call. */
  apps: () => AppDef[];
  settings: SettingsStore;
  executors: (appId: string) => AppExecutor | undefined;
  confirm: Confirmer;
  log: ActivityLog;
  /**
   * False when an app is switched on but cannot work yet (e.g. its account is not
   * signed in). Its tools are then left out of the list Claude sees (T4).
   */
  available?: (app: AppDef) => boolean;
  /** Optional hook for live progress ("Reading Gmail…"). */
  onProgress?: (label: string) => void;
}

export class GatewayCore {
  constructor(private readonly deps: GatewayDeps) {}

  private sortedApps(): AppDef[] {
    return [...this.deps.apps()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** T4 + T10: only usable tools, in a stable order with fixed text. */
  /** @param allow only these apps (a team role's apps); all when not given. */
  listTools(allow?: (app: AppDef) => boolean): ToolDef[] {
    const out: ToolDef[] = [];
    for (const app of this.sortedApps()) {
      if (allow && !allow(app)) continue;
      for (const ability of app.abilities) {
        if (this.deps.settings.effective(app, ability) === 'off') continue;
        if (this.deps.available && !this.deps.available(app)) continue;
        out.push({
          name: toolName(app.id, ability.name),
          description: ability.description,
          inputSchema: ability.inputSchema,
        });
      }
    }
    return out;
  }

  async callTool(name: string, input: Record<string, unknown> = {}, allow?: (app: AppDef) => boolean, ctx: CallContext = { role: 'jarvis' }): Promise<ToolResult> {
    const role = ctx.role || 'jarvis';
    const parsed = parseToolName(name);
    const app = parsed && this.deps.apps().find((a) => a.id === parsed.appId);
    const ability = app?.abilities.find((a) => a.name === parsed!.ability);
    if (!parsed || !app || !ability) {
      return { text: `unknown tool: ${name}`, isError: true };
    }
    if (allow && !allow(app)) {
      // a team role may only use its own apps; another role can be asked through the team tool
      return { text: `blocked: ${app.name} belongs to another member of the team. Ask them with the team tool instead.`, isError: true };
    }

    const setting = this.deps.settings.effective(app, ability);
    if (setting === 'off') {
      const reason = this.deps.settings.isEnabled(app)
        ? `blocked: "${ability.title}" is off for ${app.name}. The user can turn it on in the Tool Hub.`
        : `blocked: ${app.name} is turned off. The user can turn it on in the Tool Hub.`;
      this.deps.log.add({ role, appId: app.id, ability: ability.name, outcome: 'blocked', detail: 'setting is off' });
      return { text: reason, isError: true };
    }

    if (this.deps.available && !this.deps.available(app)) {
      this.deps.log.add({ role, appId: app.id, ability: ability.name, outcome: 'blocked', detail: 'not connected' });
      return { text: `${app.name} is not connected. The user can connect it in the Tool Hub.`, isError: true };
    }

    if (setting === 'ask') {
      const req: ConfirmRequest = {
        appId: app.id,
        appName: app.name,
        ability: ability.name,
        abilityTitle: ability.title,
        group: groupOf(ability),
        input,
        summary: describe(app, ability.title, input),
      };
      let yes = false;
      try {
        yes = await this.deps.confirm(req);
      } catch {
        yes = false;
      }
      if (!yes) {
        this.deps.log.add({ role, appId: app.id, ability: ability.name, outcome: 'declined', detail: 'user clicked No' });
        return { text: 'user declined', isError: true };
      }
    }

    const executor = this.deps.executors(app.id);
    if (!executor) {
      return { text: `${app.name} is not connected. Connect it in the Tool Hub.`, isError: true };
    }

    this.deps.onProgress?.(ability.progress ?? `${ability.title} (${app.name})`);
    try {
      const raw = await executor.call(ability.name, input, { ...ctx, role });
      for (const att of raw.images ?? []) {
        const problem = checkAttachment(att);
        if (problem) throw new Error(`Gateway refused result: ${problem}`);
      }
      this.deps.log.add({
        role,
        appId: app.id,
        ability: ability.name,
        outcome: 'done',
        detail: setting === 'ask' ? 'confirmed by user' : 'allowed',
      });
      const limit = app.kind === 'builtin' && ability.resultLimit ? ability.resultLimit : MAX_RESULT_CHARS;
      return { text: capText(raw.text, limit), isError: false, images: raw.images };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.log.add({ role, appId: app.id, ability: ability.name, outcome: 'error', detail: capText(msg, 300) });
      return { text: `error: ${capText(msg, 500)}`, isError: true };
    }
  }
}

function describe(app: AppDef, title: string, input: Record<string, unknown>): string {
  const lines = Object.entries(input).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return `${app.name}: ${title}\n${lines.join('\n')}`;
}
