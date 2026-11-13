/**
 * One voice at a time, across all of Jarvis's windows (main window, voice card, coding card, lesson):
 * a window asks for the floor before it plays a voice and gives it back when it has finished.
 * The others wait their turn, in order. Runs in the main process; no Electron imports, so it is tested.
 */
export interface FloorRequest {
  token: string;
  /** Which window asked (so a closed window's turn is dropped). */
  owner: number;
}

interface Waiting extends FloorRequest {
  grant(ok: boolean): void;
}

export class FloorQueue {
  private holder: (FloorRequest & { timer: unknown }) | null = null;
  private waiting: Waiting[] = [];

  constructor(
    /** The longest one window may keep the floor (a stuck window must not silence everyone). */
    private readonly maxHoldMs = 180_000,
    private readonly timers: { set(f: () => void, ms: number): unknown; clear(h: unknown): void } = {
      set: (f, ms) => setTimeout(f, ms),
      clear: (h) => clearTimeout(h as NodeJS.Timeout),
    },
  ) {}

  /** Resolves true when it is this window's turn, or false if the request was withdrawn first. */
  take(req: FloorRequest): Promise<boolean> {
    return new Promise((grant) => {
      this.waiting.push({ ...req, grant });
      this.pump();
    });
  }

  /** The window finished speaking, stopped, or no longer wants its turn. */
  release(token: string): void {
    if (this.holder?.token === token) {
      this.timers.clear(this.holder.timer);
      this.holder = null;
      this.pump();
      return;
    }
    const i = this.waiting.findIndex((w) => w.token === token);
    if (i >= 0) this.waiting.splice(i, 1)[0].grant(false);
  }

  /** A window closed: its turn, and anything it was waiting for, are dropped. */
  dropOwner(owner: number): void {
    for (const w of this.waiting.filter((x) => x.owner === owner)) this.release(w.token);
    if (this.holder?.owner === owner) this.release(this.holder.token);
  }

  /** Push-to-talk / stop: everyone stops speaking, nobody is waiting. */
  clear(): void {
    if (this.holder) this.timers.clear(this.holder.timer);
    this.holder = null;
    for (const w of this.waiting.splice(0)) w.grant(false);
  }

  get speaking(): string | null {
    return this.holder?.token ?? null;
  }

  get queued(): number {
    return this.waiting.length;
  }

  private pump() {
    if (this.holder) return;
    const next = this.waiting.shift();
    if (!next) return;
    const timer = this.timers.set(() => this.holder?.token === next.token && this.release(next.token), this.maxHoldMs);
    this.holder = { token: next.token, owner: next.owner, timer };
    next.grant(true);
  }
}
