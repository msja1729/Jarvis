/** "Who can use it": the user picks which team members may use each app. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canUse, cleanMembers, guessMembers, membersOf, SPECIALISTS } from '../roles/access.js';
import { SettingsStore } from '../gateway/settings.js';
import { GatewayCore } from '../gateway/core.js';
import { ActivityLog } from '../gateway/activity-log.js';
import type { AppDef } from '../gateway/types.js';
import { BUILTIN_APPS } from '../app/apps.js';
import { SpyExecutor, tmpDir } from './helpers.js';

const notion: AppDef = {
  id: 'notion',
  name: 'Notion',
  description: 'Search, read, and edit your Notion pages.',
  kind: 'mcp',
  abilities: [{ name: 'search', title: 'Search', description: 'Search pages.', group: 'read', inputSchema: { type: 'object' } }],
};
const gmail = BUILTIN_APPS.find((a) => a.id === 'gmail')!;
const web = BUILTIN_APPS.find((a) => a.id === 'web')!;

describe('who can use each app', () => {
  it('until the user chooses, members keep their usual apps; Jarvis has everything', () => {
    expect(membersOf(gmail)).toEqual(['pa']);
    expect(membersOf(notion)).toEqual(['pm']); // added apps used to go to the Project Manager only
    expect(canUse('jarvis', notion, { notion: [] })).toBe(true);
  });

  it("the user's choice replaces the usual members, both ways", () => {
    const choices = { gmail: ['pa', 'doctor'], notion: ['educator', 'pa'] };
    expect(membersOf(gmail, choices)).toEqual(['pa', 'doctor']);
    expect(membersOf(notion, choices)).toEqual(['pa', 'educator']);
    expect(canUse('pm', notion, choices)).toBe(false);
    expect(membersOf(notion, { notion: [] })).toEqual([]); // only Jarvis
  });

  it('folders, skills, web and the team tool are always for everyone', () => {
    expect(membersOf(web, { web: [] })).toEqual(SPECIALISTS);
  });

  it('suggests members for a new app from what it does', () => {
    expect(guessMembers(notion)).toEqual(['pa', 'educator']);
    expect(guessMembers({ id: 'github', name: 'GitHub', description: 'Read issues, pull requests, and repositories.' })).toEqual(['pm']);
    expect(guessMembers({ id: 'strava', name: 'Strava', description: 'Your workouts and runs' })).toEqual(['doctor']);
    expect(guessMembers({ id: 'zerodha', name: 'Zerodha', description: 'Stocks and portfolio' })).toEqual(['finance']);
    expect(guessMembers({ id: 'thing', name: 'Thing', description: 'Does stuff' })).toEqual(['pa', 'pm']);
  });

  it('only real members are accepted', () => {
    expect(cleanMembers(['doctor', 'jarvis', 'hacker', 'doctor', 5])).toEqual(['doctor']);
    expect(cleanMembers('pa')).toEqual([]);
  });

  it('is saved in settings and forgotten when the app is removed', () => {
    const file = path.join(tmpDir(), 'settings.json');
    const s = new SettingsStore(file);
    s.addCustomApp(notion);
    s.setAppRoles('notion', ['educator']);
    expect(new SettingsStore(file).snapshot().appRoles).toEqual({ notion: ['educator'] });
    s.setAppRoles('notion', null);
    expect(s.snapshot().appRoles).toEqual({});
    s.setAppRoles('notion', ['pa']);
    s.removeCustomApp('notion');
    expect(s.snapshot().appRoles).toEqual({});
  });

  it('the Gateway enforces it: a member not given the app neither sees nor can use it', async () => {
    const dir = tmpDir();
    const settings = new SettingsStore(path.join(dir, 'settings.json'));
    settings.addCustomApp(notion);
    settings.setEnabled('notion', true);
    const spy = new SpyExecutor();
    const core = new GatewayCore({ apps: () => settings.snapshot().customApps, settings, executors: () => spy, confirm: async () => true, log: new ActivityLog(null) });
    const scope = (role: 'educator' | 'pm') => (a: AppDef) => canUse(role, a, settings.snapshot().appRoles);
    settings.setAppRoles('notion', ['educator']);
    expect(core.listTools(scope('educator')).map((t) => t.name)).toEqual(['notion__search']);
    expect(core.listTools(scope('pm'))).toEqual([]);
    const r = await core.callTool('notion__search', {}, scope('pm'), { role: 'pm' });
    expect(r.text).toMatch(/belongs to another member/);
    expect(spy.calls).toHaveLength(0);
    // changed in the Tool Hub: applies on the very next request
    settings.setAppRoles('notion', ['pm']);
    expect((await core.callTool('notion__search', {}, scope('pm'), { role: 'pm' })).isError).toBe(false);
  });
});
