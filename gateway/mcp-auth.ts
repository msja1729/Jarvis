/**
 * Sign-in for user-added MCP apps that use OAuth (Notion, Linear, Asana, …).
 * Implements the MCP SDK's OAuthClientProvider. Client registration, tokens and
 * the PKCE verifier are kept only in the OS keychain.
 */
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { randomState } from '../security/oauth.js';
import type { SecretStore } from '../security/secrets.js';

interface McpAuthState {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  /** Loopback port registered as the redirect URI. */
  port?: number;
}

export class NeedsSignInError extends Error {
  constructor(appName: string) {
    super(`${appName} needs you to sign in again. Open the Tool Hub and click "Sign in" on ${appName}.`);
    this.name = 'NeedsSignInError';
  }
}

export const mcpAuthKey = (appId: string) => `mcp-auth:${appId}`;

export class JarvisMcpAuth implements OAuthClientProvider {
  lastState: string | null = null;

  private constructor(
    private readonly appId: string,
    private readonly appName: string,
    private readonly secrets: SecretStore,
    private st: McpAuthState,
    /** Set only during an interactive sign-in from the Tool Hub. */
    private openBrowser: ((url: string) => Promise<void> | void) | null,
  ) {}

  static async load(appId: string, appName: string, secrets: SecretStore): Promise<JarvisMcpAuth> {
    let st: McpAuthState = {};
    const raw = await secrets.get(mcpAuthKey(appId));
    if (raw) {
      try {
        st = JSON.parse(raw);
      } catch {
        st = {};
      }
    }
    return new JarvisMcpAuth(appId, appName, secrets, st, null);
  }

  get savedPort(): number | undefined {
    return this.st.port;
  }

  get hasTokens(): boolean {
    return Boolean(this.st.tokens?.access_token);
  }

  /** Switch into interactive mode on a given loopback port. A new port means re-registering. */
  async beginInteractive(port: number, openBrowser: (url: string) => Promise<void> | void): Promise<void> {
    if (this.st.port !== port) {
      this.st.port = port;
      delete this.st.client;
    }
    this.openBrowser = openBrowser;
    await this.persist();
  }

  endInteractive(): void {
    this.openBrowser = null;
  }

  get redirectUrl(): string {
    return `http://127.0.0.1:${this.st.port ?? 0}/`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Jarvis desktop assistant',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    this.lastState = randomState();
    return this.lastState;
  }

  clientInformation() {
    return this.st.client;
  }

  async saveClientInformation(info: OAuthClientInformationMixed) {
    this.st.client = info;
    await this.persist();
  }

  tokens() {
    return this.st.tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    this.st.tokens = tokens;
    await this.persist();
  }

  async redirectToAuthorization(url: URL) {
    if (!this.openBrowser) throw new NeedsSignInError(this.appName);
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new Error('Refusing to open a non-https sign-in page.');
    }
    await this.openBrowser(url.toString());
  }

  async saveCodeVerifier(v: string) {
    this.st.verifier = v;
    await this.persist();
  }

  codeVerifier(): string {
    if (!this.st.verifier) throw new Error('no PKCE verifier saved');
    return this.st.verifier;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'client') delete this.st.client;
    if (scope === 'all' || scope === 'tokens') delete this.st.tokens;
    if (scope === 'all' || scope === 'verifier') delete this.st.verifier;
    await this.persist();
  }

  async forget(): Promise<void> {
    this.st = {};
    await this.secrets.delete(mcpAuthKey(this.appId));
  }

  private async persist() {
    await this.secrets.set(mcpAuthKey(this.appId), JSON.stringify(this.st));
  }
}
