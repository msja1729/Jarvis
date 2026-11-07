import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActivityLog } from '../gateway/activity-log.js';
import { GatewayCore } from '../gateway/core.js';
import { SettingsStore } from '../gateway/settings.js';
import type { AppDef, AppExecutor, ConfirmRequest, RawResult } from '../gateway/types.js';
import { ClaudeCLIBrain, ClaudeCLIBrainOptions } from '../brain/claude-cli.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STUB = path.join(ROOT, 'tests', 'stub', 'claude.mjs');

export function tmpDir(prefix = 'jarvis-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** An executor that records calls and returns canned results. */
export class SpyExecutor implements AppExecutor {
  calls: { ability: string; input: Record<string, unknown> }[] = [];
  constructor(private readonly respond: (ability: string, input: Record<string, unknown>) => RawResult | Promise<RawResult> = (a) => ({ text: `${a} ok` })) {}
  async call(ability: string, input: Record<string, unknown>) {
    this.calls.push({ ability, input });
    return this.respond(ability, input);
  }
}

export interface CoreHarness {
  core: GatewayCore;
  settings: SettingsStore;
  log: ActivityLog;
  confirms: ConfirmRequest[];
  setAnswer(yes: boolean): void;
  dir: string;
}

export function makeCore(apps: AppDef[], executors: Record<string, AppExecutor>, opts: { answer?: boolean } = {}): CoreHarness {
  const dir = tmpDir();
  const settings = new SettingsStore(path.join(dir, 'settings.json'));
  const log = new ActivityLog(path.join(dir, 'activity.jsonl'));
  const confirms: ConfirmRequest[] = [];
  let answer = opts.answer ?? false;
  const core = new GatewayCore({
    apps: () => [...apps, ...settings.snapshot().customApps],
    settings,
    executors: (id) => executors[id],
    confirm: async (req) => {
      confirms.push(req);
      return answer;
    },
    log,
  });
  return { core, settings, log, confirms, setAnswer: (y) => (answer = y), dir };
}

export function stubBrain(env: Record<string, string>, extra: Partial<ClaudeCLIBrainOptions> = {}) {
  const dir = tmpDir();
  const capture = path.join(dir, 'capture.jsonl');
  const brain = new ClaudeCLIBrain({
    command: process.execPath,
    prefixArgs: [STUB],
    cwd: path.join(dir, 'cwd'),
    gateway: () => null,
    baseEnv: { ...process.env, JARVIS_STUB_CAPTURE: capture, JARVIS_STUB_STATE: path.join(dir, 'state'), ...env },
    ...extra,
  });
  const captured = () =>
    fs.existsSync(capture)
      ? fs.readFileSync(capture, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; anthropicVars: string[]; cwd: string; mcpTimeout: string | null })
      : [];
  return { brain, captured, dir };
}

export function enableApp(h: CoreHarness, appId: string) {
  h.settings.setEnabled(appId, true);
}

/** Recursively list files under the given directories (skips node_modules, dist, .git). */
export function sourceFiles(dirs: string[], exts = ['.ts', '.mjs', '.js', '.cjs', '.json', '.html']): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'release', '.capture'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.includes(path.extname(e.name))) out.push(p);
    }
  };
  for (const d of dirs) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  return out;
}
