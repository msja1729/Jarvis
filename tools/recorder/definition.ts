import type { AppDef } from '../../gateway/types.js';

/**
 * Starting and stopping a recording are local commands (0 tokens, SPEC T1).
 * Claude only reads finished transcripts, in parts (SPEC T8), and, when the screen was recorded,
 * looks at the pictures taken whenever the screen changed (slides, a whiteboard, anything shown).
 */
export const RECORDER_APP: AppDef = {
  id: 'recorder',
  name: 'Meeting recorder',
  description: 'Records meetings on this computer (your microphone, the computer\'s sound and, if you like, the screen as a video) and lets your team read the transcript and see the slides or board that were shown.',
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
    {
      name: 'recent_audio',
      title: 'What was just said',
      description:
        'The text of the last minutes of what the computer played (listen-along: a lecture, video or call) or of the meeting being recorded, with times. Use it when the user asks about something just said: "what did he just say?", "explain that", "what was the question?", "what should I answer?". For live meeting help, answer in 1-3 sentences they can use right away, checking Meetings notes and the board for past decisions.',
      group: 'read',
      progress: 'Catching up on what was said',
      inputSchema: { type: 'object', properties: { minutes: { type: 'integer', minimum: 1, maximum: 15, description: 'how far back (default 3)' } } },
    },
    {
      name: 'view_screens',
      title: 'See what was on screen',
      description:
        'See the pictures of the screen taken during a recorded meeting each time it changed (slides, a whiteboard, a shared document), up to 4 at a time with the time each was shown. The transcript marks them as "(screen picture N)" at the moment they appeared.',
      group: 'read',
      progress: 'Looking at the meeting slides',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '"latest" or an id from list_transcripts' },
          from: { type: 'integer', minimum: 1, description: 'first picture number (default 1)' },
          count: { type: 'integer', minimum: 1, maximum: 4, description: 'how many pictures (default 4)' },
        },
      },
    },
  ],
};
