/** Calendar trimming (T5): max 20 items; title, start, end, attendee names. */
import { capText, oneLine } from '../../gateway/trim.js';

export const MAX_EVENTS = 20;

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: { name?: string; email: string }[];
}

export function formatEvents(events: CalendarEvent[]): string {
  const shown = events.slice(0, MAX_EVENTS);
  if (shown.length === 0) return 'No events in that range.';
  const lines = shown.map((e, i) => {
    const names = e.attendees.map((a) => a.name || a.email.split('@')[0]).join(', ');
    return `${i + 1}. [id ${oneLine(e.id, 40)}] ${oneLine(e.title, 100)} | ${e.start} → ${e.end}${names ? ` | with ${oneLine(names, 200)}` : ''}`;
  });
  const more = events.length > MAX_EVENTS ? `\n(${events.length - MAX_EVENTS} more not shown)` : '';
  return capText(lines.join('\n') + more, 6000);
}
