/**
 * The small part of Markdown the team writes in replies: paragraphs, **bold**, *italic*, `code`,
 * code blocks, headings, bullet and numbered lists, and links. Everything is escaped first, so a reply
 * can never inject HTML. Links open in the user's browser (the main process refuses in-app navigation).
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string): string {
  const codes: string[] = [];
  let t = esc(s).replace(/`([^`\n]+)`/g, (_m, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
  t = t
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'])/g, (_m, pre: string, url: string) => `${pre}<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`)
    .replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([^_]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${codes[Number(i)]}</code>`);
}

/** Markdown → safe HTML. */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.kind}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.kind}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```/);
    if (fence) {
      flushPara();
      flushList();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      out.push(`<h4>${inline(heading[2])}</h4>`);
    } else if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushPara();
      flushList();
    } else if (bullet || numbered) {
      flushPara();
      const kind = bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
    } else if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`; // a wrapped list item
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join('');
}
