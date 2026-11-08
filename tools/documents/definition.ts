import type { AppDef } from '../../gateway/types.js';
import { MAX_OUT_CHARS } from './executor.js';

const reason = { type: 'string', description: 'short reason shown in the picker title' };

export const DOCUMENTS_APP: AppDef = {
  id: 'documents',
  name: 'Documents & code',
  description: 'Jarvis reads a PDF, text file or code folder that you pick, so it can explain it with exact page and line references. Read-only; it never reads key or password files.',
  kind: 'builtin',
  defaultEnabled: true,
  abilities: [
    {
      name: 'open_file',
      title: 'Open a file you pick',
      description: 'Ask the user to pick a PDF, text or code file; returns its first pages or lines.',
      group: 'read',
      progress: 'Waiting for you to pick a file',
      resultLimit: MAX_OUT_CHARS + 500,
      inputSchema: { type: 'object', properties: { reason } },
    },
    {
      name: 'open_folder',
      title: 'Open a folder you pick',
      description: 'Ask the user to pick a folder (e.g. a codebase); returns its file tree.',
      group: 'read',
      progress: 'Waiting for you to pick a folder',
      resultLimit: MAX_OUT_CHARS + 500,
      inputSchema: { type: 'object', properties: { reason } },
    },
    {
      name: 'read',
      title: 'Read pages or lines',
      description: 'Read PDF pages or numbered lines: give path (in the opened folder) or id (an opened file), from and to.',
      group: 'read',
      progress: 'Reading',
      resultLimit: MAX_OUT_CHARS + 500,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, id: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' } },
      },
    },
    {
      name: 'search',
      title: 'Search the opened folder',
      description: 'Find a word or phrase in the opened folder; returns path:line matches.',
      group: 'read',
      progress: 'Searching',
      resultLimit: MAX_OUT_CHARS + 500,
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  ],
};
