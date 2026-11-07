/** Gmail executor (REST v1). The OAuth token comes from the OS secure store. */
import type { AppExecutor, RawResult } from '../../gateway/types.js';
import { EmailSummary, FullEmail, formatEmail, formatEmailList, MAX_LIST_ITEMS } from './trim.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

type Fetch = typeof fetch;

interface GmailHeader { name: string; value: string }
interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: GmailHeader[] }
interface GmailMessage { id: string; threadId: string; snippet?: string; payload?: GmailPart }

function b64urlDecode(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function b64urlEncode(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/** Prefer text/plain; fall back to text/html (converted later). */
export function extractBody(part: GmailPart | undefined): string {
  if (!part) return '';
  const flat: GmailPart[] = [];
  const walk = (p: GmailPart) => {
    flat.push(p);
    p.parts?.forEach(walk);
  };
  walk(part);
  const plain = flat.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  if (plain) return b64urlDecode(plain.body!.data!);
  const html = flat.find((p) => p.mimeType === 'text/html' && p.body?.data);
  if (html) return b64urlDecode(html.body!.data!);
  return part.body?.data ? b64urlDecode(part.body.data) : '';
}

export class GmailExecutor implements AppExecutor {
  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getToken();
    const res = await this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  async call(ability: string, input: Record<string, unknown>): Promise<RawResult> {
    switch (ability) {
      case 'list_emails':
        return { text: await this.list(String(input.query ?? ''), Number(input.count ?? MAX_LIST_ITEMS)) };
      case 'read_email':
        return { text: await this.read(String(input.id)) };
      case 'draft_email':
        return { text: await this.draft(input) };
      case 'send_draft': {
        const sent = await this.api<{ id: string }>('/drafts/send', {
          method: 'POST',
          body: JSON.stringify({ id: String(input.draft_id) }),
        });
        return { text: `Sent. Message id ${sent.id}.` };
      }
      case 'delete_email':
        await this.api(`/messages/${encodeURIComponent(String(input.id))}/trash`, { method: 'POST' });
        return { text: 'Moved to trash.' };
      default:
        throw new Error(`unknown Gmail ability ${ability}`);
    }
  }

  private async list(query: string, count: number): Promise<string> {
    const n = Math.max(1, Math.min(count || MAX_LIST_ITEMS, MAX_LIST_ITEMS));
    const q = new URLSearchParams({ maxResults: String(n) });
    if (query) q.set('q', query);
    const ids = await this.api<{ messages?: { id: string }[] }>(`/messages?${q}`);
    const summaries: EmailSummary[] = [];
    for (const { id } of ids.messages ?? []) {
      const m = await this.api<GmailMessage>(
        `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      summaries.push({ id, from: header(m, 'From'), subject: header(m, 'Subject'), date: header(m, 'Date'), text: m.snippet ?? '' });
    }
    return formatEmailList(summaries, n);
  }

  private async read(id: string): Promise<string> {
    const m = await this.api<GmailMessage>(`/messages/${encodeURIComponent(id)}?format=full`);
    const full: FullEmail = {
      id,
      from: header(m, 'From'),
      to: header(m, 'To'),
      subject: header(m, 'Subject'),
      date: header(m, 'Date'),
      text: '',
      body: extractBody(m.payload),
    };
    return formatEmail(full);
  }

  private async draft(input: Record<string, unknown>): Promise<string> {
    let threadId: string | undefined;
    let subject = String(input.subject ?? '');
    const headers: string[] = [`To: ${String(input.to)}`];
    if (input.reply_to_id) {
      const orig = await this.api<GmailMessage>(
        `/messages/${encodeURIComponent(String(input.reply_to_id))}?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID`,
      );
      threadId = orig.threadId;
      const origSubject = header(orig, 'Subject');
      subject ||= /^re:/i.test(origSubject) ? origSubject : `Re: ${origSubject}`;
      const mid = header(orig, 'Message-ID');
      if (mid) headers.push(`In-Reply-To: ${mid}`, `References: ${mid}`);
    }
    headers.push(`Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"');
    const raw = b64urlEncode(`${headers.join('\r\n')}\r\n\r\n${String(input.body)}`);
    const draft = await this.api<{ id: string }>('/drafts', {
      method: 'POST',
      body: JSON.stringify({ message: { raw, threadId } }),
    });
    return `Draft saved (not sent). draft_id ${draft.id}\nTo: ${String(input.to)}\nSubject: ${subject}\n\n${String(input.body)}`;
  }
}
