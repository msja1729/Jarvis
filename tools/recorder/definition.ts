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
      name: 'start_recording',
      title: 'Start recording',
      description: 'Start recording the meeting, lecture or appointment the user is in, so you can take notes when it ends.',
      group: 'act',
      progress: 'Starting the recording',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'stop_recording',
      title: 'Stop recording',
      description: 'Stop the recording and finish the transcript (then read it to take notes).',
      group: 'write',
      defaultSetting: 'allowed',
      progress: 'Finishing the transcript',
      inputSchema: { type: 'object', properties: {} },
    },
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
