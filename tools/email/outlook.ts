/** Outlook mail executor (Microsoft Graph v1.0). */
import type { AppExecutor, RawResult } from '../../gateway/types.js';
import { formatEmail, formatEmailList, MAX_LIST_ITEMS } from './trim.js';

export const GRAPH = 'https://graph.microsoft.com/v1.0';

interface Addr { emailAddress?: { name?: string; address?: string } }
interface GraphMessage {
  id: string;
  from?: Addr;
  toRecipients?: Addr[];
  subject?: string;
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
}

const who = (a?: Addr) => {
  const e = a?.emailAddress;
  if (!e) return '';
  return e.name && e.address ? `${e.name} <${e.address}>` : (e.name ?? e.address ?? '');
};

export async function graph<T>(
  getToken: () => Promise<string>,
  fetchImpl: typeof fetch,
  path: string,
  init: RequestInit & { prefer?: string } = {},
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (init.prefer) headers.Prefer = init.prefer;
  const res = await fetchImpl(`${GRAPH}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`Microsoft ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (res.status === 202 || res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export class OutlookMailExecutor implements AppExecutor {
  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private api<T>(path: string, init?: RequestInit & { prefer?: string }) {
    return graph<T>(this.getToken, this.fetchImpl, path, init);
  }

  async call(ability: string, input: Record<string, unknown>): Promise<RawResult> {
    switch (ability) {
      case 'list_emails':
        return { text: await this.list(String(input.query ?? ''), Number(input.count ?? MAX_LIST_ITEMS)) };
      case 'read_email': {
        const m = await this.api<GraphMessage>(
          `/me/messages/${encodeURIComponent(String(input.id))}?$select=from,toRecipients,subject,receivedDateTime,body`,
          { prefer: 'outlook.body-content-type="text"' },
        );
        return {
          text: formatEmail({
            id: m.id,
            from: who(m.from),
            to: (m.toRecipients ?? []).map(who).join(', '),
            subject: m.subject ?? '',
            date: m.receivedDateTime ?? '',
            text: '',
            body: m.body?.content ?? '',
          }),
        };
      }
      case 'draft_email':
        return { text: await this.draft(input) };
      case 'send_draft':
        await this.api(`/me/messages/${encodeURIComponent(String(input.draft_id))}/send`, { method: 'POST' });
        return { text: 'Sent.' };
      case 'delete_email':
        await this.api(`/me/messages/${encodeURIComponent(String(input.id))}/move`, {
          method: 'POST',
          body: JSON.stringify({ destinationId: 'deleteditems' }),
        });
        return { text: 'Moved to Deleted Items.' };
      default:
        throw new Error(`unknown Outlook ability ${ability}`);
    }
  }

  private async list(query: string, count: number): Promise<string> {
    const n = Math.max(1, Math.min(count || MAX_LIST_ITEMS, MAX_LIST_ITEMS));
    const select = '$select=id,from,subject,receivedDateTime,bodyPreview';
    const path = query
      ? `/me/messages?$search=${encodeURIComponent(`"${query.replace(/"/g, '')}"`)}&$top=${n}&${select}`
      : `/me/mailFolders/inbox/messages?$top=${n}&${select}&$orderby=receivedDateTime%20desc`;
    const res = await this.api<{ value?: GraphMessage[] }>(path);
    return formatEmailList(
      (res.value ?? []).map((m) => ({
        id: m.id,
        from: who(m.from),
        subject: m.subject ?? '',
        date: m.receivedDateTime ?? '',
        text: m.bodyPreview ?? '',
      })),
      n,
    );
  }

  private async draft(input: Record<string, unknown>): Promise<string> {
    const body = String(input.body ?? '');
    let draft: GraphMessage;
    if (input.reply_to_id) {
      draft = await this.api<GraphMessage>(`/me/messages/${encodeURIComponent(String(input.reply_to_id))}/createReply`, {
        method: 'POST',
        body: JSON.stringify({ comment: body }),
      });
    } else {
      draft = await this.api<GraphMessage>('/me/messages', {
        method: 'POST',
        body: JSON.stringify({
          subject: String(input.subject ?? ''),
          body: { contentType: 'Text', content: body },
          toRecipients: String(input.to ?? '')
            .split(/[;,]/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((address) => ({ emailAddress: { address } })),
        }),
      });
    }
    const to = (draft.toRecipients ?? []).map(who).join(', ') || String(input.to ?? '');
    return `Draft saved (not sent). draft_id ${draft.id}\nTo: ${to}\nSubject: ${draft.subject ?? input.subject ?? ''}\n\n${body}`;
  }
}
