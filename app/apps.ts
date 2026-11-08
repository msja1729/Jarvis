/** Known apps, how each one connects, and their executors. */
import type { AppDef, AppExecutor } from '../gateway/types.js';
import { SettingsStore } from '../gateway/settings.js';
import { ConnectOptions, McpProxyExecutor } from '../gateway/mcp-proxy.js';
import { JarvisMcpAuth } from '../gateway/mcp-auth.js';
import { AccountManager, APP_ACCOUNT } from '../security/accounts.js';
import { SecretStore, secretKeyForApp } from '../security/secrets.js';
import { GMAIL_APP } from '../tools/email/definition.js';
import { GmailExecutor } from '../tools/email/gmail.js';
import { OUTLOOK_APP } from '../tools/email/outlook-definition.js';
import { OutlookMailExecutor } from '../tools/email/outlook.js';
import { GCAL_APP } from '../tools/calendar/definition.js';
import { GoogleCalendarExecutor } from '../tools/calendar/google.js';
import { OUTLOOK_CAL_APP } from '../tools/calendar/outlook-definition.js';
import { OutlookCalendarExecutor } from '../tools/calendar/outlook.js';
import { SCREEN_APP } from '../tools/screen/definition.js';
import { WHITEBOARD_APP } from '../tools/whiteboard/definition.js';
import { RECORDER_APP } from '../tools/recorder/definition.js';
import { LESSON_APP } from '../tools/lesson/definition.js';
import { DOCUMENTS_APP } from '../tools/documents/definition.js';

/** Built-in apps shown in the Tool Hub. They stay off until their account is connected. */
export const BUILTIN_APPS: AppDef[] = [GMAIL_APP, GCAL_APP, OUTLOOK_APP, OUTLOOK_CAL_APP, LESSON_APP, DOCUMENTS_APP, SCREEN_APP, WHITEBOARD_APP, RECORDER_APP];

export class AppCatalog {
  private proxies = new Map<string, McpProxyExecutor>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: SecretStore,
    readonly accounts: AccountManager,
    /** Executors for local built-in tools (screen, whiteboard) that need Electron. */
    private readonly local: Record<string, AppExecutor> = {},
  ) {}

  all(): AppDef[] {
    return [...BUILTIN_APPS, ...this.settings.snapshot().customApps];
  }

  find(id: string): AppDef | undefined {
    return this.all().find((a) => a.id === id);
  }

  /** How a stored MCP app authenticates during normal (non-interactive) use. */
  async mcpOptions(app: AppDef): Promise<ConnectOptions> {
    const auth = app.mcp?.auth ?? 'key';
    if (auth === 'oauth') return { auth: await JarvisMcpAuth.load(app.id, app.name, this.secrets) };
    if (auth === 'key') return { secret: await this.secrets.get(secretKeyForApp(app.id)) };
    return {};
  }

  executor(appId: string): AppExecutor | undefined {
    if (this.local[appId]) return this.local[appId];
    const account = APP_ACCOUNT[appId];
    if (account) {
      const token = () => this.accounts.getAccessToken(account);
      if (appId === GMAIL_APP.id) return new GmailExecutor(token);
      if (appId === GCAL_APP.id) return new GoogleCalendarExecutor(token);
      if (appId === OUTLOOK_APP.id) return new OutlookMailExecutor(token);
      if (appId === OUTLOOK_CAL_APP.id) return new OutlookCalendarExecutor(token);
    }
    const app = this.find(appId);
    if (app?.kind !== 'mcp') return undefined;
    let proxy = this.proxies.get(appId);
    if (!proxy) {
      proxy = new McpProxyExecutor(app, () => this.mcpOptions(app));
      this.proxies.set(appId, proxy);
    }
    return proxy;
  }

  /** Drop cached connections, e.g. after an app is removed or signs in again. */
  async forget(appId: string): Promise<void> {
    await this.proxies.get(appId)?.close();
    this.proxies.delete(appId);
  }

  async isConnected(app: AppDef): Promise<boolean> {
    const account = APP_ACCOUNT[app.id];
    if (account) return this.accounts.isConnected(account);
    if (app.mcp?.auth === 'oauth') return (await JarvisMcpAuth.load(app.id, app.name, this.secrets)).hasTokens;
    return true;
  }

  /** Sync check used for the tool list: built-in apps need their account signed in. */
  available(app: AppDef): boolean {
    const account = APP_ACCOUNT[app.id];
    return account ? this.accounts.knownConnected(account) : true;
  }

  progressFor(tool: string): string | undefined {
    const [appId, ability] = tool.split('__');
    return this.find(appId)?.abilities.find((a) => a.name === ability)?.progress;
  }
}
