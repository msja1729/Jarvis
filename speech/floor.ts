/**
 * The window's side of "one voice at a time" (see floor-queue.ts): wait for the turn before
 * playing a voice, give it back when finished or stopped.
 */
export interface FloorApi {
  /** on = ask for the turn (resolves true when granted, false if withdrawn); off = give it back. */
  speechFloor?(token: string, on: boolean): Promise<boolean>;
}

export class Floor {
  private token: string | null = null;
  private seq = 0;

  constructor(private readonly api: () => FloorApi | null) {}

  /** Waits for this window's turn. False if it was given back (stopped) before the turn came. */
  async take(): Promise<boolean> {
    this.release();
    const f = this.api()?.speechFloor;
    const token = `${Date.now().toString(36)}-${++this.seq}-${Math.random().toString(36).slice(2, 8)}`;
    this.token = token;
    if (!f) return true; // no main process to share with (tests, old preload): speak at once
    const ok = await f(token, true).catch(() => true);
    return ok && this.token === token;
  }

  /** Gives the turn back (or withdraws the wish to speak). */
  release(): void {
    const t = this.token;
    if (!t) return;
    this.token = null;
    void this.api()?.speechFloor?.(t, false).catch(() => undefined);
  }

  /** The current turn, to give back later only if no newer speech took its place. */
  get current(): string | null {
    return this.token;
  }

  releaseIf(token: string | null): void {
    if (token && this.token === token) this.release();
  }
}
