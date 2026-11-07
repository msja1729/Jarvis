/**
 * Fake OAuth identity provider + OAuth-protected MCP server, and a fake "browser"
 * that follows the sign-in redirect back to Jarvis's loopback listener.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export interface FakeIdp {
  base: string;
  /** Long tokens exercise keychain chunking. */
  refreshToken: string;
  accessTokens: string[];
  tokenCalls: { grant_type: string; client_id?: string; client_secret?: string; refresh_token?: string }[];
  revoked: string[];
  authorizeParams: URLSearchParams[];
  /** What the next /authorize does. */
  mode: { kind: 'ok' } | { kind: 'deny' } | { kind: 'badState' };
  failRefresh: boolean;
  /** Valid bearer for the MCP endpoint (rotates on refresh). */
  validMcpToken: string | null;
  close(): Promise<void>;
}

export async function startFakeIdp(): Promise<FakeIdp> {
  const codes = new Map<string, { challenge: string; redirect: string }>();
  let n = 0;
  const idp = {
    refreshToken: 'rt-' + 'R'.repeat(3000),
    accessTokens: [] as string[],
    tokenCalls: [] as FakeIdp['tokenCalls'],
    revoked: [] as string[],
    authorizeParams: [] as URLSearchParams[],
    mode: { kind: 'ok' } as FakeIdp['mode'],
    failRefresh: false,
    validMcpToken: null as string | null,
  } as FakeIdp;

  const issue = () => {
    const at = `at-${++n}-` + 'A'.repeat(1500);
    idp.accessTokens.push(at);
    idp.validMcpToken = at;
    return at;
  };

  const readBody = (req: http.IncomingMessage) =>
    new Promise<string>((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolve(b));
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, idp.base);
    const json = (code: number, o: unknown, headers: Record<string, string> = {}) =>
      res.writeHead(code, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(o));

    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return json(200, { resource: `${idp.base}/mcp`, authorization_servers: [idp.base] });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(200, {
        issuer: idp.base,
        authorization_endpoint: `${idp.base}/authorize`,
        token_endpoint: `${idp.base}/token`,
        registration_endpoint: `${idp.base}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }
    if (url.pathname === '/register' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      return json(201, { ...body, client_id: 'registered-client', client_id_issued_at: Math.floor(Date.now() / 1000) });
    }
    if (url.pathname === '/authorize') {
      const q = url.searchParams;
      idp.authorizeParams.push(q);
      const redirect = new URL(q.get('redirect_uri')!);
      if (idp.mode.kind === 'deny') {
        redirect.search = new URLSearchParams({ error: 'access_denied', state: q.get('state') ?? '' }).toString();
      } else {
        const code = crypto.randomBytes(8).toString('hex');
        codes.set(code, { challenge: q.get('code_challenge')!, redirect: q.get('redirect_uri')! });
        const state = idp.mode.kind === 'badState' ? 'forged' : (q.get('state') ?? '');
        redirect.search = new URLSearchParams({ code, state }).toString();
      }
      return res.writeHead(302, { Location: redirect.toString() }).end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const f = new URLSearchParams(await readBody(req));
      idp.tokenCalls.push({
        grant_type: f.get('grant_type')!,
        client_id: f.get('client_id') ?? undefined,
        client_secret: f.get('client_secret') ?? undefined,
        refresh_token: f.get('refresh_token') ?? undefined,
      });
      if (f.get('grant_type') === 'authorization_code') {
        const c = codes.get(f.get('code')!);
        const verifierHash = b64url(crypto.createHash('sha256').update(f.get('code_verifier') ?? '').digest());
        if (!c || c.challenge !== verifierHash || c.redirect !== f.get('redirect_uri')) {
          return json(400, { error: 'invalid_grant', error_description: 'bad code or PKCE' });
        }
        codes.delete(f.get('code')!);
        return json(200, { access_token: issue(), refresh_token: idp.refreshToken, expires_in: 3600, token_type: 'Bearer' });
      }
      if (f.get('grant_type') === 'refresh_token') {
        if (idp.failRefresh || f.get('refresh_token') !== idp.refreshToken) {
          return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        }
        idp.refreshToken = 'rt2-' + 'S'.repeat(3000); // rotation, like Microsoft
        return json(200, { access_token: issue(), refresh_token: idp.refreshToken, expires_in: 3600, token_type: 'Bearer' });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    if (url.pathname === '/revoke') {
      idp.revoked.push(new URLSearchParams(await readBody(req)).get('token') ?? '');
      return json(200, {});
    }
    if (url.pathname === '/profile') {
      return json(200, { emailAddress: 'me@example.com' });
    }
    if (url.pathname === '/mcp') {
      const auth = req.headers.authorization ?? '';
      if (!idp.validMcpToken || auth !== `Bearer ${idp.validMcpToken}`) {
        return json(401, { error: 'invalid_token' }, {
          'WWW-Authenticate': `Bearer resource_metadata="${idp.base}/.well-known/oauth-protected-resource/mcp"`,
        });
      }
      const mcp = new Server({ name: 'fake-protected', version: '1' }, { capabilities: { tools: {} } });
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{ name: 'search', description: 'Search things. Long description.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
      }));
      mcp.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'found 3 things' }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp.connect(transport);
      res.on('close', () => void transport.close());
      return transport.handleRequest(req, res);
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  idp.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  idp.close = () =>
    new Promise((r) => {
      server.closeAllConnections();
      server.close(() => r());
    });
  return idp;
}

/** Plays the user's browser: follows /authorize, then delivers the redirect to the loopback. */
export function fakeBrowser(opened: string[] = []) {
  return async (url: string) => {
    opened.push(url);
    const r = await fetch(url, { redirect: 'manual' });
    const loc = r.headers.get('location');
    if (!loc) throw new Error('authorize did not redirect');
    // localhost → 127.0.0.1 so the test does not depend on name resolution.
    void fetch(loc.replace('://localhost:', '://127.0.0.1:')).catch(() => undefined);
  };
}
