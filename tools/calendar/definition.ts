import type { AppDef } from '../../gateway/types.js';

export const GCAL_APP: AppDef = {
  id: 'gcal',
  name: 'Google Calendar',
  description: 'See and schedule events in Google Calendar.',
  kind: 'builtin',
  abilities: [
    {
      name: 'list_events',
      title: 'Read events',
      description: 'List events between two ISO times (max 20).',
      group: 'read',
      progress: 'Checking your calendar',
      resultLimit: 6000,
      inputSchema: {
        type: 'object',
        properties: { start: { type: 'string' }, end: { type: 'string' } },
        required: ['start', 'end'],
      },
    },
    {
      name: 'create_event',
      title: 'Create event',
      description: 'Create an event and invite attendees by email.',
      group: 'act',
      progress: 'Creating an event',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          start: { type: 'string', description: 'ISO 8601 with offset' },
          end: { type: 'string', description: 'ISO 8601 with offset' },
          attendees: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'start', 'end'],
      },
    },
    {
      name: 'delete_event',
      title: 'Delete event',
      description: 'Delete one event by id.',
      group: 'destructive',
      progress: 'Deleting an event',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  ],
};
