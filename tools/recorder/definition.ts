import type { AppDef } from '../../gateway/types.js';

/**
 * Starting and stopping a recording are local commands (0 tokens, SPEC T1).
 * Claude only reads finished transcripts, in parts (SPEC T8).
 */
export const RECORDER_APP: AppDef = {
  id: 'recorder',
  name: 'Meeting recorder',
  description: 'Records meetings on this computer and lets Jarvis read the text transcripts.',
  kind: 'builtin',
  defaultEnabled: true,
  abilities: [
    {
      name: 'list_transcripts',
      title: 'List transcripts',
      description: 'List recent meeting transcripts with their ids and lengths.',
      group: 'read',
      progress: 'Looking at your recordings',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'read_transcript',
      title: 'Read transcript',
      description: 'Read one part of a meeting transcript (id "latest" by default); long ones come in parts.',
      group: 'read',
      progress: 'Reading the meeting transcript',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '"latest" or an id from list_transcripts' },
          part: { type: 'integer', minimum: 1 },
        },
      },
    },
  ],
};
