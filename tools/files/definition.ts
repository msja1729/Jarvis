import type { AppDef } from '../../gateway/types.js';

const OWNER = {
  type: 'string',
  enum: ['pa', 'pm', 'doctor', 'finance'],
  description: "a teammate's folder to look in (read only); leave out for your own",
};

/** Each team member's own folder in the Jarvis folder (Team/<Role>). */
export const FILES_APP: AppDef = {
  id: 'files',
  name: 'Team folders',
  description: 'Each team member keeps their notes, plans and research in their own folder (Jarvis folder → Team). Teammates can read each other’s folders.',
  kind: 'builtin',
  defaultEnabled: true,
  abilities: [
    {
      name: 'ask_user_to_share',
      title: 'Ask you to show something',
      description:
        'When the user wants to show you something ("I want to show you…", "look at this", "can you see this PDF/photo/video"), call this: a drop box appears for them and you wait. What they drop is saved in your folder (Shared with me) and given to you: pictures attached, PDFs to read with Read, videos as scene pictures plus a timed transcript. Then answer about it.',
      group: 'read',
      defaultSetting: 'allowed', // nothing happens unless the user drops something
      progress: 'Waiting for your file',
      inputSchema: { type: 'object', properties: { prompt: { type: 'string', description: 'what to ask for, e.g. "Drop the blood test report here"' } } },
    },
    {
      name: 'show_user',
      title: 'Show you files',
      description:
        'Show the user files you made or found (Markdown, pictures, PDF, HTML, CSV, text, video): a large preview opens next to the chat, where they can flip through them and open any one big. Use it whenever you want the user to see a document, image or report, instead of pasting it into your reply. Paths: relative to your folder (or a teammate’s with owner), or full paths inside the Team folder.',
      group: 'read',
      defaultSetting: 'allowed', // it only shows the user their own team's files
      progress: 'Opening a preview',
      inputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12, description: 'all the files to show, in one call, e.g. ["Plans/Trip plan.md", "Plans/map.png"]' },
          title: { type: 'string', description: 'a short title for the preview, e.g. "Your Goa trip plan"' },
          owner: OWNER,
        },
        required: ['files'],
      },
    },
    {
      name: 'list',
      title: 'See folders',
      description: 'List your folder (or a sub-folder, or a teammate’s folder with owner).',
      group: 'read',
      progress: 'Looking in the team folders',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'sub-folder, e.g. "Meetings"' }, owner: OWNER } },
    },
    {
      name: 'read',
      title: 'Read files',
      description: 'Read a text or PDF file from your folder or a teammate’s; long files come in parts.',
      group: 'read',
      progress: 'Reading a file',
      resultLimit: 6500,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, owner: OWNER, part: { type: 'integer', minimum: 1 } },
        required: ['path'],
      },
    },
    {
      name: 'search',
      title: 'Search files',
      description: 'Find files and lines containing some words, in your folder, a teammate’s, or owner "all".',
      group: 'read',
      progress: 'Searching the team folders',
      resultLimit: 6000,
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, owner: { type: 'string', enum: [...OWNER.enum, 'all'] } },
        required: ['query'],
      },
    },
    {
      name: 'write',
      title: 'Write files',
      description: 'Create or replace a text file in your own folder (mode "append" adds to the end); sub-folders are made as needed.',
      group: 'write',
      defaultSetting: 'allowed', // only inside your own folder on this computer
      progress: 'Saving a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'e.g. "Meetings/2026-11-10 design review.md"' },
          content: { type: 'string' },
          mode: { type: 'string', enum: ['replace', 'append'] },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'make_folder',
      title: 'Make folders',
      description: 'Create a sub-folder in your own folder.',
      group: 'write',
      defaultSetting: 'allowed',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
    {
      name: 'move',
      title: 'Move or rename',
      description: 'Move or rename a file or sub-folder inside your own folder.',
      group: 'write',
      defaultSetting: 'allowed',
      inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    },
    {
      name: 'delete',
      title: 'Delete files',
      description: 'Move a file or sub-folder of your own folder to the Recycle Bin.',
      group: 'destructive',
      progress: 'Deleting a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  ],
};
