import type { AppDef } from '../../gateway/types.js';
import { ROLES } from '../../roles/roles.js';

const SPECIALISTS = ROLES.filter((r) => r.id !== 'jarvis');

export const TEAM_APP: AppDef = {
  id: 'team',
  name: 'Team',
  description: 'Lets the members of your Jarvis team ask each other for help, e.g. the PA asks the Project Manager about deadlines before planning your day.',
  kind: 'builtin',
  defaultEnabled: true,
  abilities: [
    {
      name: 'ask',
      title: 'Ask a teammate',
      description: `Ask another team member a question in their field and get their answer: ${SPECIALISTS.map((r) => `${r.id} (${r.title.toLowerCase()})`).join(', ')}.`,
      group: 'read',
      progress: 'Asking a teammate',
      inputSchema: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: SPECIALISTS.map((r) => r.id) },
          question: { type: 'string', description: 'the full question with the context they need' },
        },
        required: ['role', 'question'],
      },
    },
  ],
};
