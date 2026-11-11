import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildArgs } from '../brain/args.js';
import { LIMIT_MESSAGE } from '../brain/claude-cli.js';
import { sanitizeEnv } from '../brain/env.js';
import { checkSetup } from '../brain/setup.js';
import { SessionManager } from '../brain/session.js';
import { UsageLog } from '../brain/usage.js';
import { Orchestrator } from '../app/orchestrator.js';
import { ROOT, STUB, sourceFiles, stubBrain } from './helpers.js';

describe('C01 installer config', () => {
  it('C01 builds one installer per platform (macOS 13+ universal dmg, Windows NSIS)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.build.mac.target[0]).toMatchObject({ target: 'dmg', arch: ['universal'] });
    expect(pkg.build.mac.minimumSystemVersion).toBe('13.0');
    const win = pkg.build.win.target;
    expect(typeof win === 'string' ? win : win[0].target).toBe('nsis');
  });
});

describe('C02 first-launch setup', () => {
  const saved = process.env.JARVIS_STUB_AUTH;
  afterEach(() => {
    if (saved === undefined) delete process.env.JARVIS_STUB_AUTH;
    else process.env.JARVIS_STUB_AUTH = saved;
  });

  it('C02 shows the install step when claude is missing', async () => {
    const s = await checkSetup([], null);
    expect(s.step).toBe('install');
  });

  it('C02 shows the login step when claude is not logged in', async () => {
    process.env.JARVIS_STUB_AUTH = 'out';
    const s = await checkSetup([STUB], process.execPath);
    expect(s.step).toBe('login');
  });

  it('C02 is ready when logged in, and a test request records a baseline', async () => {
    process.env.JARVIS_STUB_AUTH = 'in';
    const s = await checkSetup([STUB], process.execPath);
    expect(s.step).toBe('ready');
    const { brain, dir } = stubBrain({ JARVIS_STUB_SCENARIO: 'hello' });
    const res = await brain.ask('Say hello.', null, 'haiku');
    expect(res.is_error).toBe(false);
    expect(res.reply).toBe('Hello there, friend!');
    const usage = new UsageLog(null, path.join(dir, 'baseline.json'));
    usage.setBaseline(res.tokens_used);
    expect(new UsageLog(null, path.join(dir, 'baseline.json')).baseline).toBe(1048);
  });
});

describe('C03 no API key reaches claude', () => {
  it('C03 removes ANTHROPIC_API_KEY (any case) from the claude environment', async () => {
    const removedSeen: string[][] = [];
    const { brain, captured } = stubBrain(
      { ANTHROPIC_API_KEY: 'sk-ant-should-not-pass', anthropic_auth_token: 'nope' },
      { onEnvScrubbed: (r) => removedSeen.push(r) },
    );
    await brain.ask('hi', null, 'haiku');
    expect(captured()[0].anthropicVars).toEqual([]);
    expect(removedSeen[0].sort()).toEqual(['ANTHROPIC_API_KEY', 'anthropic_auth_token']);
    expect(sanitizeEnv({ ANTHROPIC_API_KEY: 'x', PATH: '/bin' }).env).toEqual({ PATH: '/bin' });
  });
});

describe('C04 CLI flags', () => {
  it('C04 every run disables built-in tools and sets a turn cap', async () => {
    const { brain, captured } = stubBrain({});
    await brain.ask('hi', null, 'sonnet');
    const argv = captured()[0].argv;
    const at = (f: string) => argv[argv.indexOf(f) + 1];
    expect(at('--tools')).toBe('');
    expect(at('--max-turns')).toBe('8');
    expect(at('--model')).toBe('sonnet');
    expect(argv).toContain('--strict-mcp-config');
    expect(at('--permission-mode')).toBe('dontAsk');
    expect(at('--allowedTools')).toBe('mcp__jarvis');
    expect(captured()[0].mcpTimeout).toBe('300000');
  });

  it('C04 the bypass-permissions flag appears nowhere in the codebase', () => {
    const forbidden = ['--dangerously', 'skip', 'permissions'].join('-');
    const files = [
      ...sourceFiles(['app', 'router', 'brain', 'gateway', 'tools', 'speech', 'security', 'tests', 'scripts']),
      path.join(ROOT, 'package.json'),
      path.join(ROOT, 'README.md'),
    ].filter((f) => fs.existsSync(f));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(fs.readFileSync(f, 'utf8').includes(forbidden), f).toBe(false);
    expect(buildArgs({ prompt: 'x', model: 'haiku', sessionId: null, gateway: null }).join(' ')).not.toContain(forbidden);
  });
});

describe('C05 follow-ups use the earlier conversation', () => {
  it('C05 passes --resume with the saved session id', async () => {
    const { brain, captured } = stubBrain({ JARVIS_STUB_SCENARIO: 'memory' });
    const orch = new Orchestrator({
      brain,
      sessions: new SessionManager(),
      usage: new UsageLog(null, null),
      modelOverride: () => null,
      runLocal: () => '',
    });
    await orch.handle('what is the latest mail from Ravi?');
    const second = await orch.handle('and the one before that?');
    expect(second.reply).toContain('what is the latest mail from Ravi?');
    const runs = captured();
    expect(runs[0].argv).not.toContain('--resume');
    const firstSession = runs[1].argv[runs[1].argv.indexOf('--resume') + 1];
    expect(firstSession).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('C06 usage limit', () => {
  it('C06 shows a clear "usage limit reached" message', async () => {
    const { brain } = stubBrain({ JARVIS_STUB_SCENARIO: 'limit' });
    const res = await brain.ask('hi', null, 'sonnet');
    expect(res.limit_reached).toBe(true);
    expect(res.is_error).toBe(true);
    expect(res.reply).toContain(LIMIT_MESSAGE);
    expect(res.reply).toContain("You've hit your limit");
  });
});

describe('C07 single brain entry point', () => {
  it('C07 only brain/ can start claude (the brain, the setup check, the coding supervisor); the only other process is the local speech engine', () => {
    const files = sourceFiles(['app', 'router', 'gateway', 'tools', 'speech', 'security', 'brain'], ['.ts']);
    const spawners = files.filter((f) => /from ['"](node:)?child_process['"]/.test(fs.readFileSync(f, 'utf8')));
    const rel = spawners.map((f) => path.relative(ROOT, f).replace(/\\/g, '/')).sort();
    expect(rel).toEqual(['brain/claude-cli.ts', 'brain/coder.ts', 'brain/setup.ts', 'speech/media.ts', 'speech/whisper.ts']);
    // The media helper only runs PowerShell (Windows media controls) or osascript, never claude.
    const media = fs.readFileSync(path.join(ROOT, 'speech', 'media.ts'), 'utf8');
    expect(media).not.toMatch(/findClaude|from ['"]\.\.\/brain|['"]claude(\.exe)?['"]/);
    expect([...media.matchAll(/spawn\('([^']+)'/g)].map((m) => m[1]).sort()).toEqual(['osascript', 'powershell.exe']);
    // The speech engine only ever runs whisper-cli, never claude.
    const stt = fs.readFileSync(path.join(ROOT, 'speech', 'whisper.ts'), 'utf8');
    expect(stt).not.toMatch(/findClaude|from ['"]\.\.\/brain|['"]claude(\.exe)?['"]/);
    expect(stt).toMatch(/whisper-cli/);
    const buildArgsUsers = files.filter((f) => /\bbuildArgs\(/.test(fs.readFileSync(f, 'utf8')));
    expect(buildArgsUsers.map((f) => path.basename(f)).sort()).toEqual(['args.ts', 'claude-cli.ts']);
  });
});
