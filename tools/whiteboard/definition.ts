import type { AppDef } from '../../gateway/types.js';
import { BOARD_HEIGHT, BOARD_WIDTH, COLORS, STEP_TYPES } from './scene.js';

export const WHITEBOARD_APP: AppDef = {
  id: 'whiteboard',
  name: 'Whiteboard',
  description: 'Jarvis draws diagrams on its own whiteboard while explaining, and can look at what you drew.',
  kind: 'builtin',
  defaultEnabled: true,
  abilities: [
    {
      name: 'draw',
      title: 'Draw on the whiteboard',
      description: `Draw on the ${BOARD_WIDTH}x${BOARD_HEIGHT} glass whiteboard in one call: title, text, boxes, circles, arrows between ids; erase by id or area.`,
      group: 'write',
      // Only draws inside Jarvis's own window, so no confirmation is needed.
      defaultSetting: 'allowed',
      progress: 'Drawing on the whiteboard',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            maxItems: 80,
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: [...STEP_TYPES] },
                id: { type: 'string', description: 'Name a box/circle so arrows can connect to it; erase: the id to remove' },
                text: { type: 'string' },
                x: { type: 'number' },
                y: { type: 'number' },
                w: { type: 'number', description: 'box or erase-area width' },
                h: { type: 'number' },
                r: { type: 'number' },
                from: { type: 'string', description: 'arrow: start id' },
                to: { type: 'string', description: 'arrow: end id' },
                x2: { type: 'number' },
                y2: { type: 'number' },
                color: { type: 'string', enum: [...COLORS] },
              },
              required: ['type'],
            },
          },
        },
        required: ['steps'],
      },
    },
    {
      name: 'look',
      title: 'Look at the whiteboard',
      description: 'Get a picture of the whiteboard, including what the user drew.',
      group: 'read',
      progress: 'Looking at the whiteboard',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
};
