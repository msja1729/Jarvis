import type { AppDef } from '../../gateway/types.js';

/** Expert playbooks for each team member (built in, plus the user's own in Team/<Role>/Skills). */
export const SKILLS_APP: AppDef = {
  id: 'skills',
  name: 'Skills',
  description: 'Expert playbooks each team member follows (e.g. the Doctor’s report reading, the Project Manager’s meeting minutes). Add your own as Markdown files in a member’s Skills folder.',
  kind: 'builtin',
  defaultEnabled: true,
  abilities: [
    {
      name: 'use',
      title: 'Use a skill',
      description: 'Load one of your skills (playbook) by name before doing that kind of task.',
      group: 'read',
      progress: 'Opening a skill',
      resultLimit: 8000,
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
    {
      name: 'list',
      title: 'List skills',
      description: 'List your skills, including the ones the user added.',
      group: 'read',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
};
