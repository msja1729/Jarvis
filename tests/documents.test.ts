/** Documents & code: read what the user picks, cite pages and lines, never leave the folder, never read secrets. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocumentsExecutor, isSecretFile } from '../tools/documents/executor.js';
import { DOCUMENTS_APP } from '../tools/documents/definition.js';
import { pdfPages } from '../tools/documents/pdf-text.js';
import { defaultSetting } from '../gateway/settings.js';
import { normalizeLesson } from '../tools/lesson/spec.js';
import { LessonExecutor } from '../tools/lesson/executor.js';
import { Orchestrator } from '../app/orchestrator.js';
import type { Brain } from '../brain/brain.js';
import { SessionManager } from '../brain/session.js';
import { UsageLog } from '../brain/usage.js';
import { ROOT, tmpDir } from './helpers.js';

function project() {
  const dir = tmpDir('jarvis-code-');
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write('src/auth/login.ts', 'export function login(user: string) {\n  const token = sign(user);\n  return token;\n}\n');
  write('src/db.ts', 'export const pool = createPool();\n');
  write('README.md', '# Demo\nA tiny app.\n');
  write('.env', 'API_KEY=supersecret\n');
  write('keys/server.pem', '-----BEGIN PRIVATE KEY-----\n');
  write('node_modules/lib/index.js', 'module.exports = 1;\n');
  return dir;
}

const outside = () => {
  const d = tmpDir('jarvis-outside-');
  fs.writeFileSync(path.join(d, 'private.txt'), 'not yours');
  return d;
};

function docs(opts: { file?: string | null; folder?: string | null; pages?: string[] } = {}) {
  return new DocumentsExecutor({
    pickFile: async () => opts.file ?? null,
    pickFolder: async () => opts.folder ?? null,
    pdfPages: async () => opts.pages ?? [],
  });
}

describe('Documents & code app', () => {
  it('is on by default, read-only, and needs no popup (the picker is the permission)', () => {
    expect(DOCUMENTS_APP.defaultEnabled).toBe(true);
    for (const a of DOCUMENTS_APP.abilities) {
      expect(a.group).toBe('read');
      expect(defaultSetting(a)).toBe('allowed');
    }
  });

  it('opens a codebase: shows the tree without generated or secret files', async () => {
    const d = docs({ folder: project() });
    const r = await d.call('open_folder', {});
    expect(r.text).toMatch(/login\.ts/);
    expect(r.text).toMatch(/README\.md/);
    expect(r.text).not.toMatch(/\.env|server\.pem|node_modules/);
  });

  it('reads numbered lines so explanations can cite path:line', async () => {
    const d = docs({ folder: project() });
    await d.call('open_folder', {});
    const r = await d.call('read', { path: 'src/auth/login.ts', from: 2, to: 3 });
    expect(r.text).toMatch(/src\/auth\/login\.ts lines 2-3/);
    expect(r.text).toMatch(/^\s+2\| {3}const token = sign\(user\);/m); // "| " then the code's own two-space indent
  });

  it('searches the folder and returns path:line matches, skipping secrets', async () => {
    const d = docs({ folder: project() });
    await d.call('open_folder', {});
    expect((await d.call('search', { query: 'token' })).text).toMatch(/src\/auth\/login\.ts:2:/);
    expect((await d.call('search', { query: 'supersecret' })).text).toMatch(/No matches/);
  });

  it('never reads outside the chosen folder or secret files', async () => {
    const root = project();
    const other = outside();
    const d = docs({ folder: root });
    await d.call('open_folder', {});
    await expect(d.call('read', { path: path.relative(root, path.join(other, 'private.txt')) })).rejects.toThrow(/outside the folder/);
    await expect(d.call('read', { path: '.env' })).rejects.toThrow(/secret files/);
    await expect(d.call('read', { path: 'keys/server.pem' })).rejects.toThrow(/secret files/);
    expect(isSecretFile('id_ed25519')).toBe(true);
    expect(isSecretFile('credentials.json')).toBe(true);
    expect(isSecretFile('login.ts')).toBe(false);
  });

  it('does nothing until the user picks something', async () => {
    await expect(docs().call('open_file', {})).rejects.toThrow(/cancelled/);
    await expect(docs().call('read', { path: 'x' })).rejects.toThrow(/No folder is open/);
  });

  it('opens a PDF with page markers so explanations can cite pages', async () => {
    const dir = tmpDir();
    const f = path.join(dir, 'paper.pdf');
    fs.writeFileSync(f, '%PDF-fake');
    const d = docs({ file: f, pages: ['Abstract. We study cats.', 'Method: count the cats.', 'Results: 3 cats.'] });
    const r = await d.call('open_file', {});
    expect(r.text).toMatch(/3 pages/);
    expect(r.text).toMatch(/--- page 2 ---\nMethod: count the cats\./);
    expect((await d.call('read', { from: 3, to: 3 })).text).toMatch(/pages 3-3 of 3:\n\n--- page 3 ---\nResults/);
  });

  it('reads the text of a real PDF with pdf.js', async () => {
    const pages = await pdfPages(new Uint8Array(fs.readFileSync(path.join(ROOT, 'docs', 'Jarvis-Capabilities.pdf'))));
    expect(pages.length).toBeGreaterThan(5);
    expect(pages.join(' ')).toMatch(/Jarvis/);
  }, 30_000);
});

describe('references in lessons', () => {
  it('quotes, code with line numbers, and sources are kept; snips get a picture only from Jarvis', async () => {
    const { lesson } = normalizeLesson({
      title: 'How login works',
      steps: [
        {
          say: 'This is the function the error points to.',
          show: [
            { type: 'code', code: 'const token = sign(user);\nreturn token;', lang: 'TypeScript', line: 2, marks: [2], source: 'src/auth/login.ts:2-3' },
            { type: 'quote', text: 'Tokens expire after one hour.', source: 'p. 4' },
            { type: 'snip', x: 100, y: 50, w: 200, h: 40, image: 'data:image/png;base64,EVIL' },
          ],
        },
      ],
    });
    const [codeB, quoteB, snipB] = lesson.steps[0].show;
    expect(codeB).toMatchObject({ type: 'code', lang: 'typescript', line: 2, marks: [2], source: 'src/auth/login.ts:2-3' });
    expect(quoteB).toMatchObject({ type: 'quote', source: 'p. 4' });
    expect(snipB.rect).toEqual({ x: 100, y: 50, w: 200, h: 40 });
    expect(snipB.image).toBeUndefined(); // Claude cannot supply the picture

    let shown: unknown;
    const withShot = new LessonExecutor({
      show: async (l) => ((shown = l), 'right'),
      snip: () => ({ image: 'data:image/jpeg;base64,REAL', hl: { x: 0.2, y: 0.3, w: 0.5, h: 0.2 } }),
    });
    await withShot.call('show', { title: 't', steps: [{ say: 'Look here.', show: [{ type: 'snip', x: 1, y: 1, w: 5, h: 5 }] }] });
    expect(JSON.stringify(shown)).toMatch(/REAL/);

    const noShot = new LessonExecutor({ show: async () => 'right', snip: () => null });
    const r = await noShot.call('show', { title: 't', steps: [{ say: 'Look here.', show: [{ type: 'snip', x: 1, y: 1, w: 5, h: 5 }] }] });
    expect(r.text).toMatch(/no screenshot/);
  });
});

describe('explanation level', () => {
  it('adds the chosen level to the request; automatic adds nothing', async () => {
    const calls: string[] = [];
    const brain: Brain = {
      async ask(text) {
        calls.push(text);
        return { reply: 'ok', session_id: 's1', tokens_used: 10, is_error: false };
      },
    };
    let level: string | null = 'eli5';
    const orch = new Orchestrator({ brain, sessions: new SessionManager(), usage: new UsageLog(null, null), runLocal: () => 'x', level: () => level });
    await orch.handle('what is a black hole');
    level = null;
    await orch.handle('what is a black hole');
    expect(calls[0]).toMatch(/^\[now: [^\]]+\] \[level: eli5\] what is a black hole$/);
    expect(calls[1]).toMatch(/^\[now: [^\]]+\] what is a black hole$/);
  });
});
