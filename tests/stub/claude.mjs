#!/usr/bin/env node
// Stub `claude` for tests: replays recorded stream-json and records argv + env.
// Env: JARVIS_STUB_CAPTURE (jsonl file), JARVIS_STUB_SCENARIO (hello|limit|tool|memory),
//      JARVIS_STUB_AUTH (in|out), JARVIS_STUB_STATE (dir for the memory scenario).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

if (process.env.JARVIS_STUB_CAPTURE) {
  const anthropic = Object.keys(process.env).filter((k) => /anthropic/i.test(k));
  fs.appendFileSync(
    process.env.JARVIS_STUB_CAPTURE,
    JSON.stringify({ argv, anthropicVars: anthropic, cwd: process.cwd(), mcpTimeout: process.env.MCP_TOOL_TIMEOUT ?? null }) + '\n',
  );
}

if (argv[0] === 'auth' && argv[1] === 'status') {
  const loggedIn = process.env.JARVIS_STUB_AUTH !== 'out';
  process.stdout.write(JSON.stringify({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none', email: 'stub@example.com' }));
  process.exit(0);
}

const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const prompt = flag('-p') ?? '';
const resume = flag('--resume');
const session = resume ?? crypto.randomUUID();
const scenario = process.env.JARVIS_STUB_SCENARIO ?? 'hello';
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');

if (scenario === 'memory') {
  const dir = process.env.JARVIS_STUB_STATE;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session}.json`);
  const history = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const reply = history.length ? `Earlier you asked: ${history.join(' / ')}` : 'First message in this conversation.';
  history.push(prompt.replace(/^\[now:[^\]]*\]\s*/, ''));
  fs.writeFileSync(file, JSON.stringify(history));
  emit({ type: 'system', subtype: 'init', session_id: session, model: 'claude-haiku-5-5', tools: [] });
  emit({ type: 'result', subtype: 'success', is_error: false, result: reply, session_id: session, usage: { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000, output_tokens: 10 } });
  process.exit(0);
}

const fixture = path.join(here, '..', 'fixtures', `${scenario}.jsonl`);
for (const line of fs.readFileSync(fixture, 'utf8').split('\n').filter(Boolean)) {
  const ev = JSON.parse(line);
  if ('session_id' in ev) ev.session_id = session;
  emit(ev);
}
