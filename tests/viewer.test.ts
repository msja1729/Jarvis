/** Showing the user files (the preview next to the chat), and the "On it, about 2 minutes" line. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileForUrl, mimeOf, teamFile, viewKind, viewUrl } from '../tools/files/viewer.js';
import { FilesExecutor } from '../tools/files/executor.js';
import { FILES_APP } from '../tools/files/definition.js';
import { parseCsv, renderDoc } from '../app/renderer/doc-markdown.js';
import { applyLine, newStreamState } from '../brain/stream.js';
import { CORE_RULES } from '../brain/system-prompt.js';
import { rolePrompt } from '../roles/prompts.js';
import { roleFolder, teamRoot } from '../roles/folders.js';
import { tmpDir } from './helpers.js';

function team() {
  const dir = tmpDir();
  const pa = roleFolder(dir, 'pa');
  fs.mkdirSync(path.join(pa, 'Plans'), { recursive: true });
  fs.writeFileSync(path.join(pa, 'Plans', 'Trip plan.md'), '# Trip');
  fs.writeFileSync(path.join(pa, 'Plans', 'map.png'), 'png');
  fs.writeFileSync(path.join(pa, '.env'), 'KEY=1');
  fs.mkdirSync(roleFolder(dir, 'doctor'), { recursive: true });
  fs.writeFileSync(path.join(roleFolder(dir, 'doctor'), 'labs.csv'), 'a,b\n1,2');
  fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
  return dir;
}

describe('which files can be shown, and how the window reaches them', () => {
  it('knows each kind and serves nothing as a page it should not be', () => {
    expect(viewKind('a.md')).toBe('markdown');
    expect(viewKind('a.PNG')).toBe('image');
    expect(viewKind('r.pdf')).toBe('pdf');
    expect(viewKind('x.csv')).toBe('csv');
    expect(viewKind('x.py')).toBe('text');
    expect(viewKind('x.exe')).toBe('other');
    expect(mimeOf('x.exe')).toMatch(/^text\/plain/); // never run, never downloaded as a program
    expect(mimeOf('x.svg')).toBe('image/svg+xml');
  });

  it('only files inside the Team folder, never secrets, never outside', () => {
    const dir = team();
    expect(teamFile(dir, 'PA/Plans/Trip plan.md')).toBe(path.join(teamRoot(dir), 'PA', 'Plans', 'Trip plan.md'));
    expect(() => teamFile(dir, '../settings.json')).toThrow(/Team folder/);
    expect(() => teamFile(dir, path.join(dir, 'settings.json'))).toThrow(/Team folder/);
    expect(() => teamFile(dir, 'PA/.env')).toThrow(/Secret/);
    expect(() => teamFile(dir, 'PA/none.md')).toThrow(/No file/);
    const url = viewUrl('PA/Plans/Trip plan.md');
    expect(url).toBe('jarvis-view://team/PA/Plans/Trip%20plan.md');
    expect(fileForUrl(dir, url)).toBe(teamFile(dir, 'PA/Plans/Trip plan.md'));
    expect(() => fileForUrl(dir, 'jarvis-view://team/PA/%2E%2E/%2E%2E/settings.json')).toThrow();
    expect(() => fileForUrl(dir, 'jarvis-view://other/PA/Plans/map.png')).toThrow();
  });
});

describe('show_user: a member opens the preview', () => {
  it('shows files from their folder, a teammate’s (owner) or by full path; reports the ones it cannot', async () => {
    const dir = team();
    const shown: { role: string; title: string; names: string[] }[] = [];
    const ex = new FilesExecutor({ jarvisDir: dir, showUser: (role, title, files) => void shown.push({ role, title, names: files.map((f) => f.name) }) });
    const r = await ex.call('show_user', { files: ['Plans/Trip plan.md', 'Plans/map.png', 'Plans/nope.md', '.env'], title: 'Your trip' }, { role: 'pa' });
    expect(shown[0]).toEqual({ role: 'pa', title: 'Your trip', names: ['Trip plan.md', 'map.png'] });
    expect(r.text).toMatch(/now sees Trip plan.md, map.png/);
    expect(r.text).toMatch(/Not shown: Plans\/nope.md.*\.env/);
    expect(r.text).toMatch(/Do not paste/);

    await ex.call('show_user', { path: 'PA/Plans/map.png' }, { role: 'pm' }); // as the folder list writes it; one file as "path"
    expect(shown[1].names).toEqual(['map.png']);
    shown.splice(1, 1);
    await ex.call('show_user', { files: ['labs.csv'], owner: 'doctor' }, { role: 'pa' });
    expect(shown[1].names).toEqual(['labs.csv']);
    await ex.call('show_user', { files: [path.join(teamRoot(dir), 'PA', 'Plans', 'map.png')] }, { role: 'finance' });
    expect(shown[2].names).toEqual(['map.png']);
    await expect(ex.call('show_user', { files: [path.join(dir, 'settings.json')] }, { role: 'pa' })).rejects.toThrow(/Nothing to show/);
    await expect(ex.call('show_user', { files: [] }, { role: 'pa' })).rejects.toThrow(/Give the files/);
  });

  it('is allowed without asking (it only shows the user their own files) and every member is told about it', () => {
    const ab = FILES_APP.abilities.find((a) => a.name === 'show_user')!;
    expect(ab.group).toBe('read');
    expect(ab.defaultSetting).toBe('allowed');
    for (const r of ['pa', 'pm', 'doctor', 'finance'] as const) expect(rolePrompt(r)).toMatch(/show_user/);
  });
});

describe('documents in the preview', () => {
  const opts = { resolve: (href: string, kind: 'link' | 'image') => (/^https?:/.test(href) ? (kind === 'link' ? { href, external: true } : null) : { href: `T/${href}`, external: kind === 'image' }) };
  it('tables, task lists, nested lists, quotes, code and diagrams', () => {
    const html = renderDoc(
      ['# Plan', '', '| Day | Cost |', '|:--|--:|', '| Mon | 20 |', '', '- [x] Book', '- [ ] Pack', '  - socks', '', '> note', '', '```mermaid', 'graph TD; A-->B', '```', '', '```py', 'x = 1', '```'].join('\n'),
      opts,
    );
    expect(html).toMatch(/<h1 id="plan">Plan<\/h1>/);
    expect(html).toMatch(/<th>Day<\/th><th style="text-align:right">Cost<\/th>/);
    expect(html).toMatch(/<ul class="tasks"><li class="done"><span class="box done"[^>]*><\/span>Book<\/li><li><span class="box"[^>]*><\/span>Pack<ul><li>socks<\/li><\/ul><\/li><\/ul>/);
    expect(html).toMatch(/<blockquote><p>note<\/p><\/blockquote>/);
    expect(html).toMatch(/data-mermaid="graph TD; A--&gt;B"/);
    expect(html).toMatch(/<code data-lang="py">x = 1<\/code>/);
  });

  it('never lets a file inject HTML; web pictures are not loaded; team links stay in the preview', () => {
    const html = renderDoc('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n![a](https://x.com/p.png) ![m](map.png) [doc](Notes.md) [web](https://example.com)', opts);
    expect(html).not.toMatch(/<script|<img src=x/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<span class="missing">[a]</span>');
    expect(html).toContain('<img src="T/map.png"');
    expect(html).toContain('data-open="T/Notes.md"');
    expect(html).toContain('<a href="https://example.com" target="_blank"');
  });

  it('reads CSV with quoted commas', () => {
    expect(parseCsv('a,"b, c",d\n1,"say ""hi""",3')).toEqual([['a', 'b, c', 'd'], ['1', 'say "hi"', '3']]);
  });
});

describe('"On it, about 2 minutes": what a member says before working', () => {
  const line = (content: unknown[]) => JSON.stringify({ type: 'assistant', message: { content } });
  it('text written before a tool call is passed on at once; the final answer is not', () => {
    const notes: string[] = [];
    const st = newStreamState();
    applyLine(st, line([{ type: 'text', text: 'On it: drafting the email now, about 2 minutes.' }]), undefined, (t) => notes.push(t));
    expect(notes).toEqual([]); // not yet: it could still be the whole answer
    applyLine(st, line([{ type: 'tool_use', name: 'mcp__claude_ai_Gmail__create_draft' }]), undefined, (t) => notes.push(t));
    expect(notes).toEqual(['On it: drafting the email now, about 2 minutes.']);
    applyLine(st, line([{ type: 'text', text: 'Done: the draft is in Gmail.' }]), undefined, (t) => notes.push(t));
    applyLine(st, JSON.stringify({ type: 'result', result: 'Done: the draft is in Gmail.', usage: {} }), undefined, (t) => notes.push(t));
    expect(notes).toHaveLength(1);
    // the same message holding the text and the tool call
    const both: string[] = [];
    applyLine(newStreamState(), line([{ type: 'text', text: 'Checking.' }, { type: 'tool_use', name: 'Read' }]), undefined, (t) => both.push(t));
    expect(both).toEqual(['Checking.']);
  });

  it('every member (and Jarvis) is told to say it first', () => {
    expect(CORE_RULES).toMatch(/Before your first tool call, always write one short line: what you will do and roughly how long/);
    for (const r of ['jarvis', 'pa', 'pm', 'doctor', 'finance'] as const) expect(rolePrompt(r)).toMatch(/roughly how long/);
  });
});
