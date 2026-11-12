/**
 * One-off measurement for criterion 9 against the REAL claude CLI (uses Pro usage).
 * Also an end-to-end smoke test: real claude → shim → control server → GatewayCore
 * → a pretend mailbox app (tests/fixtures/sample-apps.ts).
 *
 *   npm run measure
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeCLIBrain } from '../brain/claude-cli.js';
import { findClaude } from '../brain/setup.js';
import { sanitizeEnv } from '../brain/env.js';
import { toUsage } from '../brain/stream.js';
import { ActivityLog } from '../gateway/activity-log.js';
import { GatewayCore } from '../gateway/core.js';
import { startControlServer } from '../gateway/control-server.js';
import { SettingsStore } from '../gateway/settings.js';
import { GCAL_APP, GMAIL_APP } from '../tests/fixtures/sample-apps.js';

const claude = findClaude();
if (!claude) throw new Error('claude not found');
const root = process.cwd();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-measure-'));

const settings = new SettingsStore(null);
settings.setEnabled('gmail', true);
settings.setEnabled('gcal', true);
const calls: string[] = [];
const core = new GatewayCore({
  apps: () => [GMAIL_APP, GCAL_APP],
  settings,
  log: new ActivityLog(null),
  confirm: async () => false,
  executors: () => ({
    async call(ability) {
      calls.push(ability);
      return {
        text: [
          '1. Ravi <ravi@example.com> · Lunch tomorrow? · Sat, 7 Nov 2026 [id a1]',
          '   Shall we meet at 1pm near the office?',
          '2. HR <hr@example.com> · Leave policy update · Fri, 6 Nov 2026 [id a2]',
          '   Please review the attached leave policy.',
          '3. Asha <asha@example.com> · Design review · Fri, 6 Nov 2026 [id a3]',
          '   Slides for Monday are ready.',
        ].join('\n'),
      };
    },
  }),
});
const control = await startControlServer(() => core);

const brain = new ClaudeCLIBrain({
  command: claude,
  cwd: path.join(work, 'brain-cwd'),
  gateway: () => ({
    command: process.execPath,
    args: [path.join(root, 'gateway', 'shim.ts')],
    env: { JARVIS_CONTROL_URL: control.url, JARVIS_CONTROL_TOKEN: control.token },
  }),
  progressFor: (tool) => [GMAIL_APP, GCAL_APP].flatMap((a) => a.abilities).find((a) => tool.endsWith(`__${a.name}`))?.progress,
});

const progress: string[] = [];
const hello = await brain.ask('say hello', null, 'haiku');
const list = await brain.ask('list my 3 latest emails', null, 'haiku', { onProgress: (p) => progress.push(p) });
const followup = await brain.ask('who sent the second one?', list.session_id, 'haiku');
await control.close();

// Claude Code defaults: same request, same model, no Jarvis flags.
const defCwd = path.join(work, 'default-cwd');
fs.mkdirSync(defCwd);
const def = spawnSync(claude, ['-p', 'say hello', '--output-format', 'json', '--model', 'haiku'], {
  cwd: defCwd,
  env: sanitizeEnv(process.env).env,
  encoding: 'utf8',
  windowsHide: true,
});
const defJson = JSON.parse(def.stdout);
const defUsage = toUsage(defJson.usage);

const out = {
  jarvis: { tokens: hello.tokens_used, usage: hello.usage, reply: hello.reply, is_error: hello.is_error },
  defaults: { tokens: defUsage.total, usage: defUsage, reply: defJson.result, is_error: defJson.is_error },
  reduction: 1 - hello.tokens_used / defUsage.total,
  e2e: { reply: list.reply, gatewayCalls: calls, progress, tokens: list.tokens_used, is_error: list.is_error },
  followup: { reply: followup.reply, sameSession: followup.session_id === list.session_id, is_error: followup.is_error },
};
console.log(JSON.stringify(out, null, 2));
