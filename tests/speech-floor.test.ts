import { describe, expect, it } from 'vitest';
import { FloorQueue } from '../speech/floor-queue.js';
import { Floor } from '../speech/floor.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('one voice at a time', () => {
  it('a second window waits until the first has finished, then speaks', async () => {
    const q = new FloorQueue();
    const order: string[] = [];
    const ryanReply = q.take({ token: 'reply', owner: 1 }).then((ok) => order.push(`reply ${ok}`));
    const cardUpdate = q.take({ token: 'card', owner: 2 }).then((ok) => order.push(`card ${ok}`));
    await flush();
    expect(order).toEqual(['reply true']);
    expect(q.speaking).toBe('reply');
    q.release('reply');
    await cardUpdate;
    expect(order).toEqual(['reply true', 'card true']);
    await ryanReply;
  });

  it('withdrawing, a closed window and push-to-talk never leave anyone stuck', async () => {
    const q = new FloorQueue();
    await q.take({ token: 'a', owner: 1 });
    const b = q.take({ token: 'b', owner: 2 });
    q.release('b'); // b was stopped before its turn
    expect(await b).toBe(false);
    const c = q.take({ token: 'c', owner: 3 });
    q.dropOwner(1); // the window holding the floor closed
    expect(await c).toBe(true);
    const d = q.take({ token: 'd', owner: 4 });
    q.clear(); // push-to-talk: everyone stops
    expect(await d).toBe(false);
    expect(q.speaking).toBeNull();
    expect(await q.take({ token: 'e', owner: 5 })).toBe(true);
  });

  it('a window that never gives the turn back loses it after a while', async () => {
    let fire: (() => void) | null = null;
    const q = new FloorQueue(1000, { set: (f) => ((fire = f), 1), clear: () => undefined });
    await q.take({ token: 'stuck', owner: 1 });
    const next = q.take({ token: 'next', owner: 2 });
    fire!();
    expect(await next).toBe(true);
  });

  it("the window's side asks for the turn and gives it back", async () => {
    const q = new FloorQueue();
    const api = { speechFloor: (t: string, on: boolean) => (on ? q.take({ token: t, owner: 1 }) : (q.release(t), Promise.resolve(true))) };
    const a = new Floor(() => api);
    const b = new Floor(() => ({ speechFloor: (t: string, on: boolean) => (on ? q.take({ token: t, owner: 2 }) : (q.release(t), Promise.resolve(true))) }));
    expect(await a.take()).toBe(true);
    let bSpoke = false;
    const bTurn = b.take().then((ok) => (bSpoke = ok));
    await flush();
    expect(bSpoke).toBe(false);
    a.release();
    await bTurn;
    expect(bSpoke).toBe(true);
    // a window with no main process to share with speaks at once
    expect(await new Floor(() => null).take()).toBe(true);
  });
});
