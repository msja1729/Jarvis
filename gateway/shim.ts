/**
 * Jarvis Gateway stdio shim. `claude` starts this as its only MCP server.
 * It holds no policy and no secrets: it forwards tools/list and tools/call
 * to the Jarvis control server, where GatewayCore decides everything.
 *
 * Env: JARVIS_CONTROL_URL, JARVIS_CONTROL_TOKEN
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDef, ToolResult } from './types.js';

const url = process.env.JARVIS_CONTROL_URL;
const token = process.env.JARVIS_CONTROL_TOKEN;

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!url || !token) throw new Error('Jarvis is not running');
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Jarvis control server ${res.status}`);
  return (await res.json()) as T;
}

const server = new Server({ name: 'jarvis', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { tools } = await post<{ tools: ToolDef[] }>('/list', {});
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  let result: ToolResult;
  try {
    result = await post<ToolResult>('/call', { name: req.params.name, arguments: req.params.arguments ?? {} });
  } catch (err) {
    result = { text: `error: ${String(err)}`, isError: true };
  }
  const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [
    { type: 'text', text: result.text },
  ];
  for (const img of result.images ?? []) content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
  return { content, isError: result.isError };
});

await server.connect(new StdioServerTransport());
