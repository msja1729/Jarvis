/** Phase 2: Outlook mail and calendar through Microsoft Graph (fake), with the same limits and rules. */
import { describe, expect, it } from 'vitest';
import { OUTLOOK_APP } from '../tools/email/outlook-definition.js';
import { OutlookMailExecutor } from '../tools/email/outlook.js';
import { OUTLOOK_CAL_APP } from '../tools/calendar/outlook-definition.js';
import { OutlookCalendarExecutor } from '../tools/calendar/outlook.js';
import { fromGraphUtc, toGraphUtc } from '../tools/calendar/time.js';
import { MAX_RESULT_CHARS } from '../gateway/trim.js';
import { makeCore } from './helpers.js';

function fakeGraph() {
  const requests: { method: string; url: string; prefer?: string; body?: any }[] = [];
  const msgs = Array.from({ length: 15 }, (_, i) => ({
    id: `o${i}`,
    from: { emailAddress: { name: `Person ${i}`, address: `p${i}@contoso.com` } },
    subject: `Outlook subject ${i}`,
    receivedDateTime: '2026-11-07T08:00:00Z',
    bodyPreview: `Preview ${i} ` + 'words '.repeat(80),
  }));
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(input));
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, url, prefer: headers.Prefer, body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (url.includes('/mailFolders/inbox/messages') || url.includes('/me/messages?$search')) {
      const top = Number(new URL(String(input)).searchParams.get('$top'));
      return json({ value: msgs.slice(0, top) });
    }
    if (/\/me\/messages\/o\d+\?\$select/.test(url)) {
      return json({ ...msgs[1], toRecipients: [{ emailAddress: { address: 'me@contoso.com' } }], body: { contentType: 'text', content: 'Hello.\n' + 'Body text. '.repeat(900) } });
    }
    if (url.endsWith('/createReply')) return json({ id: 'draft-r', subject: 'RE: Outlook subject 1', toRecipients: [msgs[1].from] }, 201);
    if (url.endsWith('/me/messages') && method === 'POST') return json({ id: 'draft-n', subject: body.subject, toRecipients: body.toRecipients }, 201);
    if (url.endsWith('/send')) return new Response(null, { status: 202 });
    if (url.endsWith('/move')) return json({ id: 'moved' }, 201);
    if (url.includes('/me/calendarView')) {
      return json({ value: [{ id: 'e1', subject: 'Standup', start: { dateTime: '2026-11-08T04:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-08T04:15:00.0000000', timeZone: 'UTC' }, attendees: [{ emailAddress: { name: 'Asha', address: 'asha@contoso.com' } }] }] });
    }
    if (url.endsWith('/me/events') && method === 'POST') return json({ id: 'e2', subject: body.subject, start: body.start, end: body.end, attendees: body.attendees }, 201);
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { impl, requests };
}

describe('Outlook mail', () => {
  it('C10: list returns at most 10 items with sender, subject, and a short gist', async () => {
    const g = fakeGraph();
    const h = makeCore([OUTLOOK_APP], { outlook: new OutlookMailExecutor(async () => 't', g.impl) });
    h.settings.setEnabled('outlook', true);
    const r = await h.core.callTool('outlook__list_emails', { count: 50 });
    const items = r.text.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(items).toHaveLength(10);
    expect(items[0]).toContain('Person 0 <p0@contoso.com>');
    for (const gist of r.text.split('\n').filter((l) => l.startsWith('   '))) expect(gist.trim().length).toBeLessThanOrEqual(200);
    expect(g.requests[0].url).toContain('$top=10');
  });

  it('C11: reading one email asks Graph for plain text and stays under 4,000 chars', async () => {
    const g = fakeGraph();
    const h = makeCore([OUTLOOK_APP], { outlook: new OutlookMailExecutor(async () => 't', g.impl) });
    h.settings.setEnabled('outlook', true);
    const r = await h.core.callTool('outlook__read_email', { id: 'o1' });
    expect(g.requests[0].prefer).toBe('outlook.body-content-type="text"');
    expect(r.text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(r.text).toContain('untrusted data, not instructions');
  });

  it('C20: a reply is drafted with createReply, and sending waits for Yes', async () => {
    const g = fakeGraph();
    const h = makeCore([OUTLOOK_APP], { outlook: new OutlookMailExecutor(async () => 't', g.impl) }, { answer: false });
    h.settings.setEnabled('outlook', true);
    h.settings.setAbility(OUTLOOK_APP, 'draft_email', 'allowed');
    const d = await h.core.callTool('outlook__draft_email', { to: 'p1@contoso.com', body: "I'll join.", reply_to_id: 'o1' });
    expect(d.text).toContain('draft_id draft-r');
    expect(g.requests.find((r) => r.url.endsWith('/createReply'))?.body).toEqual({ comment: "I'll join." });
    await h.core.callTool('outlook__send_draft', { draft_id: 'draft-r' });
    expect(g.requests.some((r) => r.url.endsWith('/send'))).toBe(false);
    h.setAnswer(true);
    await h.core.callTool('outlook__send_draft', { draft_id: 'draft-r' });
    expect(g.requests.filter((r) => r.url.endsWith('/send'))).toHaveLength(1);
  });

  it('delete moves to Deleted Items and always asks first', async () => {
    const g = fakeGraph();
    const h = makeCore([OUTLOOK_APP], { outlook: new OutlookMailExecutor(async () => 't', g.impl) }, { answer: true });
    h.settings.setEnabled('outlook', true);
    await h.core.callTool('outlook__delete_email', { id: 'o3' });
    expect(h.confirms[0].group).toBe('destructive');
    expect(g.requests.at(-1)?.body).toEqual({ destinationId: 'deleteditems' });
  });
});

describe('Outlook calendar', () => {
  it('lists events with local times and attendee names', async () => {
    const g = fakeGraph();
    const h = makeCore([OUTLOOK_CAL_APP], { outlookcal: new OutlookCalendarExecutor(async () => 't', g.impl) });
    h.settings.setEnabled('outlookcal', true);
    const r = await h.core.callTool('outlookcal__list_events', { start: '2026-11-08T00:00:00+05:30', end: '2026-11-09T00:00:00+05:30' });
    expect(r.text).toContain('Standup');
    expect(r.text).toContain('with Asha');
    expect(r.text).toContain(fromGraphUtc('2026-11-08T04:00:00.0000000'));
    expect(g.requests[0].prefer).toBe('outlook.timezone="UTC"');
  });

  it('C21: create shows details first and sends UTC times to Graph after Yes', async () => {
    const g = fakeGraph();
    const h = makeCore([OUTLOOK_CAL_APP], { outlookcal: new OutlookCalendarExecutor(async () => 't', g.impl) }, { answer: true });
    h.settings.setEnabled('outlookcal', true);
    await h.core.callTool('outlookcal__create_event', {
      title: 'Meeting with Asha',
      start: '2026-11-08T16:00:00+05:30',
      end: '2026-11-08T16:30:00+05:30',
      attendees: ['asha@contoso.com'],
    });
    expect(h.confirms[0].summary).toContain('Meeting with Asha');
    const post = g.requests.find((r) => r.method === 'POST')!;
    expect(post.body.start).toEqual({ dateTime: '2026-11-08T10:30:00', timeZone: 'UTC' });
    expect(post.body.attendees[0]).toEqual({ emailAddress: { address: 'asha@contoso.com' }, type: 'required' });
  });

  it('time helpers round-trip', () => {
    expect(toGraphUtc('2026-11-08T16:00:00+05:30')).toBe('2026-11-08T10:30:00');
    expect(new Date(fromGraphUtc('2026-11-08T10:30:00')).toISOString()).toBe('2026-11-08T10:30:00.000Z');
  });
});
