import type { AppDef } from '../../gateway/types.js';
import { GMAIL_APP } from './definition.js';

/** Outlook mail has the same abilities as Gmail; only the search wording differs. */
export const OUTLOOK_APP: AppDef = {
  id: 'outlook',
  name: 'Outlook Mail',
  description: 'Read, draft, send, and delete Outlook / Microsoft 365 mail.',
  kind: 'builtin',
  abilities: GMAIL_APP.abilities.map((a) =>
    a.name === 'list_emails'
      ? {
          ...a,
          description: 'List recent inbox emails (max 10), optionally filtered by search text.',
          progress: 'Reading Outlook',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search text, e.g. "from:ravi budget"' },
              count: { type: 'integer', minimum: 1, maximum: 10 },
            },
          },
        }
      : { ...a },
  ),
};
