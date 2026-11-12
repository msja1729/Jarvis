/** First-run welcome (intros, name) and uninstalling without leaving anything behind. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fallbackIntros, introCards, introPrompt, INTRO_ORDER, parseIntros } from '../roles/intros.js';
import { peopleNames } from '../roles/roles.js';
import { claudeProjectName, Keychain, uninstallCleanup } from '../app/uninstall-cleanup.js';
import { installHooks } from '../supervisor/hooks.js';
import { SettingsStore } from '../gateway/settings.js';
import { ROOT, tmpDir } from './helpers.js';

const people = peopleNames({ doctor: 'Priya' });

describe('meet the team', () => {
  it('hand-written intros use the names the user chose, and the user’s name', () => {
    const f = fallbackIntros(people, 'Jyo');
    expect(f.hello).toMatch(/^Hey Jyo!/);
    expect(f.members.doctor).toMatch(/I'm Priya/);
    expect(f.members.doctor).toMatch(/not a replacement for your real doctor/);
    expect(f.members.finance).toMatch(/Not official financial advice/);
    expect(f.outro).toMatch(/Jyo/);
    expect(fallbackIntros(people).hello).toMatch(/^Hey there!/);
    // Maya (the PA) hosts: she says hello and goodbye, Jarvis is not on the team
    expect(INTRO_ORDER).toEqual(['pa', 'pm', 'doctor', 'finance']);
    expect(f.hello).toMatch(/I'm Maya/);
    expect(f.hello + f.outro).not.toMatch(/I'm Jarvis|front desk/);
  });

  it('asks Claude for spoken, human intros with every member and their skills', () => {
    const { prompt, system } = introPrompt(people, 'Jyo');
    expect(system).toMatch(/no emojis/);
    expect(system).toMatch(/Gen Z/);
    for (const name of ['Maya', 'Ryan', 'Priya', 'Victor']) expect(prompt).toContain(name);
    expect(prompt).toMatch(/meeting minutes/);
    expect(prompt).toContain('Jyo');
  });

  it('uses Claude’s lines when they are good and falls back line by line when not', () => {
    const fb = fallbackIntros(people, 'Jyo');
    const good = 'x'.repeat(70);
    const raw = `Sure! {"hello": "${good}", "pa": "**bold** ${good}", "pm": "short", "doctor": "${good}", "finance": "${'y'.repeat(700)}", "outro": "Ready when you are, Jyo. Where do we start?"}`;
    const out = parseIntros(raw, fb);
    expect(out.hello).toBe(good);
    expect(out.members.pa).toBe(fb.members.pa); // markdown
    expect(out.members.pm).toBe(fb.members.pm); // too short
    expect(out.members.finance).toBe(fb.members.finance); // too long
    expect(out.outro).toMatch(/Where do we start/);
    expect(parseIntros(null, fb)).toBe(fb);
    expect(parseIntros('not json', fb)).toBe(fb);
  });

  it('cards show each member with their colour and skills; the PM shows Opus', () => {
    const cards = introCards(people);
    expect(cards.map((c) => c.person)).toEqual(['Maya', 'Ryan', 'Priya', 'Victor']);
    expect(cards.find((c) => c.id === 'pm')!.model).toBe('Opus 5.5');
    expect(cards.every((c) => c.skills.length >= 5 && /^#/.test(c.color))).toBe(true);
  });

  it('remembers the user’s name and whether the welcome is done', () => {
    const s = new SettingsStore(path.join(tmpDir(), 'settings.json'));
    expect(s.setUserName('  Jyothi  Radit ')).toBe('Jyothi Radit');
    expect(() => s.setUserName('<script>')).toThrow();
    s.setOnboarded(true);
    expect(s.snapshot()).toMatchObject({ userName: 'Jyothi Radit', onboarded: true });
    s.setUserName('');
    expect(s.snapshot().userName).toBeUndefined();
  });
});

describe('uninstall leaves nothing behind', () => {
  function fakeKeychain(entries: Record<string, string[]>): Keychain & { entries: Record<string, string[]> } {
    return {
      entries,
      list: (svc) => [...(entries[svc] ?? [])],
      remove: (svc, acc) => {
        entries[svc] = (entries[svc] ?? []).filter((a) => a !== acc);
      },
    };
  }

  it('removes keychain entries, its hooks, its Claude sessions and the Jarvis folder; nothing else', async () => {
    const home = tmpDir();
    const userData = path.join(home, 'AppData', 'Roaming', 'Jarvis');
    fs.mkdirSync(path.join(userData, 'Team', 'Doctor'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'Team', 'Doctor', 'note.md'), 'x');
    // Claude Code: the user's own hook and settings stay; Jarvis's hooks go
    const settingsFile = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
    installHooks(settingsFile, 'ELECTRON_RUN_AS_NODE=1 "Jarvis.exe" "jarvis-claude-hook.mjs" "x"');
    // Claude Code's saved sessions: Jarvis's own working folder goes, the user's projects stay
    const projects = path.join(home, '.claude', 'projects');
    const ours = path.join(projects, claudeProjectName(path.join(userData, 'brain-cwd')));
    const theirs = path.join(projects, 'D--code-my-app');
    for (const d of [ours, theirs]) fs.mkdirSync(d, { recursive: true });
    const kc = fakeKeychain({ 'dev.jarvis.desktop': ['google', 'google#1', 'app:notion'], 'other.app': ['keep'] });

    const done = await uninstallCleanup({ home, userData, keychain: kc });

    expect(kc.entries['dev.jarvis.desktop']).toEqual([]);
    expect(kc.entries['other.app']).toEqual(['keep']);
    const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    expect(JSON.stringify(after)).not.toMatch(/jarvis-claude-hook/);
    expect(JSON.stringify(after)).toMatch(/echo mine/);
    expect(after.model).toBe('opus');
    expect(fs.existsSync(ours)).toBe(false);
    expect(fs.existsSync(theirs)).toBe(true);
    expect(fs.existsSync(userData)).toBe(false);
    expect(done.join('\n')).toMatch(/3 keychain entries/);
  });

  it('works when Claude Code was never set up, and can leave the folder to the uninstaller', async () => {
    const home = tmpDir();
    const userData = path.join(home, 'Jarvis');
    fs.mkdirSync(userData);
    await uninstallCleanup({ home, userData, keychain: fakeKeychain({}), keepUserData: true });
    expect(fs.existsSync(userData)).toBe(true);
  });

  it('the app never runs the cleanup by itself: only the uninstaller entry point does', () => {
    const lib = fs.readFileSync(path.join(ROOT, 'app', 'uninstall-cleanup.ts'), 'utf8');
    expect(lib).not.toMatch(/require\.main|process\.argv|uninstallCleanup\(\{[^}]*\}\)\s*\./);
    const cli = fs.readFileSync(path.join(ROOT, 'app', 'uninstall-cli.ts'), 'utf8');
    expect(cli).toMatch(/uninstallCleanup\(/);
    const main = fs.readFileSync(path.join(ROOT, 'app', 'main.ts'), 'utf8');
    expect(main).not.toMatch(/uninstall-cli/);
    // in the app it only runs from Settings → Uninstall (macOS), after the user confirmed
    expect(main.match(/uninstallCleanup\(/g)?.length).toBe(1);
    expect(main).toMatch(/ipcMain\.handle\('app:uninstall'[\s\S]*uninstallCleanup\(/);
  });

  it('the Windows uninstaller runs the cleanup (not on updates) and deletes the Jarvis folder', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.build.nsis).toMatchObject({ deleteAppDataOnUninstall: true, include: 'build/installer.nsh', perMachine: false });
    const nsh = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'), 'utf8');
    expect(nsh).toMatch(/!macro customUnInstall[\s\S]*\$\{ifNot\} \$\{isUpdated\}[\s\S]*uninstall-cleanup\.cjs[\s\S]*RMDir \/r "\$APPDATA\\Jarvis"/);
    const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.mjs'), 'utf8');
    expect(build).toMatch(/app\/uninstall-cli\.ts'\], outfile: 'dist\/app\/uninstall-cleanup\.cjs'/);
  });
});

describe('saying the user’s name right', () => {
  it('only the spoken text changes: whole words, any case, not inside other words', async () => {
    const { applyPronunciations } = await import('../speech/pronounce.js');
    const map = { Raghunandan: 'Ruh-goo-nun-dun' };
    expect(applyPronunciations('Hey Raghunandan! raghunandan, ready?', map)).toBe('Hey Ruh-goo-nun-dun! Ruh-goo-nun-dun, ready?');
    expect(applyPronunciations('Raghunandana is someone else', map)).toBe('Raghunandana is someone else');
    expect(applyPronunciations('nothing to change', undefined)).toBe('nothing to change');
  });

  it('tidies Claude’s respelling so every chunk reads like English', async () => {
    const { parseRespelling, tidyRespelling } = await import('../speech/pronounce.js');
    expect(tidyRespelling('Ve-nkaa-tesh')).toBe('Ven-kaa-tesh');
    expect(tidyRespelling('Ti-ru-maa-lai')).toBe('Tee-roo-maa-lai');
    expect(tidyRespelling('Pree-yaan-kaa')).toBe('Pree-yaan-kaa');
    expect(parseRespelling('"Ruh-goo-nun-dun"', 'Raghunandan')).toBe('Ruh-goo-nun-dun');
    expect(parseRespelling('Raghunandan → Ruh-goo-nun-dun\n(explanation)', 'Raghunandan')).toBe('Ruh-goo-nun-dun');
    expect(parseRespelling('Raghunandan', 'Raghunandan')).toBeNull();
    expect(parseRespelling('<b>x</b>', 'X')).toBeNull();
  });

  it('is saved per name, checked, and forgotten on request', () => {
    const s = new SettingsStore(path.join(tmpDir(), 'settings.json'));
    s.setPronunciation('Raghunandan', 'Ruh-goo-nun-dun');
    expect(s.snapshot().pronunciations).toEqual({ Raghunandan: 'Ruh-goo-nun-dun' });
    expect(() => s.setPronunciation('Raghunandan', 'rm -rf /')).toThrow();
    s.setPronunciation('Raghunandan', null);
    expect(s.snapshot().pronunciations).toEqual({});
  });

  it('the voice uses it: every spoken word goes through the pronunciation map', () => {
    const main = fs.readFileSync(path.join(ROOT, 'app', 'main.ts'), 'utf8');
    expect(main).toMatch(/kokoro\.speak\(applyPronunciations\(String\(text\), snap\.pronunciations\)/);
  });
});

describe('crisp graphics', () => {
  it('nothing in the welcome moves or scales text on hover (that blurs it on scaled screens)', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'renderer', 'onboard.css'), 'utf8');
    const hovers = css.match(/[^}]*:hover[^{]*\{[^}]*\}/g) ?? [];
    expect(hovers.length).toBeGreaterThan(2);
    for (const rule of hovers) expect(rule, rule).not.toMatch(/transform|filter|scale/);
    expect(css).not.toMatch(/\.ob-member\.live[^}]*scale/);
  });
});

describe('title card', () => {
  it('hovering the first button never cancels its fade-in (it would vanish)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'onboard.css'), 'utf8');
    expect(css).toMatch(/\.ob-title \.ob-cta:hover:not\(:disabled\)[^{]*\{ animation: ob-rise/);
  });

  it('the logo ring ends as one continuous circle, not separate dots', () => {
    const ts = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'onboard.ts'), 'utf8');
    expect(ts).toMatch(/g\.arc\(cx, cx, R, 0, Math\.PI \* 2\);\s*g\.stroke\(\)/);
  });
});
