/** What kind of file something is, and its preview address. No Node imports: the preview page uses it too. */
export const VIEW_SCHEME = 'jarvis-view';

export type ViewKind = 'markdown' | 'image' | 'pdf' | 'html' | 'csv' | 'text' | 'video' | 'audio' | 'other';

const KIND: [RegExp, ViewKind][] = [
  [/\.(md|markdown)$/i, 'markdown'],
  [/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i, 'image'],
  [/\.pdf$/i, 'pdf'],
  [/\.html?$/i, 'html'],
  [/\.(csv|tsv)$/i, 'csv'],
  [/\.(txt|log|json|ya?ml|xml|ini|toml|css|js|mjs|cjs|ts|tsx|jsx|py|java|c|h|cpp|cs|go|rs|rb|php|sh|ps1|sql|tex|ics)$/i, 'text'],
  [/\.(mp4|webm|mov|m4v)$/i, 'video'],
  [/\.(mp3|wav|m4a|ogg|opus|aac|flac)$/i, 'audio'],
];

export function viewKind(file: string): ViewKind {
  return KIND.find(([re]) => re.test(file))?.[1] ?? 'other';
}

/** The address the window loads a team file from ("PA/Plans/trip.md" → jarvis-view://team/PA/Plans/trip.md). */
export function viewUrl(rel: string): string {
  return `${VIEW_SCHEME}://team/${rel.split('/').map(encodeURIComponent).join('/')}`;
}
