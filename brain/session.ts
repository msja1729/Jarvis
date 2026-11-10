/** Short sessions (T6, criterion 13): new session after 10 min idle or 20 turns, or on request. */

export const IDLE_MS = 10 * 60 * 1000;
export const MAX_TURNS_PER_SESSION = 20;

export interface SessionDecision {
  sessionId: string | null;
  /** True when a previous session was dropped; the UI shows "new conversation started". */
  startedNew: boolean;
}

export class SessionManager {
  private id: string | null = null;
  private turns = 0;
  private lastActive = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Call before each brain request. */
  current(): SessionDecision {
    if (this.id === null) return { sessionId: null, startedNew: false };
    const idle = this.now() - this.lastActive >= IDLE_MS;
    if (idle || this.turns >= MAX_TURNS_PER_SESSION) {
      this.reset();
      return { sessionId: null, startedNew: true };
    }
    return { sessionId: this.id, startedNew: false };
  }

  /** Call after each brain request with the id the CLI returned. */
  record(sessionId: string | null): void {
    if (sessionId && sessionId !== this.id) {
      this.id = sessionId;
      this.turns = 0;
    }
    this.turns += 1;
    this.lastActive = this.now();
  }

  /** Continue an earlier Claude session (an older conversation the user picked up again). */
  restore(sessionId: string): void {
    this.id = sessionId;
    this.turns = 0;
    this.lastActive = this.now();
  }

  reset(): void {
    this.id = null;
    this.turns = 0;
  }

  get turnCount(): number {
    return this.turns;
  }
}
