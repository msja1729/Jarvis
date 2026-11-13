import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCLIBrain } from '../brain/claude-cli.js';
import { tmpDir } from './helpers.js';

/**
 * A fake `claude` that answers and then stays open, like a real run after the member started a
 * website in the background (the website keeps the process alive). The reply must still arrive.
 */
const STAYS_OPEN = `
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'system', subtype: 'init', session_id: 's1', tools: [], mcp_servers: [], model: 'claude-opus-5-5' });
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'The website is running at localhost:8501.' }] }, session_id: 's1' });
out({ type: 'result', subtype: 'success', is_error: false, result: 'The website is running at localhost:8501.', session_id: 's1', usage: { input_tokens: 1, output_tokens: 5 } });
setInterval(() => {}, 1000); // the background server: never ends by itself
`;

/**
 * What Claude Code really prints when a conversation continues after something it started is still
 * running: an empty result for that background task first (0 turns), then the real work (here with a
 * 4-second wait, like a permission popup), then the answer, and the process stays open.
 */
const RESUMED = `
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'system', subtype: 'task_notification' });
out({ type: 'system', subtype: 'init', session_id: 's1', tools: [], mcp_servers: [], model: 'claude-opus-5-5' });
out({ type: 'result', subtype: 'success', is_error: false, result: '', num_turns: 0, session_id: 's1', usage: { input_tokens: 0, output_tokens: 0 } });
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Checking it is still up.' }] }, session_id: 's1' });
setTimeout(() => {
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Yes, it is at localhost:8766.' }] }, session_id: 's1' });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Yes, it is at localhost:8766.', num_turns: 2, terminal_reason: 'completed', session_id: 's1', usage: { input_tokens: 1, output_tokens: 9 } });
}, 4000);
setInterval(() => {}, 1000);
`;

describe('a reply never hangs', () => {
  it('waits past the early empty result of a continued conversation, and returns the real answer', async () => {
    const dir = tmpDir();
    const stub = path.join(dir, 'claude-resumed.mjs');
    fs.writeFileSync(stub, RESUMED);
    const brain = new ClaudeCLIBrain({ command: process.execPath, prefixArgs: [stub], cwd: path.join(dir, 'cwd'), gateway: () => null });
    const r = await brain.ask('is it still up?', 's1', 'opus');
    expect(r.is_error).toBe(false);
    expect(r.reply).toBe('Yes, it is at localhost:8766.');
  }, 20_000);

  it('arrives as soon as Claude has answered, even when something it started keeps running', async () => {
    const dir = tmpDir();
    const stub = path.join(dir, 'claude-stays-open.mjs');
    fs.writeFileSync(stub, STAYS_OPEN);
    const brain = new ClaudeCLIBrain({ command: process.execPath, prefixArgs: [stub], cwd: path.join(dir, 'cwd'), gateway: () => null });
    const t0 = Date.now();
    const r = await brain.ask('run the website', null, 'opus');
    expect(r.is_error).toBe(false);
    expect(r.reply).toBe('The website is running at localhost:8501.');
    // not "never": a few seconds at most
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 20_000);
});
