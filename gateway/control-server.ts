/**
 * Local control server: the bridge between the stdio shim (started by `claude`)
 * and GatewayCore in the Jarvis process. Bound to 127.0.0.1, bearer-token protected.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { GatewayCore } from './core.js';
import type { AppDef } from './types.js';

export interface ControlServer {
  url: string;
  token: string;
  /**
   * A second token for coding sessions. It only opens /sup/approve, so programs that a
   * coding session runs cannot use Jarvis's own tools (email, calendar...) even if they see it.
   */
  supToken: string;
  /** For the Claude Code hook script (sessions the user starts themselves). Only opens /hook. */
  hookToken: string;
  close(): Promise<void>;
}

const MAX_BODY = 1_000_000;

export interface ControlExtras {
  /** Coding supervisor: answers Claude Code's permission prompts (see supervisor/). */
  approve?: (runId: string, req: { tool_name: string; input: Record<string, unknown> }) => Promise<unknown>;
  /** A Claude Code session the user started themselves finished or needs them. */
  hook?: (payload: Record<string, unknown>) => Promise<void> | void;
  /** Team roles: which apps the asking role may use (all when it returns undefined). */
  scope?: (role: string, consult: boolean) => ((app: AppDef) => boolean) | undefined;
}

export async function startControlServer(core: () => GatewayCore, extras: ControlExtras = {}): Promise<ControlServer> {
  const token = crypto.randomBytes(32).toString('hex');
  const supToken = crypto.randomBytes(32).toString('hex');
  const hookToken = crypto.randomBytes(32).toString('hex');
  const expectedHook = Buffer.from(`Bearer ${hookToken}`);
  const expected = Buffer.from(`Bearer ${token}`);
  const expectedSup = Buffer.from(`Bearer ${supToken}`);
  const same = (a: Buffer, b: Buffer) => a.length === b.length && crypto.timingSafeEqual(a, b);

  const server = http.createServer((req, res) => {
    const auth = Buffer.from(req.headers.authorization ?? '');
    const full = same(auth, expected);
    const supOnly = !full && same(auth, expectedSup);
    const hookOnly = !full && !supOnly && same(auth, expectedHook);
    if ((!full && !supOnly && !hookOnly) || (supOnly && req.url !== '/sup/approve') || (hookOnly && req.url !== '/hook')) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', async () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        let out: unknown;
        const allow = typeof payload.role === 'string' && payload.role ? extras.scope?.(payload.role, payload.consult === true) : undefined;
        if (req.url === '/hook' && hookOnly) {
          await extras.hook?.(payload && typeof payload === 'object' ? payload : {});
          out = { ok: true };
        } else if (req.url === '/list') out = { tools: core().listTools(allow) };
        else if (req.url === '/call') out = await core().callTool(String(payload.name), payload.arguments ?? {}, allow);
        else if (req.url === '/sup/approve' && extras.approve) {
          const input = payload.input && typeof payload.input === 'object' ? payload.input : {};
          out = await extras.approve(String(payload.runId ?? ''), { tool_name: String(payload.tool_name ?? ''), input });
        }
        else {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(err) }));
      }
    });
  });
  // Confirmation popups can take a while; never time the request out server-side.
  server.requestTimeout = 0;

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    supToken,
    hookToken,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
