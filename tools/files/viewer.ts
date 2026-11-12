/**
 * Files a team member shows the user: what kind each one is, and the one safe way to reach it.
 * Only files inside the Team folder are ever shown (never secrets, never links that lead outside),
 * and the window reaches them through the jarvis-view:// address, never a file:// path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { teamRoot } from '../../roles/folders.js';
import { isSecretFile } from '../documents/executor.js';
import { VIEW_SCHEME, ViewKind, viewKind, viewUrl } from './view-kind.js';

export { VIEW_SCHEME, viewKind, viewUrl } from './view-kind.js';
export type { ViewKind } from './view-kind.js';

export const MAX_SHOW = 12;
/** Text bigger than this is cut in the preview (the whole file opens with "Open in app"). */
export const MAX_VIEW_TEXT = 2_000_000;

const MIME: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8', '.markdown': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac',
};

/** The content type to serve a file with; anything unknown is plain text (never run as a page or script). */
export function mimeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'text/plain; charset=utf-8';
}

function within(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** A path relative to the Team folder ("PA/Plans/trip.md"), with forward slashes. */
export function teamRel(jarvisDir: string, abs: string): string {
  return path.relative(teamRoot(jarvisDir), abs).split(path.sep).join('/');
}

/**
 * A file inside the Team folder, checked: it exists, is a file, is not a secret, and (following links)
 * really is inside the Team folder. `p` is a full path or one relative to the Team folder. Throws otherwise.
 */
export function teamFile(jarvisDir: string, p: string): string {
  const root = teamRoot(jarvisDir);
  if (typeof p !== 'string' || !p.trim() || p.includes('\0')) throw new Error('Bad path.');
  const full = path.resolve(root, p.trim());
  if (!within(root, full)) throw new Error('Only files in the Team folder can be shown.');
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`No file ${path.basename(full)}.`);
  if (!within(fs.realpathSync(root), fs.realpathSync(full))) throw new Error('That file leads outside the Team folder.');
  if (isSecretFile(full)) throw new Error('Secret files (keys, passwords, .env) are never shown.');
  return full;
}

/** What the window gets for each shown file. */
export interface ShownFile {
  name: string;
  /** Relative to the Team folder, forward slashes. */
  rel: string;
  url: string;
  kind: ViewKind;
  size: number;
}

export function shownFile(jarvisDir: string, abs: string): ShownFile {
  return { name: path.basename(abs), rel: teamRel(jarvisDir, abs), url: viewUrl(teamRel(jarvisDir, abs)), kind: viewKind(abs), size: fs.statSync(abs).size };
}

/** jarvis-view://team/PA/a%20b.md → the checked full path (throws if it is not a team file). */
export function fileForUrl(jarvisDir: string, url: string): string {
  const u = new URL(url);
  if (u.protocol !== `${VIEW_SCHEME}:` || u.hostname !== 'team') throw new Error('Unknown address.');
  const rel = u.pathname.split('/').filter(Boolean).map(decodeURIComponent).join('/');
  if (rel.split('/').includes('..')) throw new Error('Bad path.');
  return teamFile(jarvisDir, rel);
}
