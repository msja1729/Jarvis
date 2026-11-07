// A tiny third-party MCP server used to test user-added apps.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'fake-notes', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'search_pages', description: 'Search pages by text. Returns matching pages with full content and metadata.', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, annotations: { readOnlyHint: true } },
    { name: 'delete_page', description: 'Delete a page.', inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, annotations: { destructiveHint: true } },
    { name: 'mystery_tool', description: 'Does something.', inputSchema: { type: 'object' } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === 'search_pages') {
    return { content: [{ type: 'text', text: `secret=${process.env.JARVIS_APP_SECRET ?? 'none'} ` + 'x'.repeat(10000) }] };
  }
  return { content: [{ type: 'text', text: `${req.params.name} ok` }] };
});
await server.connect(new StdioServerTransport());
