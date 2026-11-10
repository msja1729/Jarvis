import type { AppDef } from '../../gateway/types.js';

export const WEB_SEARCH_URL = 'https://mcp.exa.ai/mcp';

/** Web search and page reading for every team member (Exa; no account, no key). */
export const WEB_APP: AppDef = {
  id: 'web',
  name: 'Web search',
  description: 'Search the web and read pages for current facts, trusted sources and videos. No account needed; search questions are sent to Exa.',
  kind: 'builtin',
  defaultEnabled: true,
  abilities: [
    {
      name: 'search',
      title: 'Search the web',
      description: 'Search the web; returns clean text from the top pages with their links. Use focus and sites to stick to trusted sources.',
      group: 'read',
      progress: 'Searching the web',
      resultLimit: 9000,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'describe the ideal page, not just keywords' },
          focus: {
            type: 'string',
            enum: ['general', 'health', 'research', 'videos', 'official', 'news', 'docs'],
            description: 'health: medical bodies; research: papers; videos: lectures and tutorials; official: government and regulators; docs: official software docs',
          },
          sites: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'prefer these domains, e.g. ["who.int","nih.gov"]' },
          results: { type: 'integer', minimum: 1, maximum: 8 },
        },
        required: ['query'],
      },
    },
    {
      name: 'read',
      title: 'Read web pages',
      description: 'Read up to 3 web pages in full, as clean text.',
      group: 'read',
      progress: 'Reading a web page',
      resultLimit: 9000,
      inputSchema: {
        type: 'object',
        properties: { urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 } },
        required: ['urls'],
      },
    },
  ],
};
