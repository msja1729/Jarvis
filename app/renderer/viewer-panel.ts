/**
 * The preview next to the chat: files a team member shows you (like Claude's side panel). A strip of
 * the files to flip through, a large preview, "Open big" to fill the window, and a card in the chat to
 * open them again later. The preview page itself (viewer.html) draws each file.
 */
import { viewKind, viewUrl } from '../../tools/files/view-kind.js';

export interface ShownFile { name: string; rel: string; url: string; kind: string; size: number }
export interface ShownSet { title: string; files: ShownFile[] }
export interface ShownFrom { who: string; color: string }

interface ViewerApi {
  viewerRead(rel: string): Promise<{ text: string; cut: boolean; kind: string }>;
  viewerOpen(rel: string): Promise<void>;
  viewerReveal(rel: string): Promise<void>;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}
const svg = (d: string) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
};

const BADGE: Record<string, [string, number]> = {
  markdown: ['MD', 212], pdf: ['PDF', 2], html: ['WEB', 32], csv: ['CSV', 145], text: ['TXT', 260], video: ['VID', 330], audio: ['AUD', 285], other: ['FILE', 0],
};
export function sizeText(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const KIND_WORD: Record<string, string> = { markdown: 'Document', image: 'Picture', pdf: 'PDF', html: 'Web page', csv: 'Spreadsheet', text: 'Text', video: 'Video', audio: 'Sound', other: 'File' };

/** A small tile for a file: a picture's thumbnail, or a coloured badge with its type. */
function thumb(f: ShownFile): HTMLElement {
  const t = el('span', 'vthumb');
  if (f.kind === 'image') {
    const img = el('img');
    img.src = f.url;
    img.alt = '';
    img.loading = 'lazy';
    t.append(img);
  } else {
    const [label, hue] = BADGE[f.kind] ?? BADGE.other;
    t.textContent = label;
    t.style.setProperty('--h', String(hue));
  }
  return t;
}

/** A file in the strip or in a chat card. */
function fileButton(f: ShownFile, onOpen: () => void, onBig: () => void): HTMLElement {
  const b = el('button', 'vfile');
  b.type = 'button';
  b.title = `${f.name}\nClick to preview, double-click to open big`;
  b.append(thumb(f), el('span', 'vfile-text', el('span', 'vfile-name', f.name), el('span', 'vfile-meta', `${KIND_WORD[f.kind] ?? 'File'} · ${sizeText(f.size)}`)));
  const big = el('button', 'vfile-big');
  big.type = 'button';
  big.title = 'Open big';
  big.append(svg('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'));
  big.addEventListener('click', (e) => {
    e.stopPropagation();
    onBig();
  });
  b.append(big);
  b.addEventListener('click', onOpen);
  b.addEventListener('dblclick', onBig);
  return b;
}

export function initViewerPanel(j: ViewerApi, onError: (msg: string) => void) {
  const panel = $('viewer');
  const frame = $<HTMLIFrameElement>('viewer-frame');
  const view = $('view-chat');
  let set: ShownSet | null = null;
  let from: ShownFrom = { who: '', color: '#9a9a96' };
  let index = 0;
  let ready = false;
  let pending: Record<string, unknown> | null = null;
  let seq = 0;

  const deliver = (m: Record<string, unknown>) => {
    if (ready) frame.contentWindow?.postMessage(m, '*');
    else pending = m;
  };
  const loading = (on: boolean) => $('viewer-loading').classList.toggle('hidden', !on);

  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data as { type?: string; key?: string; rel?: string };
    if (m.type === 'ready') {
      ready = true;
      if (pending) frame.contentWindow?.postMessage(pending, '*');
      pending = null;
    } else if (m.type === 'key' && m.key) onKey(m.key);
    else if (m.type === 'open-app') void openApp();
    else if (m.type === 'open-file' && m.rel && set) {
      // a link in a document to another team file: add it to the strip and show it
      const rel = m.rel;
      let at = set.files.findIndex((f) => f.rel === rel);
      if (at < 0) {
        set.files.push({ name: rel.split('/').pop() ?? rel, rel, url: viewUrl(rel), kind: viewKind(rel), size: 0 });
        at = set.files.length - 1;
      }
      renderStrip();
      void select(at);
    }
  });

  function layout() {
    // a narrow window: the conversation list makes room for the preview
    view.classList.toggle('viewer-narrow', view.clientWidth < 1320);
  }
  window.addEventListener('resize', () => !panel.classList.contains('hidden') && layout());

  function renderStrip() {
    if (!set) return;
    panel.classList.toggle('single', set.files.length < 2);
    $('viewer-strip').replaceChildren(
      ...set.files.map((f, i) => {
        const b = fileButton(f, () => void select(i), () => void select(i).then(() => setBig(true)));
        b.classList.toggle('active', i === index);
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(i === index));
        return b;
      }),
    );
  }

  async function select(i: number) {
    if (!set) return;
    index = Math.max(0, Math.min(set.files.length - 1, i));
    const f = set.files[index];
    const my = ++seq;
    $('viewer-title').textContent = f.name;
    $('viewer-count').textContent = set.files.length > 1 ? `· ${index + 1} of ${set.files.length}` : '';
    $<HTMLButtonElement>('viewer-prev').disabled = index === 0;
    $<HTMLButtonElement>('viewer-next').disabled = index === set.files.length - 1;
    $('viewer-strip').querySelectorAll('.vfile').forEach((b, k) => {
      b.classList.toggle('active', k === index);
      b.setAttribute('aria-selected', String(k === index));
      if (k === index) (b as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    const needsText = ['markdown', 'csv', 'text'].includes(f.kind);
    let msg: Record<string, unknown> = { type: 'show', file: f };
    if (needsText) {
      loading(true);
      try {
        const r = await j.viewerRead(f.rel);
        msg = { ...msg, text: r.text, cut: r.cut };
      } catch (err) {
        msg = { ...msg, error: clean(err) };
      }
      if (my !== seq) return;
      loading(false);
    }
    deliver(msg);
  }

  function clean(err: unknown) {
    return String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  function setBig(on: boolean) {
    panel.classList.toggle('big', on);
    document.body.classList.toggle('viewer-big-open', on);
    $('viewer-big').title = on ? 'Back to the side (F)' : 'Open big (F)';
  }

  function close() {
    setBig(false);
    panel.classList.add('hidden');
    view.classList.remove('viewing', 'viewer-narrow');
    set = null;
  }

  function onKey(key: string) {
    if (panel.classList.contains('hidden')) return;
    if (key === 'Escape') {
      if (panel.classList.contains('big')) setBig(false);
      else close();
    } else if (key === 'ArrowLeft') void select(index - 1);
    else if (key === 'ArrowRight') void select(index + 1);
    else if (key === 'f' || key === 'F') setBig(!panel.classList.contains('big'));
  }

  async function openApp() {
    const f = set?.files[index];
    if (f) await j.viewerOpen(f.rel).catch((e) => onError(`Could not open ${f.name}: ${clean(e)}`));
  }

  /** Open the preview with these files, at file `at`. */
  function open(s: ShownSet, who: ShownFrom, at = 0, big = false) {
    set = { title: s.title, files: [...s.files] };
    from = who;
    index = at;
    const badge = $('viewer-who');
    badge.style.setProperty('--c', from.color);
    badge.querySelector('span')!.textContent = from.who ? `${from.who} shared · ${s.title}` : s.title;
    panel.classList.remove('hidden');
    view.classList.add('viewing');
    layout();
    if (!frame.getAttribute('src')) {
      ready = false;
      frame.src = 'viewer.html';
    }
    renderStrip();
    void select(at);
    setBig(big);
  }

  /** The card in the chat: who showed what; each file opens the preview again. */
  function card(s: ShownSet, who: ShownFrom): HTMLElement {
    const m = el('div', 'msg jarvis shown');
    const dot = el('i');
    const badge = el('span', 'who', dot, who.who);
    badge.style.setProperty('--c', who.color);
    m.append(
      el('div', 'shown-head', badge, el('span', '', '·'), el('b', '', s.title)),
      el('div', 'shown-files', ...s.files.map((f, i) => fileButton(f, () => open(s, who, i), () => open(s, who, i, true)))),
    );
    return m;
  }

  // buttons and keys
  $('viewer-close').addEventListener('click', close);
  $('viewer-big').addEventListener('click', () => setBig(!panel.classList.contains('big')));
  $('viewer-prev').addEventListener('click', () => void select(index - 1));
  $('viewer-next').addEventListener('click', () => void select(index + 1));
  $('viewer-app').addEventListener('click', () => void openApp());
  $('viewer-folder').addEventListener('click', () => {
    const f = set?.files[index];
    if (f) void j.viewerReveal(f.rel).catch((e) => onError(clean(e)));
  });
  document.addEventListener('keydown', (e) => {
    if (panel.classList.contains('hidden')) return;
    const typing = e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]');
    if (e.key === 'Escape') onKey('Escape');
    else if (!typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) onKey(e.key);
    else if (!typing && (e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) onKey('f');
  });

  // drag the left edge to make the preview wider or narrower (remembered on this computer)
  try {
    const w = localStorage.getItem('viewer-width');
    if (w) panel.style.setProperty('--viewer-w', w);
  } catch {
    /* no storage: the default width */
  }
  $('viewer-resize').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-viewer');
    const right = panel.getBoundingClientRect().right;
    const move = (ev: PointerEvent) => {
      const total = view.clientWidth;
      const px = Math.max(380, Math.min(total - 360, right - ev.clientX));
      panel.style.setProperty('--viewer-w', `${Math.round((px / total) * 1000) / 10}%`);
    };
    const up = () => {
      document.body.classList.remove('resizing-viewer');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      try {
        localStorage.setItem('viewer-width', panel.style.getPropertyValue('--viewer-w'));
      } catch {
        /* not remembered */
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });

  return { open, card, close };
}
