/** Sample apps for Gateway tests (the shapes of the Gmail and Google Calendar apps Jarvis once had built in). */
import type { AppDef } from '../../gateway/types.js';

export const GMAIL_APP: AppDef = {
  id: 'gmail',
  name: 'Gmail',
  description: 'Read, draft, send, and delete Gmail messages.',
  kind: 'builtin',
  abilities: [
    {
      name: 'list_emails',
      title: 'Read emails',
      description: 'List recent emails (max 10), optionally filtered by a Gmail search query.',
      group: 'read',
      progress: 'Reading Gmail',
      resultLimit: 6000,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search, e.g. "is:unread from:ravi"' },
          count: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    },
    {
      name: 'read_email',
      title: 'Read emails',
      description: 'Read one email as plain text by id.',
      group: 'read',
      progress: 'Reading an email',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    {
      name: 'draft_email',
      title: 'Draft email',
      description: 'Create a draft (not sent); set reply_to_id to reply in a thread.',
      group: 'write',
      progress: 'Drafting an email',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
          reply_to_id: { type: 'string' },
        },
        required: ['to', 'body'],
      },
    },
    {
      name: 'send_draft',
      title: 'Send email',
      description: 'Send an existing draft by draft id.',
      group: 'act',
      progress: 'Sending an email',
      inputSchema: { type: 'object', properties: { draft_id: { type: 'string' } }, required: ['draft_id'] },
    },
    {
      name: 'delete_email',
      title: 'Delete email',
      description: 'Move one email to the trash by id.',
      group: 'destructive',
      progress: 'Deleting an email',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  ],
};


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
