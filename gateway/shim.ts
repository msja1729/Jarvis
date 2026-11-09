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
/** The team member this run is for (decides which apps' tools are offered), and whether it was consulted by another. */
const role = process.env.JARVIS_ROLE ?? '';
const consult = process.env.JARVIS_CONSULT === '1';
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

// Supervisor mode: this shim is the permission-prompt tool of a coding session
// (claude --permission-prompt-tool). Every request goes to Jarvis, which decides
// or asks the user, and replies {behavior: "allow" | "deny", ...}.
if (process.env.JARVIS_SHIM_MODE === 'supervisor') {
  const sup = new Server({ name: 'jarvis_supervisor', version: '0.1.0' }, { capabilities: { tools: {} } });
  sup.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'approve',
        description: 'Jarvis decides permission prompts for this coding session, asking the user when needed.',
        inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name'] },
      },
    ],
  }));
  sup.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as { tool_name?: string; input?: Record<string, unknown> };
    let reply: unknown;
    try {
      reply = await post('/sup/approve', { runId: process.env.JARVIS_RUN_ID ?? '', tool_name: args.tool_name, input: args.input ?? {} });
    } catch (err) {
      reply = { behavior: 'deny', message: `Jarvis could not be reached (${String(err)}). Stop and wait for the user.` };
    }
    return { content: [{ type: 'text', text: JSON.stringify(reply) }] };
  });
  await sup.connect(new StdioServerTransport());
} else {
const server = new Server({ name: 'jarvis', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { tools } = await post<{ tools: ToolDef[] }>('/list', { role, consult });
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  let result: ToolResult;
  try {
    result = await post<ToolResult>('/call', { name: req.params.name, arguments: req.params.arguments ?? {}, role, consult });
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
}
