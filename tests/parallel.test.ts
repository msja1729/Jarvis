import { describe, expect, it } from 'vitest';
import { Orchestrator } from '../app/orchestrator.js';
import type { Brain, BrainResult } from '../brain/brain.js';
import { SessionManager } from '../brain/session.js';
import { UsageLog } from '../brain/usage.js';

describe('members work at the same time', () => {
  it('two members answer in parallel; the same member answers one request after the other', async () => {
    const log: string[] = [];
    const open = new Map<string, () => void>();
    const brain: Brain = {
      ask: (text, _sid, _model, opts) =>
        new Promise<BrainResult>((resolve) => {
          const q = text.replace(/^.*\] /, '');
          log.push(`start ${opts?.role} ${q}`);
          open.set(q, () => {
            log.push(`end ${opts?.role} ${q}`);
            resolve({ reply: `ok ${q}`, is_error: false, session_id: `s-${opts?.role}`, tokens_used: 1 } as BrainResult);
          });
        }),
    };
    const orch = new Orchestrator({ brain, sessions: new SessionManager(), usage: new UsageLog(null, null), runLocal: () => 'x' });
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const a = orch.handle('plan my week', 'pa');
    const b = orch.handle('how is my project', 'pm');
    const c = orch.handle('and next week', 'pa');
    await flush();
    // Maya and Ryan are both working; Maya's second request waits for her first
    expect(log).toEqual(['start pa plan my week', 'start pm how is my project']);
    expect(orch.isBusy).toBe(true);
    open.get('how is my project')!();
    expect((await b).reply).toBe('ok how is my project');
    open.get('plan my week')!();
    await a;
    await flush();
    expect(log.at(-1)).toBe('start pa and next week');
    open.get('and next week')!();
    await c;
    expect(orch.isBusy).toBe(false);
  });
});
