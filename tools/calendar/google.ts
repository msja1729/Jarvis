/** Google Calendar executor (REST v3, primary calendar). */
import type { AppExecutor, RawResult } from '../../gateway/types.js';
import { CalendarEvent, formatEvents, MAX_EVENTS } from './trim.js';

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary';

interface GEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email: string; displayName?: string }[];
}

export class GoogleCalendarExecutor implements AppExecutor {
  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getToken();
    const res = await this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Calendar ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async call(ability: string, input: Record<string, unknown>): Promise<RawResult> {
    switch (ability) {
      case 'list_events': {
        const q = new URLSearchParams({
          timeMin: String(input.start),
          timeMax: String(input.end),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: String(MAX_EVENTS + 1),
        });
        const res = await this.api<{ items?: GEvent[] }>(`/events?${q}`);
        return { text: formatEvents((res.items ?? []).map(toEvent)) };
      }
      case 'create_event': {
        const attendees = Array.isArray(input.attendees) ? (input.attendees as string[]) : [];
        const ev = await this.api<GEvent>('/events?sendUpdates=all', {
          method: 'POST',
          body: JSON.stringify({
            summary: String(input.title),
            start: { dateTime: String(input.start) },
            end: { dateTime: String(input.end) },
            attendees: attendees.map((email) => ({ email })),
          }),
        });
        return { text: `Event created.\n${formatEvents([toEvent(ev)])}` };
      }
      case 'delete_event':
        await this.api(`/events/${encodeURIComponent(String(input.id))}`, { method: 'DELETE' });
        return { text: 'Event deleted.' };
      default:
        throw new Error(`unknown Calendar ability ${ability}`);
    }
  }
}

function toEvent(e: GEvent): CalendarEvent {
  return {
    id: e.id,
    title: e.summary ?? '(no title)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    attendees: (e.attendees ?? []).map((a) => ({ email: a.email, name: a.displayName })),
  };
}
