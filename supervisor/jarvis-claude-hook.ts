/**
 * The tiny script Claude Code runs (as a hook) for sessions the user starts
 * themselves. It forwards "finished" / "needs you" to Jarvis and always exits
 * at once with success, so it can never slow down or block Claude Code.
 *
 * argv[2]: the endpoint file Jarvis writes at start ({ url, token }); the token
 * only opens the /hook route.
 */
import fs from 'node:fs';

async function main() {
  // sessions Jarvis already supervises report through the supervisor instead
  if (process.env.JARVIS_SUPERVISED === '1') return;
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const ev = JSON.parse(input || '{}') as Record<string, unknown>;
  const { url, token } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as { url: string; token: string };
  const body = {
    event: ev.hook_event_name,
    cwd: ev.cwd,
    message: typeof ev.message === 'string' ? ev.message.slice(0, 500) : undefined,
    last: typeof ev.last_assistant_message === 'string' ? ev.last_assistant_message.slice(0, 1500) : undefined,
    session: ev.session_id,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  await fetch(`${url}/hook`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal }).catch(() => undefined);
  clearTimeout(timer);
}

main()
  .catch(() => undefined)
  .finally(() => process.exit(0));
