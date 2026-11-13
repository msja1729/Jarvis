import type { AppDef } from '../../gateway/types.js';

export const CODING_APP: AppDef = {
  id: 'coding',
  name: 'Coding supervisor',
  description:
    'Jarvis runs Claude Code on a project folder you pick, in the background, and supervises it like a personal assistant: it brings you Claude\'s questions with its own recommendation, asks you before anything risky, and gives you progress updates.',
  kind: 'builtin',
  // On like every other tool (the user's choice, 2026-11-12); anything risky still waits for the user.
  defaultEnabled: true,
  abilities: [
    {
      name: 'start',
      title: 'Start a coding task',
      description:
        "Start Claude Code on a coding task; Jarvis supervises it in the background. Every project lives in your Projects folder, in Projects/<project>, together with its SPEC.md: give the project's name (the same folder as its spec). A new project: the user is asked to name it in a popup, and the folder is created. Only when the user wants to work on a project they already have somewhere else, set existing_folder true (they pick it).",
      group: 'act',
      // The folder picker is the user's go-ahead; every risky step is still checked.
      defaultSetting: 'allowed',
      progress: 'Starting Claude Code',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'what to build or fix, in the user\'s words plus any details' },
          project: { type: 'string', description: "the project's folder name in Projects (e.g. \"Study planner\"); for a new project, your suggested name" },
          existing_folder: { type: 'boolean', description: 'true only for a project the user already has outside your Projects folder (they pick its folder)' },
          team_decides: {
            type: 'boolean',
            description:
              'true only when the user, in any words, asks the team to decide or approve things themselves, not to ask them, or not to disturb them ("you decide", "don\'t ask me", "handle it yourselves", "I\'ll be busy"). Otherwise false: the user is asked.',
          },
        },
        required: ['task'],
      },
    },
    {
      name: 'team_decides',
      title: 'Let the team decide',
      description:
        'Turn "team decides" on or off for the running coding task: on when the user, in any words, says the team should decide on its own or not disturb them; off when they want to be asked again. When on, the team answers Claude\'s questions and permissions with no popups; publishing online, anything outside the project folder and password files are skipped and listed at the end.',
      group: 'act',
      defaultSetting: 'allowed',
      inputSchema: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
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
