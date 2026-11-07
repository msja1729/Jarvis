/** Phase 2: account sign-in, keychain chunking, and sign-in for added MCP apps. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountManager, PROVIDERS } from '../security/accounts.js';
import { ChunkedSecretStore, memoryBackend, MemorySecretStore } from '../security/secrets.js';
import { createPkce, OAuthProviderConfig } from '../security/oauth.js';
import { SettingsStore } from '../gateway/settings.js';
import { discoverApp, McpProxyExecutor } from '../gateway/mcp-proxy.js';
import { JarvisMcpAuth } from '../gateway/mcp-auth.js';
import { FakeIdp, fakeBrowser, startFakeIdp } from './fake-oauth.js';
import { makeCore, tmpDir } from './helpers.js';
import crypto from 'node:crypto';

describe('keychain chunking (Windows 1,280-char limit)', () => {
  it('stores and reads back values far longer than one entry allows', async () => {
    const backend = memoryBackend(1280);
    const store = new ChunkedSecretStore(backend);
    const long = 'x'.repeat(5000) + 'END';
    await store.set('k', long);
    expect(await store.get('k')).toBe(long);
    expect(backend.map.size).toBe(7); // head + 6 chunks
    await store.set('k', 'short');
    expect(await store.get('k')).toBe('short');
    expect(backend.map.size).toBe(1); // old chunks cleaned up
    await store.delete('k');
    expect(backend.map.size).toBe(0);
  });
});

describe('PKCE', () => {
  it('uses S256: challenge = base64url(sha256(verifier))', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });
});

function fakeProvider(idp: FakeIdp, host = '127.0.0.1'): OAuthProviderConfig & { profileUrl: string } {
  return {
    id: 'google',
    name: 'Google',
    authUrl: `${idp.base}/authorize`,
    tokenUrl: `${idp.base}/token`,
    revokeUrl: `${idp.base}/revoke`,
    scopes: PROVIDERS.google.scopes,
    redirectHost: host,
    extraAuthParams: PROVIDERS.google.extraAuthParams,
    profileUrl: `${idp.base}/profile`,
  };
}

describe('Google / Microsoft account sign-in', () => {
  let idp: FakeIdp;
  let now: number;
  let secrets: MemorySecretStore;
  let settings: SettingsStore;
  let dir: string;
  let opened: string[];
  let accounts: AccountManager;

  beforeEach(async () => {
    idp = await startFakeIdp();
    now = Date.now();
    secrets = new MemorySecretStore();
    dir = tmpDir();
    settings = new SettingsStore(path.join(dir, 'settings.json'));
    settings.setOAuthClient('google', 'client-123.apps.googleusercontent.com');
    opened = [];
    accounts = new AccountManager({
      secrets,
      clientId: (id) => settings.oauthClientId(id),
      openBrowser: fakeBrowser(opened),
      now: () => now,
      providers: { google: fakeProvider(idp) },
    });
    await accounts.setClientSecret('google', 'GOCSPX-client-secret');
  });
  afterEach(async () => idp.close());

  it('signs in with PKCE, a loopback redirect, offline access, and the right scopes', async () => {
    const status = await accounts.connect('google');
    expect(status).toMatchObject({ connected: true, email: 'me@example.com' });
    const q = idp.authorizeParams[0];
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('scope')).toContain('gmail.modify');
    expect(q.get('scope')).toContain('calendar.events');
    expect(idp.tokenCalls[0]).toMatchObject({ grant_type: 'authorization_code', client_secret: 'GOCSPX-client-secret' });
    expect(await accounts.getAccessToken('google')).toBe(idp.accessTokens[0]);
  });

  it('rejects a sign-in reply whose state does not match', async () => {
    idp.mode = { kind: 'badState' };
    await expect(accounts.connect('google')).rejects.toThrow(/state mismatch/);
    expect((await accounts.status('google')).connected).toBe(false);
  });

  it('reports a cancelled sign-in in plain words', async () => {
    idp.mode = { kind: 'deny' };
    await expect(accounts.connect('google')).rejects.toThrow('You cancelled the sign-in.');
  });

  it('refreshes expired access tokens once for concurrent callers, and keeps rotated refresh tokens', async () => {
    await accounts.connect('google');
    now += 2 * 3600 * 1000;
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => accounts.getAccessToken('google')));
    expect(new Set([a, b, c]).size).toBe(1);
    expect(idp.tokenCalls.filter((t) => t.grant_type === 'refresh_token')).toHaveLength(1);
    // The rotated refresh token is what gets used next time.
    now += 2 * 3600 * 1000;
    await accounts.getAccessToken('google');
    const refreshes = idp.tokenCalls.filter((t) => t.grant_type === 'refresh_token');
    expect(refreshes[1].refresh_token).toMatch(/^rt2-/);
  });

  it('an expired or revoked sign-in disconnects and tells the user to reconnect', async () => {
    await accounts.connect('google');
    idp.failRefresh = true;
    now += 2 * 3600 * 1000;
    await expect(accounts.getAccessToken('google')).rejects.toThrow('Your Google account sign-in has expired. Connect it in the Tool Hub.');
    expect((await accounts.status('google')).connected).toBe(false);
  });

  it('disconnect revokes the token and removes it from the keychain', async () => {
    await accounts.connect('google');
    await accounts.disconnect('google');
    expect(idp.revoked).toHaveLength(1);
    expect((await accounts.status('google')).connected).toBe(false);
    await expect(accounts.getAccessToken('google')).rejects.toThrow(/not connected/);
  });

  it('C32: tokens and the client secret never reach a file; only the (public) client ID does', async () => {
    await accounts.connect('google');
    now += 2 * 3600 * 1000;
    await accounts.getAccessToken('google');
    const settingsText = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
    expect(settingsText).toContain('client-123.apps.googleusercontent.com');
    for (const f of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(text).not.toContain('RRRRRRRRRR');
      expect(text).not.toContain('SSSSSSSSSS');
      expect(text).not.toContain('AAAAAAAAAA');
      expect(text).not.toContain('GOCSPX-client-secret');
    }
  });

  it('Microsoft uses a "localhost" redirect and no client secret', async () => {
    settings.setOAuthClient('microsoft', 'ms-client-id');
    const ms = new AccountManager({
      secrets,
      clientId: (id) => settings.oauthClientId(id),
      openBrowser: fakeBrowser(opened),
      providers: { microsoft: { ...fakeProvider(idp, 'localhost'), id: 'microsoft', name: 'Microsoft' } },
    });
    await ms.connect('microsoft');
    expect(idp.authorizeParams.at(-1)!.get('redirect_uri')).toMatch(/^http:\/\/localhost:\d+$/);
    expect(idp.tokenCalls.at(-1)!.client_secret).toBeUndefined();
    expect((await ms.status('microsoft')).configured).toBe(true);
  });
});

describe('sign-in for apps added by URL (MCP OAuth)', () => {
  let idp: FakeIdp;
  beforeEach(async () => (idp = await startFakeIdp()));
  afterEach(async () => idp.close());

  it('registers, signs in through the browser, then works in chat without the browser', async () => {
    const secrets = new MemorySecretStore();
    const auth = await JarvisMcpAuth.load('fake', 'Fake App', secrets);
    const opened: string[] = [];
    const def = await discoverApp('fake', 'Fake App', { url: `${idp.base}/mcp`, auth: 'oauth' }, {
      auth,
      interactive: { openBrowser: fakeBrowser(opened) },
    });
    expect(opened).toHaveLength(1);
    expect(def.abilities.map((a) => a.name)).toEqual(['search']);
    expect(def.abilities[0].group).toBe('read');
    expect(auth.hasTokens).toBe(true);

    // Normal use from a chat request: no browser, stored tokens from the keychain.
    const h = makeCore([], {});
    h.settings.addCustomApp(def);
    const proxy = new McpProxyExecutor(def, async () => ({ auth: await JarvisMcpAuth.load('fake', 'Fake App', secrets) }));
    const core = new (await import('../gateway/core.js')).GatewayCore({
      apps: () => [def],
      settings: h.settings,
      executors: () => proxy,
      confirm: async () => false,
      log: h.log,
    });
    const r = await core.callTool('fake__search', {});
    expect(r.isError).toBe(false);
    expect(r.text).toContain('found 3 things');
    await proxy.close();

    // Sign-in revoked on the app's side: the chat gets a clear message, and no browser opens.
    idp.validMcpToken = 'something-else';
    idp.failRefresh = true;
    const proxy2 = new McpProxyExecutor(def, async () => ({ auth: await JarvisMcpAuth.load('fake', 'Fake App', secrets) }));
    const core2 = new (await import('../gateway/core.js')).GatewayCore({
      apps: () => [def],
      settings: h.settings,
      executors: () => proxy2,
      confirm: async () => false,
      log: h.log,
    });
    const r2 = await core2.callTool('fake__search', {});
    expect(r2.isError).toBe(true);
    expect(r2.text).toContain('Fake App needs you to sign in again');
    expect(opened).toHaveLength(1);
    await proxy2.close();
  });
});

describe('C12 (phase 2): apps switched on but not signed in are hidden from Claude', () => {
  it('leaves out their tools and never calls them', async () => {
    const { GatewayCore } = await import('../gateway/core.js');
    const { GMAIL_APP } = await import('../tools/email/definition.js');
    const { SpyExecutor } = await import('./helpers.js');
    const h = makeCore([GMAIL_APP], {});
    h.settings.setEnabled('gmail', true);
    let signedIn = false;
    const spy = new SpyExecutor();
    const core = new GatewayCore({
      apps: () => [GMAIL_APP],
      settings: h.settings,
      executors: () => spy,
      available: () => signedIn,
      confirm: async () => true,
      log: h.log,
    });
    expect(core.listTools()).toEqual([]);
    const r = await core.callTool('gmail__list_emails', {});
    expect(r.text).toContain('Gmail is not connected');
    expect(spy.calls).toHaveLength(0);
    signedIn = true;
    expect(core.listTools().length).toBeGreaterThan(0);
  });
});
