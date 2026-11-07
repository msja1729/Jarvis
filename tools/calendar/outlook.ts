/** Outlook calendar executor (Microsoft Graph v1.0). Times are exchanged in UTC. */
import type { AppExecutor, RawResult } from '../../gateway/types.js';
import { graph } from '../email/outlook.js';
import { fromGraphUtc, toGraphUtc } from './time.js';
import { CalendarEvent, formatEvents, MAX_EVENTS } from './trim.js';

interface GraphEvent {
  id: string;
  subject?: string;
  start?: { dateTime: string; timeZone?: string };
  end?: { dateTime: string; timeZone?: string };
  attendees?: { emailAddress?: { name?: string; address?: string } }[];
}

const UTC = 'outlook.timezone="UTC"';

export class OutlookCalendarExecutor implements AppExecutor {
  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private api<T>(path: string, init?: RequestInit & { prefer?: string }) {
    return graph<T>(this.getToken, this.fetchImpl, path, init);
  }

  async call(ability: string, input: Record<string, unknown>): Promise<RawResult> {
    switch (ability) {
      case 'list_events': {
        const q = new URLSearchParams({
          startDateTime: new Date(String(input.start)).toISOString(),
          endDateTime: new Date(String(input.end)).toISOString(),
          $top: String(MAX_EVENTS + 1),
          $select: 'id,subject,start,end,attendees',
          $orderby: 'start/dateTime',
        });
        const res = await this.api<{ value?: GraphEvent[] }>(`/me/calendarView?${q}`, { prefer: UTC });
        return { text: formatEvents((res.value ?? []).map(toEvent)) };
      }
      case 'create_event': {
        const attendees = Array.isArray(input.attendees) ? (input.attendees as string[]) : [];
        const ev = await this.api<GraphEvent>('/me/events', {
          method: 'POST',
          prefer: UTC,
          body: JSON.stringify({
            subject: String(input.title),
            start: { dateTime: toGraphUtc(String(input.start)), timeZone: 'UTC' },
            end: { dateTime: toGraphUtc(String(input.end)), timeZone: 'UTC' },
            attendees: attendees.map((address) => ({ emailAddress: { address }, type: 'required' })),
          }),
        });
        return { text: `Event created.\n${formatEvents([toEvent(ev)])}` };
      }
      case 'delete_event':
        await this.api(`/me/events/${encodeURIComponent(String(input.id))}`, { method: 'DELETE' });
        return { text: 'Event deleted.' };
      default:
        throw new Error(`unknown Outlook Calendar ability ${ability}`);
    }
  }
}

function toEvent(e: GraphEvent): CalendarEvent {
  return {
    id: e.id,
    title: e.subject ?? '(no title)',
    start: e.start ? fromGraphUtc(e.start.dateTime) : '',
    end: e.end ? fromGraphUtc(e.end.dateTime) : '',
    attendees: (e.attendees ?? []).map((a) => ({ email: a.emailAddress?.address ?? '', name: a.emailAddress?.name })),
  };
}
