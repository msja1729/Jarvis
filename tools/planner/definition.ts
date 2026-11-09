import type { AppDef } from '../../gateway/types.js';

/** Reminders (the PA's). Kept on this computer; Jarvis says them aloud at the time. */
export const REMINDERS_APP: AppDef = {
  id: 'reminders',
  name: 'Reminders',
  description: 'Your PA reminds you at the right time, out loud and on screen, e.g. 10 minutes before each meeting.',
  kind: 'builtin',
  defaultEnabled: true,
  abilities: [
    {
      name: 'add',
      title: 'Add a reminder',
      description: 'Remind the user at a time (ISO 8601 with the offset shown in the message).',
      group: 'write',
      defaultSetting: 'allowed', // only on this computer
      inputSchema: { type: 'object', properties: { text: { type: 'string' }, at: { type: 'string' } }, required: ['text', 'at'] },
    },
    { name: 'list', title: 'List reminders', description: 'Upcoming reminders with their ids.', group: 'read', inputSchema: { type: 'object', properties: {} } },
    {
      name: 'cancel',
      title: 'Cancel a reminder',
      description: 'Cancel a reminder by id.',
      group: 'write',
      defaultSetting: 'allowed',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  ],
};

/** The project board shared by the PA and the Project Manager. */
export const BOARD_APP: AppDef = {
  id: 'board',
  name: 'Project board',
  description: 'A simple board of tasks (to do, doing, done) with projects and due dates, shared by your PA and Project Manager.',
  kind: 'builtin',
  defaultEnabled: true,
  abilities: [
    {
      name: 'list',
      title: 'See the board',
      description: 'List tasks with ids, optionally for one project or status (todo, doing, done).',
      group: 'read',
      inputSchema: { type: 'object', properties: { project: { type: 'string' }, status: { type: 'string', enum: ['todo', 'doing', 'done'] } } },
    },
    {
      name: 'add',
      title: 'Add a task',
      description: 'Add a task: title, project, due date (YYYY-MM-DD), status.',
      group: 'write',
      defaultSetting: 'allowed',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' }, project: { type: 'string' }, due: { type: 'string' }, status: { type: 'string', enum: ['todo', 'doing', 'done'] }, notes: { type: 'string' } },
        required: ['title'],
      },
    },
    {
      name: 'update',
      title: 'Update a task',
      description: 'Change a task by id: status, title, project, due date or notes.',
      group: 'write',
      defaultSetting: 'allowed',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' }, project: { type: 'string' }, due: { type: 'string' }, status: { type: 'string', enum: ['todo', 'doing', 'done'] }, notes: { type: 'string' } },
        required: ['id'],
      },
    },
    {
      name: 'remove',
      title: 'Remove a task',
      description: 'Remove a task by id.',
      group: 'write',
      defaultSetting: 'allowed',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  ],
};
