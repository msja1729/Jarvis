/**
 * Local control server: the bridge between the stdio shim (started by `claude`)
 * and GatewayCore in the Jarvis process. Bound to 127.0.0.1, bearer-token protected.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { GatewayCore } from './core.js';

export interface ControlServer {
  url: string;
  token: string;
  close(): Promise<void>;
}

const MAX_BODY = 1_000_000;

export async function startControlServer(core: () => GatewayCore): Promise<ControlServer> {
  const token = crypto.randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);

  const server = http.createServer((req, res) => {
    const auth = Buffer.from(req.headers.authorization ?? '');
    if (auth.length !== expected.length || !crypto.timingSafeEqual(auth, expected)) {
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
        if (req.url === '/list') out = { tools: core().listTools() };
        else if (req.url === '/call') out = await core().callTool(String(payload.name), payload.arguments ?? {});
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
