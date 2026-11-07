import type { AppDef } from '../../gateway/types.js';

export const SCREEN_APP: AppDef = {
  id: 'screen',
  name: 'Screen look',
  description: 'Lets Jarvis look at your screen, one window, or an area you pick, only when you ask.',
  kind: 'builtin',
  defaultEnabled: true,
  abilities: [
    {
      name: 'look',
      title: 'Look at screen',
      description: 'Take one screenshot of the screen the user is on; use target "window" or "area" only if they ask for a specific window or part.',
      group: 'read',
      progress: 'Looking at your screen',
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['screen', 'window', 'area'], description: 'screen (default, automatic), window or area (user picks)' },
          reason: { type: 'string', description: 'Short reason shown if a picker is needed' },
        },
      },
    },
  ],
};
