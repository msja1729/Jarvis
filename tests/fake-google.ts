/** Minimal fake Gmail + Calendar REST APIs for tests. */
const b64 = (s: string) => Buffer.from(s).toString('base64url');

export function fakeGoogle(messages: { id: string; from: string; subject: string; body: string }[] = []) {
  const requests: { method: string; url: string; body?: any }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/messages?')) {
      const max = Number(new URL(url).searchParams.get('maxResults'));
      return json({ messages: messages.slice(0, max).map((m) => ({ id: m.id })) });
    }
    const msg = url.match(/\/messages\/([^/?]+)\?format=(\w+)/);
    if (msg) {
      const m = messages.find((x) => x.id === msg[1])!;
      const headers = [
        { name: 'From', value: m.from },
        { name: 'Subject', value: m.subject },
        { name: 'Date', value: 'Sat, 7 Nov 2026 09:00:00 +0530' },
        { name: 'Message-ID', value: `<${m.id}@mail>` },
      ];
      return json({ id: m.id, threadId: `t${m.id}`, snippet: m.body.slice(0, 120), payload: { mimeType: 'text/plain', headers, body: { data: b64(m.body) } } });
    }
    if (url.endsWith('/drafts') && method === 'POST') return json({ id: 'draft-1' });
    if (url.endsWith('/drafts/send')) return json({ id: 'sent-1' });
    if (url.includes('/trash')) return json({});
    if (url.includes('/events') && method === 'POST') {
      const b = JSON.parse(String(init!.body));
      return json({ id: 'ev1', summary: b.summary, start: b.start, end: b.end, attendees: b.attendees });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { impl, requests };
}

