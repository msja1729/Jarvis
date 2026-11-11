/**
 * OAuth 2.0 for desktop apps: authorization code + PKCE (S256) with a loopback
 * redirect (RFC 8252). Used for Google and Microsoft sign-in and for remote MCP apps.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64url(crypto.randomBytes(24));
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

const DONE_PAGE = (ok: boolean, msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>Jarvis</title>` +
  `<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0">` +
  `<div style="text-align:center"><h2>${ok ? 'You are signed in' : 'Sign-in did not finish'}</h2><p>${msg}</p></div>`;

export interface Loopback {
  port: number;
  /** Resolves with the code once the browser comes back with the matching state. */
  waitForCode(state: string, signal?: AbortSignal): Promise<string>;
  close(): Promise<void>;
}

export const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Listens on 127.0.0.1 (and ::1 when available, because browsers may resolve
 * "localhost" to either). Accepts the redirect on any path.
 */
export async function startLoopback(port = 0, timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<Loopback> {
  type Waiter = { state: string; resolve: (c: string) => void; reject: (e: Error) => void };
  let waiter: Waiter | null = null;
  const early: URLSearchParams[] = [];

  const handler: http.RequestListener = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const q = url.searchParams;
    if (!q.has('code') && !q.has('error')) {
      res.writeHead(404).end();
      return;
    }
    if (!waiter) {
      early.push(q);
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(DONE_PAGE(true, 'You can close this tab and go back to Jarvis.'));
      return;
    }
    const ok = settle(waiter, q);
    res
      .writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html' })
      .end(DONE_PAGE(ok, ok ? 'You can close this tab and go back to Jarvis.' : 'Go back to Jarvis and try again.'));
  };

  const settle = (w: Waiter, q: URLSearchParams): boolean => {
    if (q.get('state') !== w.state) {
      w.reject(new OAuthError('Sign-in reply did not match this request (state mismatch).', 'state_mismatch'));
      return false;
    }
    const err = q.get('error');
    if (err) {
      w.reject(new OAuthError(err === 'access_denied' ? 'You cancelled the sign-in.' : `Sign-in failed: ${err}`, err));
      return false;
    }
    w.resolve(q.get('code')!);
    return true;
  };

  const v4 = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    v4.once('error', reject);
    v4.listen(port, '127.0.0.1', resolve);
  });
  const actual = (v4.address() as AddressInfo).port;
  const v6 = http.createServer(handler);
  await new Promise<void>((resolve) => {
    v6.once('error', () => resolve()); // no IPv6 loopback: fine
    v6.listen(actual, '::1', resolve);
  });

  return {
    port: actual,
    waitForCode(state, signal) {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new OAuthError('Sign-in timed out. Please try again.', 'timeout')), timeoutMs);
        const done = <T>(f: (x: T) => void) => (x: T) => {
          clearTimeout(timer);
          waiter = null;
          f(x);
        };
        waiter = { state, resolve: done(resolve), reject: done(reject) };
        signal?.addEventListener('abort', () => waiter?.reject(new OAuthError('Sign-in cancelled.', 'cancelled')), { once: true });
        const q = early.shift();
        if (q) settle(waiter, q);
      });
    },
    close: async () => {
      await Promise.all([v4, v6].map((s) => new Promise<void>((r) => (s.listening ? s.close(() => r()) : r()))));
    },
  };
}

export interface OAuthProviderConfig {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Host used in the redirect URI ("127.0.0.1" for Google, "localhost" for Microsoft). */
  redirectHost: string;
  extraAuthParams?: Record<string, string>;
  revokeUrl?: string;
  /** Some providers only accept the exact redirect registered by the user: a fixed port and path. */
  redirectPort?: number;
  redirectPath?: string;
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret?: string;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

async function tokenRequest(
  provider: OAuthProviderConfig,
  client: OAuthClientConfig,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenSet> {
  const body = new URLSearchParams({ client_id: client.clientId, ...params });
  if (client.clientSecret) body.set('client_secret', client.clientSecret);
  const res = await fetchImpl(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as TokenSet & { error?: string; error_description?: string };
  if (!res.ok || json.error) {
    throw new OAuthError(json.error_description || json.error || `token endpoint returned ${res.status}`, json.error);
  }
  return json;
}

export function buildAuthUrl(
  provider: OAuthProviderConfig,
  client: OAuthClientConfig,
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const u = new URL(provider.authUrl);
  u.search = new URLSearchParams({
    client_id: client.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: provider.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...provider.extraAuthParams,
  }).toString();
  return u.toString();
}

export interface SignInDeps {
  openBrowser: (url: string) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Full interactive sign-in. Returns tokens; the caller stores them in the keychain. */
export async function signIn(provider: OAuthProviderConfig, client: OAuthClientConfig, deps: SignInDeps): Promise<TokenSet> {
  const loop = await startLoopback(provider.redirectPort ?? 0, deps.timeoutMs);
  try {
    const redirectUri = `http://${provider.redirectHost}:${loop.port}${provider.redirectPath ?? ''}`;
    const { verifier, challenge } = createPkce();
    const state = randomState();
    const codePromise = loop.waitForCode(state, deps.signal);
    await deps.openBrowser(buildAuthUrl(provider, client, redirectUri, state, challenge));
    const code = await codePromise;
    return await tokenRequest(
      provider,
      client,
      { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier },
      deps.fetchImpl ?? fetch,
    );
  } finally {
    await loop.close();
  }
}

export function refreshTokens(
  provider: OAuthProviderConfig,
  client: OAuthClientConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenSet> {
  return tokenRequest(
    provider,
    client,
    { grant_type: 'refresh_token', refresh_token: refreshToken, ...(provider.id === 'microsoft' ? { scope: provider.scopes.join(' ') } : {}) },
    fetchImpl,
  );
}
