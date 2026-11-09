import type { AppDef } from '../../gateway/types.js';

export const CODING_APP: AppDef = {
  id: 'coding',
  name: 'Coding supervisor',
  description:
    'Jarvis runs Claude Code on a project folder you pick, in the background, and supervises it like a personal assistant: it brings you Claude\'s questions with its own recommendation, asks you before anything risky, and gives you progress updates. Off until you turn it on.',
  kind: 'builtin',
  // It can approve actions on the user's behalf, so the user switches it on.
  defaultEnabled: false,
  abilities: [
    {
      name: 'start',
      title: 'Start a coding task',
      description: 'Start Claude Code on a coding task in a project folder the user picks; Jarvis supervises it in the background.',
      group: 'act',
      // The folder picker is the user's go-ahead; every risky step is still checked.
      defaultSetting: 'allowed',
      progress: 'Starting Claude Code',
      inputSchema: { type: 'object', properties: { task: { type: 'string', description: 'what to build or fix, in the user\'s words plus any details' } }, required: ['task'] },
    },
    {
      name: 'tell',
      title: 'Give Claude more instructions',
      description: 'Pass more instructions to the running or finished coding task.',
      group: 'act',
      defaultSetting: 'allowed',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
    {
      name: 'answer',
      title: 'Answer Claude\'s question',
      description: 'Answer the question Claude Code is waiting on, in the user\'s words.',
      group: 'act',
      defaultSetting: 'allowed',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
    {
      name: 'status',
      title: 'Check progress',
      description: 'What the coding task has done so far and whether it is waiting for the user.',
      group: 'read',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'stop',
      title: 'Stop the coding task',
      description: 'Stop the running coding task.',
      group: 'act',
      defaultSetting: 'allowed',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
};
