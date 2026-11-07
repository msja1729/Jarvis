import { describe, expect, it } from 'vitest';
import { GMAIL_APP } from '../tools/email/definition.js';
import { GmailExecutor } from '../tools/email/gmail.js';
import { GCAL_APP } from '../tools/calendar/definition.js';
import { GoogleCalendarExecutor } from '../tools/calendar/google.js';
import { makeCore } from './helpers.js';
import { fakeGoogle } from './fake-google.js';

const inbox = Array.from({ length: 8 }, (_, i) => ({
  id: `m${i}`,
  from: `Sender ${i} <s${i}@example.com>`,
  subject: `Subject ${i}`,
  body: `Hello, this is message number ${i}. ` + 'More text. '.repeat(50),
}));

describe('C19 read latest mails', () => {
  it('C19 "read my 5 latest mails" lists 5 emails with sender, subject, gist in under 20 s', async () => {
    const g = fakeGoogle(inbox);
    const h = makeCore([GMAIL_APP], { gmail: new GmailExecutor(async () => 'tok', g.impl) });
    h.settings.setEnabled('gmail', true);
    const t0 = Date.now();
    const r = await h.core.callTool('gmail__list_emails', { count: 5 });
    expect(Date.now() - t0).toBeLessThan(20000);
    const items = r.text.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(items).toHaveLength(5);
    expect(items[0]).toContain('Sender 0');
    expect(items[0]).toContain('Subject 0');
    expect(r.text).toContain('Hello, this is message number 0');
  });
});

describe('C20 reply is drafted, not sent without Yes', () => {
  it('C20 draft is created directly; send waits for the popup', async () => {
    const g = fakeGoogle(inbox);
    const h = makeCore([GMAIL_APP], { gmail: new GmailExecutor(async () => 'tok', g.impl) }, { answer: false });
    h.settings.setEnabled('gmail', true);
    h.settings.setAbility(GMAIL_APP, 'draft_email', 'allowed');

    const draft = await h.core.callTool('gmail__draft_email', { to: 's1@example.com', body: "I'll join.", reply_to_id: 'm1' });
    expect(draft.text).toContain('Draft saved (not sent)');
    expect(draft.text).toContain("I'll join.");
    expect(h.confirms).toHaveLength(0);

    const declined = await h.core.callTool('gmail__send_draft', { draft_id: 'draft-1' });
    expect(declined.text).toBe('user declined');
    expect(h.confirms).toHaveLength(1);
    expect(g.requests.some((r) => r.url.endsWith('/drafts/send'))).toBe(false);

    h.setAnswer(true);
    const sent = await h.core.callTool('gmail__send_draft', { draft_id: 'draft-1' });
    expect(sent.text).toContain('Sent');
    expect(g.requests.filter((r) => r.url.endsWith('/drafts/send'))).toHaveLength(1);
  });
});

describe('C21 schedule a meeting', () => {
  it('C21 popup shows the event details; event is created only after Yes', async () => {
    const g = fakeGoogle();
    const h = makeCore([GCAL_APP], { gcal: new GoogleCalendarExecutor(async () => 'tok', g.impl) }, { answer: true });
    h.settings.setEnabled('gcal', true);
    const input = { title: 'Meeting with Asha', start: '2026-11-08T16:00:00+05:30', end: '2026-11-08T16:30:00+05:30', attendees: ['asha@example.com'] };
    const r = await h.core.callTool('gcal__create_event', input);
    expect(h.confirms[0].summary).toContain('Meeting with Asha');
    expect(h.confirms[0].summary).toContain('2026-11-08T16:00:00+05:30');
    expect(r.text).toContain('Event created');
    const post = g.requests.find((x) => x.method === 'POST');
    expect(post?.body.summary).toBe('Meeting with Asha');
    expect(post?.body.attendees).toEqual([{ email: 'asha@example.com' }]);
  });
});

// C22-C25 are covered in phase3.test.ts and phase4.test.ts.
