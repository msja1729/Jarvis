/**
 * Google and Microsoft accounts. One sign-in per account covers its mail and calendar.
 * Refresh tokens live only in the OS keychain; access tokens only in memory.
 */
import { OAuthClientConfig, OAuthError, OAuthProviderConfig, refreshTokens, signIn, TokenSet } from './oauth.js';
import type { SecretStore } from './secrets.js';

export type AccountId = 'google' | 'microsoft';

export const PROVIDERS: Record<AccountId, OAuthProviderConfig & { profileUrl: string; consoleUrl: string }> = {
  google: {
    id: 'google',
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    // gmail.modify: read, draft, send drafts, trash (no permanent delete). calendar.events: read/write events.
    scopes: ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/calendar.events'],
    redirectHost: '127.0.0.1',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    profileUrl: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  microsoft: {
    id: 'microsoft',
    name: 'Microsoft',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send', 'Calendars.ReadWrite'],
    redirectHost: 'localhost',
    extraAuthParams: { prompt: 'select_account' },
    profileUrl: 'https://graph.microsoft.com/v1.0/me',
    consoleUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  },
};

/** Which account each built-in app signs in with. */
export const APP_ACCOUNT: Record<string, AccountId> = {
  gmail: 'google',
  gcal: 'google',
  outlook: 'microsoft',
  outlookcal: 'microsoft',
};

interface StoredAccount {
  refresh_token: string;
  email: string | null;
  connectedAt: string;
}

export interface AccountStatus {
  id: AccountId;
  name: string;
  configured: boolean;
  connected: boolean;
  email: string | null;
  needsSecret: boolean;
}

export class NotConnectedError extends Error {
  constructor(account: AccountId, why = 'is not connected') {
    super(`Your ${PROVIDERS[account].name} account ${why}. Connect it in the Tool Hub.`);
    this.name = 'NotConnectedError';
  }
}

const accountKey = (id: AccountId) => `account:${id}`;
const clientSecretKey = (id: AccountId) => `oauth-client-secret:${id}`;
const SKEW_MS = 60_000;

export interface AccountDeps {
  secrets: SecretStore;
  /** Client IDs are not secret and live in settings.json. */
  clientId: (id: AccountId) => string | null;
  openBrowser: (url: string) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Test hook: override provider endpoints. */
  providers?: Partial<Record<AccountId, OAuthProviderConfig & { profileUrl: string }>>;
}

export class AccountManager {
  private cache = new Map<AccountId, { token: string; expiresAt: number }>();
  private inflight = new Map<AccountId, Promise<string>>();
  /** In-memory mirror of which accounts have a stored sign-in (for the sync tool list). */
  private connectedSet = new Set<AccountId>();

  constructor(private readonly deps: AccountDeps) {}

  private provider(id: AccountId) {
    return this.deps.providers?.[id] ?? PROVIDERS[id];
  }

  private get fetchImpl() {
    return this.deps.fetchImpl ?? fetch;
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  async client(id: AccountId): Promise<OAuthClientConfig | null> {
    const clientId = this.deps.clientId(id);
    if (!clientId) return null;
    const clientSecret = (await this.deps.secrets.get(clientSecretKey(id))) ?? undefined;
    return { clientId, clientSecret };
  }

  /** Google desktop clients need their (non-confidential) secret; Microsoft public clients do not. */
  async setClientSecret(id: AccountId, secret: string | null): Promise<void> {
    if (secret) await this.deps.secrets.set(clientSecretKey(id), secret);
    else await this.deps.secrets.delete(clientSecretKey(id));
  }

  private async stored(id: AccountId): Promise<StoredAccount | null> {
    const raw = await this.deps.secrets.get(accountKey(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredAccount;
    } catch {
      return null;
    }
  }

  async status(id: AccountId): Promise<AccountStatus> {
    const client = await this.client(id);
    const s = await this.stored(id);
    return {
      id,
      name: PROVIDERS[id].name,
      configured: Boolean(client && (id !== 'google' || client.clientSecret)),
      connected: s !== null,
      email: s?.email ?? null,
      needsSecret: id === 'google',
    };
  }

  async isConnected(id: AccountId): Promise<boolean> {
    return (await this.stored(id)) !== null;
  }

  /** Load the connected-account mirror once at startup. */
  async init(): Promise<void> {
    for (const id of Object.keys(PROVIDERS) as AccountId[]) {
      if (await this.isConnected(id)) this.connectedSet.add(id);
    }
  }

  knownConnected(id: AccountId): boolean {
    return this.connectedSet.has(id);
  }

  async connect(id: AccountId, signal?: AbortSignal): Promise<AccountStatus> {
    const client = await this.client(id);
    if (!client) throw new Error(`Set up ${PROVIDERS[id].name} sign-in first (client ID).`);
    const tokens = await signIn(this.provider(id), client, { openBrowser: this.deps.openBrowser, fetchImpl: this.fetchImpl, signal });
    if (!tokens.refresh_token) {
      throw new OAuthError(`${PROVIDERS[id].name} did not grant offline access. Please try again.`);
    }
    this.remember(id, tokens);
    const email = await this.lookupEmail(id, tokens.access_token).catch(() => null);
    await this.save(id, { refresh_token: tokens.refresh_token, email, connectedAt: new Date(this.now()).toISOString() });
    this.connectedSet.add(id);
    return this.status(id);
  }

  async disconnect(id: AccountId): Promise<void> {
    const s = await this.stored(id);
    const revoke = this.provider(id).revokeUrl;
    if (s && revoke) {
      await this.fetchImpl(revoke, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: s.refresh_token }),
      }).catch(() => undefined);
    }
    this.cache.delete(id);
    this.connectedSet.delete(id);
    await this.deps.secrets.delete(accountKey(id));
  }

  /** Valid access token, refreshing when needed. Concurrent callers share one refresh. */
  async getAccessToken(id: AccountId): Promise<string> {
    const hit = this.cache.get(id);
    if (hit && hit.expiresAt - SKEW_MS > this.now()) return hit.token;
    let p = this.inflight.get(id);
    if (!p) {
      p = this.refresh(id).finally(() => this.inflight.delete(id));
      this.inflight.set(id, p);
    }
    return p;
  }

  private async refresh(id: AccountId): Promise<string> {
    const s = await this.stored(id);
    if (!s) throw new NotConnectedError(id);
    const client = await this.client(id);
    if (!client) throw new NotConnectedError(id, 'sign-in is not set up');
    let tokens: TokenSet;
    try {
      tokens = await refreshTokens(this.provider(id), client, s.refresh_token, this.fetchImpl);
    } catch (err) {
      if (err instanceof OAuthError && (err.code === 'invalid_grant' || err.code === 'unauthorized_client')) {
        await this.deps.secrets.delete(accountKey(id));
        this.cache.delete(id);
        this.connectedSet.delete(id);
        throw new NotConnectedError(id, 'sign-in has expired');
      }
      throw err;
    }
    this.remember(id, tokens);
    // Microsoft rotates refresh tokens; keep the newest.
    if (tokens.refresh_token && tokens.refresh_token !== s.refresh_token) {
      await this.save(id, { ...s, refresh_token: tokens.refresh_token });
    }
    return tokens.access_token;
  }

  private remember(id: AccountId, t: TokenSet) {
    this.cache.set(id, { token: t.access_token, expiresAt: this.now() + (t.expires_in ?? 3600) * 1000 });
  }

  private async save(id: AccountId, s: StoredAccount) {
    await this.deps.secrets.set(accountKey(id), JSON.stringify(s));
  }

  private async lookupEmail(id: AccountId, token: string): Promise<string | null> {
    const res = await this.fetchImpl(this.provider(id).profileUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as { emailAddress?: string; mail?: string; userPrincipalName?: string; email?: string; display_name?: string };
    return j.emailAddress ?? j.mail ?? j.userPrincipalName ?? j.email ?? j.display_name ?? null;
  }
}
