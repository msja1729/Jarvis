import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodingExecutor, folderName, nameFromTask } from '../tools/coding/executor.js';
import { outsidePaths } from '../supervisor/policy.js';
import { keptForUser } from '../supervisor/plain.js';
import type { Supervisor } from '../supervisor/supervisor.js';
import { tmpDir } from './helpers.js';

/** A coding tool with a fake supervisor: records where Claude would work. */
function harness(answer: string | null | 'timeout') {
  const root = path.join(tmpDir(), 'Team', 'Project Manager', 'Projects');
  fs.mkdirSync(root, { recursive: true });
  const started: string[] = [];
  const asked: { suggested: string; where: string }[] = [];
  let picked = 0;
  const sup = { active: false, start: (_t: string, folder: string) => (started.push(folder), 'Claude is now working.') } as unknown as Supervisor;
  const tool = new CodingExecutor({
    supervisor: sup,
    projectsDir: () => root,
    askProjectName: async (suggested, _task, where) => (asked.push({ suggested, where }), answer),
    pickFolder: async () => (picked++, 'D:/Elsewhere/my-app'),
  });
  return { tool, root, started, asked, picks: () => picked };
}

describe("projects live in Ryan's Projects folder", () => {
  it('a new project: the user names it in the popup, and the folder is made there', async () => {
    const h = harness('Study Planner');
    const r = await h.tool.call('start', { task: 'Build a study planner app for students', project: 'Planner' });
    expect(h.asked).toEqual([{ suggested: 'Planner', where: h.root }]);
    expect(h.started).toEqual([path.join(h.root, 'Study Planner')]);
    expect(fs.existsSync(path.join(h.root, 'Study Planner'))).toBe(true);
    expect(r.text).toMatch(/the spec and every code file belong there/);
    expect(h.picks()).toBe(0); // no folder picker
  });

  it("an existing project (its spec is there): carries on in it without asking", async () => {
    const h = harness('never asked');
    fs.mkdirSync(path.join(h.root, 'Celebrity Earnings Estimator'));
    await h.tool.call('start', { task: 'Rebuild it', project: 'Celebrity Earnings Estimator' });
    expect(h.asked).toEqual([]);
    expect(h.started).toEqual([path.join(h.root, 'Celebrity Earnings Estimator')]);
  });

  it('nobody answers the popup: Ryan\'s suggestion is used, nothing waits for ever', async () => {
    const h = harness('timeout');
    await h.tool.call('start', { task: 'Make a budget tracker for my family' });
    expect(h.started).toEqual([path.join(h.root, 'Budget tracker')]);
  });

  it('cancelled: nothing starts', async () => {
    const h = harness(null);
    await expect(h.tool.call('start', { task: 'Build a game', project: 'Game' })).rejects.toThrow(/cancelled naming/);
    expect(h.started).toEqual([]);
  });

  it('a project the user already has somewhere else: they pick its folder', async () => {
    const h = harness('never asked');
    await h.tool.call('start', { task: 'Add a login page', existing_folder: true });
    expect(h.picks()).toBe(1);
    expect(h.started).toEqual(['D:/Elsewhere/my-app']);
  });

  it('names become safe folder names', () => {
    expect(folderName('My app: v2?')).toBe('My app v2');
    expect(folderName('  notes.  ')).toBe('notes');
    expect(folderName('CON')).toBe('CON project');
    expect(nameFromTask('Build a study planner app for students')).toBe('Study planner app');
    expect(nameFromTask('!!!')).toBe('New project');
  });
});

describe('steps that were wrongly blocked as "outside the project folder"', () => {
  const root = path.resolve('D:/Academics/P2');
  it('a web address is not a folder', () => {
    expect(outsidePaths('Invoke-WebRequest -Uri "https://en.wikipedia.org/wiki/Zakir_Khan_(comedian)"', root)).toEqual([]);
    expect(outsidePaths('curl -s http://localhost:8501/_stcore/health', root)).toEqual([]);
  });
  it.runIf(process.platform === 'win32')('/d/... is the same D: drive (Git Bash)', () => {
    expect(outsidePaths('cd "/d/Academics/P2/Projects/app" && ls', root)).toEqual([]);
    expect(outsidePaths('ls /c/Windows/System32', root)).toEqual(['/c/Windows/System32']);
    expect(keptForUser({ tool_name: 'Bash', input: { command: 'cd /d/Academics/P2/code && python -m pytest' } }, root)).toBeNull();
  });
  it('a real outside folder is still caught', () => {
    expect(outsidePaths('cat C:/Users/me/secrets.txt', root).length).toBe(1);
  });
});
