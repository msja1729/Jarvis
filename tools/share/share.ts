/**
 * Things the user shows an expert (a PDF, a photo, a video, a recording): saved in that expert's own
 * folder under "Shared with me", then made ready to take in. Pure parts, kept free of Electron so they
 * can be tested; the window that reads videos lives in the app (app/share.ts).
 */
import fs from 'node:fs';
import path from 'node:path';

export const SHARED_DIR = 'Shared with me';
export const MAX_SHARE_BYTES = 1024 * 1024 * 1024; // 1 GB (videos)
/** Pictures sent to the expert at once (each costs tokens); the rest are listed by path. */
export const INLINE_PICTURES = 6;
/** Transcript text sent at once; the full transcript is saved next to the file. */
export const INLINE_TRANSCRIPT = 6000;

export type ShareKind = 'image' | 'pdf' | 'video' | 'audio' | 'other';

const EXT: Record<string, ShareKind> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.bmp': 'image',
  '.pdf': 'pdf',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.mkv': 'video', '.m4v': 'video', '.avi': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.ogg': 'audio', '.opus': 'audio', '.aac': 'audio', '.flac': 'audio',
};

export function kindOf(file: string): ShareKind {
  return EXT[path.extname(file).toLowerCase()] ?? 'other';
}

/** Copies a file into <member folder>/Shared with me, as "<date> <name>" (never overwriting). */
export function saveShared(memberDir: string, source: string, day = new Date().toISOString().slice(0, 10)): string {
  const st = fs.statSync(source);
  if (!st.isFile()) throw new Error(`${path.basename(source)} is not a file.`);
  if (st.size > MAX_SHARE_BYTES) throw new Error(`${path.basename(source)} is over 1 GB.`);
  const dir = path.join(memberDir, SHARED_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(source).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  let dest = path.join(dir, `${day} ${base}`);
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `${day} (${n}) ${base}`);
  fs.copyFileSync(source, dest);
  return dest;
}

export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const p = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`;
};

/** A timed transcript from pieces ("[02:15] …"); empty pieces are skipped. */
export function timedTranscript(pieces: { at: number; text: string }[]): string {
  return pieces
    .filter((p) => p.text.trim())
    .map((p) => `[${clock(p.at)}] ${p.text.trim()}`)
    .join('\n');
}

/** What the expert is told about one shared file (text part). */
export function describeShared(o: {
  name: string;
  saved: string;
  kind: ShareKind;
  duration?: number;
  pictures?: { at: number; file: string }[];
  transcript?: string;
  transcriptFile?: string;
  cut?: boolean;
  note?: string;
}): string {
  const lines = [`• ${o.name} (${o.kind}${o.duration ? `, ${clock(o.duration)} long` : ''}) saved in your folder: ${o.saved}`];
  if (o.kind === 'pdf') lines.push('  Read it with your Read tool (or the documents tool).');
  if (o.kind === 'other') lines.push('  Open it with your Read tool if it is text.');
  if (o.pictures?.length) {
    lines.push(`  Pictures of the scenes (${o.pictures.length}): ${o.pictures.map((p) => `${clock(p.at)}`).join(', ')}; the first ${Math.min(INLINE_PICTURES, o.pictures.length)} are attached here, the rest are in ${path.dirname(o.pictures[0].file)}.`);
  }
  if (o.transcript !== undefined) {
    const t = o.transcript.trim();
    if (!t) lines.push('  No speech was heard in it.');
    else {
      lines.push(`  What is said (transcribed on this computer${o.transcriptFile ? `; full text: ${o.transcriptFile}` : ''}):`);
      lines.push(t.length > INLINE_TRANSCRIPT ? `${t.slice(0, INLINE_TRANSCRIPT)}\n  …(more in the file)` : t);
    }
  }
  if (o.cut) lines.push('  Only the first 40 minutes were taken in; ask the user which part matters if they want more.');
  if (o.note) lines.push(`  ${o.note}`);
  return lines.join('\n');
}
