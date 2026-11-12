/**
 * The preview page (inside the panel next to the chat): shows one team file at a time.
 * The chat window sends it the file (and its text, read by Jarvis); nothing from the file is ever
 * inserted as HTML except through renderDoc (escaped) and Mermaid (strict mode).
 */
import mermaid from 'mermaid';
import hljs from 'highlight.js/lib/common';
import { parseCsv, renderDoc } from './doc-markdown.js';
import { viewKind, viewUrl } from '../../tools/files/view-kind.js';

interface ShownFile { name: string; rel: string; url: string; kind: string; size: number }
type Msg = { type: 'show'; file: ShownFile; text?: string; cut?: boolean; error?: string };

const page = document.getElementById('page')!;
const post = (m: Record<string, unknown>) => window.parent.postMessage(m, '*');

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  themeVariables: {
    darkMode: true,
    background: '#181818',
    fontSize: '14px',
    primaryColor: '#1f3350',
    primaryTextColor: '#f0efec',
    primaryBorderColor: '#3987e5',
    secondaryColor: '#3a2618',
    secondaryBorderColor: '#d95926',
    tertiaryColor: '#15342a',
    tertiaryBorderColor: '#199e70',
    lineColor: '#9a9a96',
    textColor: '#f0efec',
    mainBkg: '#1f3350',
    nodeBorder: '#3987e5',
    clusterBkg: '#202020',
    clusterBorder: '#3a3a3a',
    edgeLabelBackground: '#181818',
  },
});

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** "PA/Plans" + "../map.png" → "PA/map.png"; null if it leaves the Team folder. */
function join(dir: string, href: string): string | null {
  const parts = dir ? dir.split('/') : [];
  for (const p of decodeURI(href.split('#')[0].split('?')[0]).replace(/\\/g, '/').split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(p);
  }
  return parts.join('/');
}

let current: ShownFile | null = null;
let diagramSeq = 0;

function frame(url: string, cls: string, sandbox?: string): HTMLIFrameElement {
  const f = el('iframe', cls);
  if (sandbox !== undefined) f.setAttribute('sandbox', sandbox);
  f.src = url;
  return f;
}

function nothing(title: string, text: string, open = true) {
  const box = el('div', 'nothing');
  box.append(el('div', 'nothing-title', title), el('p', '', text));
  if (open && current) {
    const b = el('button', 'btn', 'Open in its app');
    b.addEventListener('click', () => post({ type: 'open-app' }));
    box.append(b);
  }
  page.append(box);
}

async function renderMarkdown(text: string, file: ShownFile) {
  const dir = file.rel.split('/').slice(0, -1).join('/');
  const art = el('article', 'doc');
  art.innerHTML = renderDoc(text, {
    resolve(href, kind) {
      if (/^https?:\/\//i.test(href)) return kind === 'link' ? { href, external: true } : null; // pictures from the web are not loaded
      if (/^data:image\//i.test(href) && kind === 'image') return { href, external: true };
      if (/^#/.test(href)) return kind === 'link' ? { href: `#${href.slice(1)}`, external: false } : null;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
      const rel = join(dir, href);
      if (rel === null) return null;
      return kind === 'image' ? { href: viewUrl(rel), external: true } : { href: rel, external: false };
    },
  });
  page.append(art);
  for (const code of art.querySelectorAll<HTMLElement>('pre code')) {
    const lang = code.dataset.lang;
    try {
      if (lang && hljs.getLanguage(lang)) code.innerHTML = hljs.highlight(code.textContent ?? '', { language: lang }).value;
      else if ((code.textContent ?? '').length < 8000) code.innerHTML = hljs.highlightAuto(code.textContent ?? '').value;
      code.classList.add('hljs');
    } catch {
      /* plain is fine */
    }
  }
  for (const d of art.querySelectorAll<HTMLElement>('.diagram')) {
    const src = d.dataset.mermaid ?? '';
    try {
      const { svg } = await mermaid.render(`dg${++diagramSeq}`, src);
      d.innerHTML = svg;
    } catch {
      d.classList.add('broken');
      d.append(el('div', 'small', 'This diagram could not be drawn:'), Object.assign(el('pre'), { textContent: src }));
    }
  }
}

function renderCsv(text: string, sep: string) {
  const rows = parseCsv(text, sep).filter((r) => r.some((c) => c.trim()));
  const shown = rows.slice(0, 2000);
  const wrap = el('div', 'sheet');
  const table = el('table');
  const [head, ...body] = shown;
  if (head) {
    const tr = el('tr');
    tr.append(el('th', 'num', ''), ...head.map((c) => el('th', '', c)));
    const thead = el('thead');
    thead.append(tr);
    table.append(thead);
  }
  const tb = el('tbody');
  body.forEach((r, i) => {
    const tr = el('tr');
    tr.append(el('td', 'num', String(i + 1)), ...(head ?? r).map((_c, k) => el('td', /^-?[\d.,%$€£₹ ]+$/.test(r[k] ?? '') ? 'right' : '', r[k] ?? '')));
    tb.append(tr);
  });
  table.append(tb);
  wrap.append(table);
  page.append(wrap);
  if (rows.length > shown.length) page.append(el('p', 'cut', `Showing the first ${shown.length} of ${rows.length} rows. Open it in its app to see everything.`));
}

function renderText(text: string, file: ShownFile) {
  let body = text;
  if (/\.json$/i.test(file.name)) {
    try {
      body = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* show as written */
    }
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const pre = el('pre', 'code-file');
  const code = el('code', 'hljs');
  const lang = { ts: 'typescript', tsx: 'typescript', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', py: 'python', yml: 'yaml', ps1: 'powershell', sh: 'bash', cs: 'csharp', rs: 'rust', rb: 'ruby', h: 'c', tex: 'latex' }[ext] ?? ext;
  if (ext !== 'txt' && ext !== 'log' && hljs.getLanguage(lang) && body.length < 400_000) code.innerHTML = hljs.highlight(body, { language: lang }).value;
  else code.textContent = body;
  pre.append(code);
  page.append(pre);
}

function show(m: Msg) {
  current = m.file;
  page.replaceChildren();
  page.className = `kind-${m.file.kind}`;
  document.documentElement.scrollTop = 0;
  if (m.error) return nothing('This file cannot be shown', m.error);
  const f = m.file;
  switch (f.kind) {
    case 'markdown':
      void renderMarkdown(m.text ?? '', f);
      break;
    case 'image': {
      const img = el('img', 'picture');
      img.src = f.url;
      img.alt = f.name;
      img.title = 'Click to see it at full size';
      img.addEventListener('click', () => page.classList.toggle('actual'));
      img.addEventListener('error', () => {
        page.replaceChildren();
        nothing('This picture could not be shown', 'The file may have been moved or is not a picture.');
      });
      const stage = el('div', 'picture-stage');
      stage.append(img);
      page.append(stage);
      break;
    }
    case 'pdf':
      page.append(frame(f.url, 'full'));
      break;
    case 'html':
      // a page from the team: shown as it looks, with its scripts switched off
      page.append(frame(f.url, 'full page-frame', ''));
      break;
    case 'video': {
      const v = el('video', 'media');
      v.controls = true;
      v.src = f.url;
      page.append(v);
      break;
    }
    case 'audio': {
      const box = el('div', 'audio-box');
      const a = el('audio');
      a.controls = true;
      a.src = f.url;
      box.append(el('div', 'nothing-title', f.name), a);
      page.append(box);
      break;
    }
    case 'csv':
      renderCsv(m.text ?? '', /\.tsv$/i.test(f.name) ? '\t' : ',');
      break;
    case 'text':
      renderText(m.text ?? '', f);
      break;
    default:
      nothing('No preview for this kind of file', `${f.name} opens in its own app on this computer.`);
  }
  if (m.cut) page.append(el('p', 'cut', 'This file is very long: only the first part is shown. Open it in its app to see everything.'));
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const m = e.data as Msg;
  if (m && m.type === 'show' && m.file) show(m);
});

// links inside a document: web links open in the browser; links to other team files open here
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  const open = a.getAttribute('data-open');
  if (open === null) return;
  e.preventDefault();
  if (open.startsWith('#')) {
    document.getElementById(decodeURIComponent(open.slice(1)))?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  post({ type: 'open-file', rel: open, kind: viewKind(open) });
});

// keys work the same whether the chat window or the preview has focus
document.addEventListener('keydown', (e) => {
  if (['Escape', 'ArrowLeft', 'ArrowRight'].includes(e.key) || ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey)) {
    if (e.key.startsWith('Arrow') && (e.target as HTMLElement).closest('video, audio')) return;
    post({ type: 'key', key: e.key });
  }
});

post({ type: 'ready' });
