/** Generic result trimming (T5). App-specific trimmers live next to each app. */

export const MAX_RESULT_CHARS = 4000;
export const MORE_NOTE = '\n[more available: ask for the rest]';

/** Cut text so the whole returned string (note included) is at most `limit` chars. */
export function capText(text: string, limit = MAX_RESULT_CHARS): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - MORE_NOTE.length) + MORE_NOTE;
}

export function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + '…';
}
