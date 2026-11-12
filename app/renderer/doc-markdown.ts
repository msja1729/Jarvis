/**
 * Markdown for documents in the preview (fuller than chat replies): headings, paragraphs, **bold**,
 * *italic*, ~~struck~~, `code`, fenced code (with its language), ```mermaid diagrams, tables (with
 * alignment), nested bullet / numbered / task lists, quotes, rules, links and pictures.
 * Everything is escaped first, so a file can never inject HTML; code and diagrams are left as marked
 * placeholders that the preview page fills in itself (highlighting, Mermaid in strict mode).
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface DocOptions {
  /** Where a relative link or picture points (e.g. to a team file); null drops it. */
  resolve(href: string, kind: 'link' | 'image'): { href: string; external: boolean } | null;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
}

function inline(src: string, o: DocOptions): string {
  const keep: string[] = [];
  const hold = (html: string) => `\u0000${keep.push(html) - 1}\u0000`;
  let t = src.replace(/`([^`\n]+)`/g, (_m, c: string) => hold(`<code>${esc(c)}</code>`));
  // pictures, then links (before escaping, so the address is read as written)
  t = t.replace(/!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_m, alt: string, href: string) => {
    const r = o.resolve(href, 'image');
    return r ? hold(`<img src="${esc(r.href)}" alt="${esc(alt)}" loading="lazy">`) : hold(`<span class="missing">[${esc(alt || 'picture')}]</span>`);
  });
  t = t.replace(/\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_m, label: string, href: string) => {
    const r = o.resolve(href, 'link');
    const text = inlineText(label);
    if (!r) return hold(text);
    return hold(r.external ? `<a href="${esc(r.href)}" target="_blank" rel="noreferrer">${text}</a>` : `<a href="#" data-open="${esc(r.href)}">${text}</a>`);
  });
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (_m, pre: string, url: string) => `${pre}${hold(`<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a>`)}`);
  t = inlineText(t);
  return t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => keep[Number(i)]);
}

/** Emphasis on already-held text (escapes it). */
function inlineText(s: string): string {
  return esc(s)
    .replace(/\*\*\*(?=\S)([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([^_]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([^~]+?)~~/g, '<del>$1</del>')
    .replace(/ {2,}$/g, '<br>');
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

interface ListItem { text: string[]; task: boolean | null; children: string[] }

/** Markdown → safe HTML for the preview. */
export function renderDoc(src: string, o: DocOptions): string {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  // front matter (--- … ---) at the very top is metadata, not text
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0 && end < 40) lines.splice(0, end + 1);
  }
  return blocks(lines, o);
}

function blocks(lines: string[], o: DocOptions): string {
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(l, o)).join('<br>')}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/);
    if (fence) {
      flush();
      const code: string[] = [];
      const close = new RegExp(`^\\s*${fence[2][0] === '`' ? '`' : '~'}{${fence[2].length},}\\s*$`);
      while (++i < lines.length && !close.test(lines[i])) code.push(lines[i]);
      const lang = fence[3].toLowerCase();
      if (lang === 'mermaid') out.push(`<div class="diagram" data-mermaid="${esc(code.join('\n'))}"></div>`);
      else out.push(`<pre><code${lang ? ` data-lang="${esc(lang)}"` : ''}>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flush();
      const n = heading[1].length;
      const html = inline(heading[2], o);
      out.push(`<h${n} id="${esc(slug(html))}">${html}</h${n}>`);
      continue;
    }
    // Setext headings (Title / =====)
    if (para.length === 1 && /^\s*(=+|-+)\s*$/.test(line) && !/^\s*-\s*$/.test(line)) {
      const n = line.trim()[0] === '=' ? 1 : 2;
      const html = inline(para[0], o);
      para = [];
      out.push(`<h${n} id="${esc(slug(html))}">${html}</h${n}>`);
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push('<hr>');
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      i--;
      out.push(`<blockquote>${blocks(quote, o)}</blockquote>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush();
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      const at = (k: number) => (align[k] ? ` style="text-align:${align[k]}"` : '');
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      i--;
      out.push(
        `<div class="table"><table><thead><tr>${head.map((c, k) => `<th${at(k)}>${inline(c, o)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_h, k) => `<td${at(k)}>${inline(r[k] ?? '', o)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
      continue;
    }
    const item = line.match(/^(\s*)([-*+•]|\d+[.)])\s+(.*)$/);
    if (item) {
      flush();
      const consumed = list(lines, i, o);
      out.push(consumed.html);
      i = consumed.next - 1;
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}

/** A list starting at line `start` (with nested lists and task boxes); returns the HTML and the next line. */
function list(lines: string[], start: number, o: DocOptions): { html: string; next: number } {
  const first = lines[start].match(/^(\s*)([-*+•]|\d+[.)])\s+/)!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items: ListItem[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      // a blank line ends the list unless the next line continues it (indented, or another item)
      const next = lines[i + 1];
      if (next !== undefined && (next.match(/^(\s*)/)![1].length > indent || new RegExp(`^\\s{${indent}}([-*+•]|\\d+[.)])\\s+`).test(next))) continue;
      break;
    }
    const m = line.match(/^(\s*)([-*+•]|\d+[.)])\s+(.*)$/);
    const lead = line.match(/^(\s*)/)![1].length;
    if (m && lead === indent && /\d/.test(m[2]) === ordered) {
      const task = m[3].match(/^\[( |x|X)\]\s+(.*)$/);
      items.push({ text: [task ? task[2] : m[3]], task: task ? task[1] !== ' ' : null, children: [] });
    } else if (lead > indent && items.length) {
      items[items.length - 1].children.push(line.slice(Math.min(lead, indent + 2)));
    } else if (!m && items.length && lead >= indent) {
      items[items.length - 1].text.push(line.trim()); // a wrapped line of the same item
    } else break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  const anyTask = items.some((x) => x.task !== null);
  const html = `<${tag}${startAttr}${anyTask ? ' class="tasks"' : ''}>${items
    .map((x) => {
      const box = x.task === null ? '' : `<span class="box${x.task ? ' done' : ''}" aria-hidden="true"></span>`;
      const kids = x.children.length ? blocks(dedent(x.children), o) : '';
      return `<li${x.task ? ' class="done"' : ''}>${box}${x.text.map((t) => inline(t, o)).join(' ')}${kids}</li>`;
    })
    .join('')}</${tag}>`;
  return { html, next: i };
}

function dedent(lines: string[]): string[] {
  const n = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^(\s*)/)![1].length));
  return lines.map((l) => l.slice(Number.isFinite(n) ? n : 0));
}

/** "a,b\n1,2" → rows; quoted cells with commas and "" are kept whole. */
export function parseCsv(text: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === sep) row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}
