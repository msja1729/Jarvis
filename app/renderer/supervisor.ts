/**
 * Coding supervisor card: shows what Claude is doing, brings its questions to the
 * user with Jarvis's recommendation, and speaks them (natural voice) when enabled.
 */
import { initTts, speak, TtsApi } from '../../speech/tts.js';
import type { Pending, SessionView } from '../../supervisor/supervisor.js';

interface SupState {
  /** The Project Manager's name. */
  pm?: string;
  view: SessionView | null;
  updates: { kind: string; text: string; at: number }[];
  say?: string;
}
interface SupApi extends TtsApi {
  onSupState(cb: (s: SupState) => void): void;
  supAnswer(id: string, a: { choose?: string[]; allow?: boolean; text?: string }): void;
  supStop(): void;
  supHide(): void;
  supOpenCode(): void;
  supOpenFile(rel: string): void;
  supResize(height: number): void;
}
const j = (window as unknown as { jarvis: SupApi }).jarvis;
initTts(j);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: Element) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
};

let current: Pending | null = null;

function fit() {
  requestAnimationFrame(() => j.supResize(Math.ceil($('card').getBoundingClientRect().height)));
}

function answer(a: { choose?: string[]; allow?: boolean; text?: string }) {
  if (!current) return;
  j.supAnswer(current.id, a);
}

function renderAsk(p: Pending | null) {
  current = p;
  $('ask').classList.toggle('hidden', !p);
  if (!p) return;
  const choices = $('choices');
  choices.textContent = '';
  choices.className = 'choices';
  const detail = $('ask-detail');
  detail.classList.add('hidden');
  const advice = $('advice');
  advice.classList.add('hidden');
  const input = $<HTMLInputElement>('reply-text');
  input.value = '';

  if (p.kind === 'question') {
    $('ask-label').textContent = p.header ? `Claude is asking · ${p.header}` : 'Claude is asking';
    $('ask-text').textContent = p.question;
    for (const o of p.options) {
      const b = el('button', `choice${o.label === p.pick ? ' picked' : ''}`, choices);
      const t = el('div', 't', b);
      t.appendChild(document.createTextNode(o.label));
      if (o.label === p.pick) el('span', 'tag', t).textContent = "Jarvis's pick";
      if (o.description) el('div', 'd', b).textContent = o.description;
      b.addEventListener('click', () => answer({ choose: [o.label] }));
    }
    input.placeholder = 'Or answer in your own words…';
    $('reply').querySelector('button')!.textContent = 'Send';
    if (p.pick) {
      advice.classList.remove('hidden');
      $('advice-text').textContent = `I'd go with ${p.pick}${p.why ? ` because ${p.why.replace(/^because\s+/i, '')}` : '.'}`;
    }
  } else {
    const isPlan = p.kind === 'plan';
    $('ask-label').textContent = isPlan ? 'Claude has a plan' : 'Claude wants to';
    const q = $('ask-text');
    q.textContent = isPlan ? 'Shall Claude go ahead with this plan?' : p.what;
    if (!isPlan) {
      const r = el('span', `risk ${p.risk}`, q);
      r.textContent = `${p.risk} risk`;
      r.title = p.riskWhy;
    }
    const text = isPlan ? p.plan : p.detail;
    if (text && (isPlan || text !== p.what)) {
      detail.textContent = text;
      detail.classList.remove('hidden');
    }
    if (p.allow !== undefined) {
      advice.classList.remove('hidden');
      $('advice-text').textContent = p.allow ? `Looks fine to me${p.why ? `: ${p.why}` : '.'}` : `I'd say no${p.why ? `: ${p.why}` : '.'}`;
    } else if (!isPlan) {
      advice.classList.remove('hidden');
      $('advice-text').textContent = `My rules ask you first because ${p.riskWhy}.`;
    }
    choices.classList.add('yesno');
    const yes = el('button', `choice${p.allow === true ? ' picked' : ''}`, choices);
    yes.textContent = isPlan ? 'Go ahead' : 'Allow';
    yes.addEventListener('click', () => answer({ allow: true, text: input.value }));
    const no = el('button', `choice${p.allow === false ? ' picked' : ''}`, choices);
    no.textContent = isPlan ? 'Not yet' : "Don't allow";
    no.addEventListener('click', () => answer({ allow: false, text: input.value }));
    input.placeholder = isPlan ? 'Changes you want (sent with your answer)…' : 'Reason or another way (optional)…';
    // typing here and sending means "no, and here is why / do this instead"
    $('reply').querySelector('button')!.textContent = isPlan ? 'Ask for changes' : 'No, and say this';
  }
}

$('reply').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $<HTMLInputElement>('reply-text').value.trim();
  if (!current || !text) return;
  // free text: an answer to a question, or a "no, do this instead" for a permission
  if (current.kind === 'question') answer({ text });
  else answer({ allow: false, text });
});
$('hide').addEventListener('click', () => j.supHide());
$('stop').addEventListener('click', () => j.supStop());
$('open').addEventListener('click', () => j.supOpenCode());

const LABEL: Record<string, string> = { working: 'Working', waiting: 'Needs you', done: 'Done', error: 'Problem', stopped: 'Stopped' };

j.onSupState((s) => {
  const v = s.view;
  document.body.className = v?.state ?? '';
  document.querySelector('.kicker')!.textContent = `${s.pm ?? 'Ryan'} · Project Manager`;
  document.querySelector('.advice .who')!.textContent = s.pm ?? 'PM';
  $('task').textContent = v ? v.task : 'No task yet';
  $('task').title = v ? `${v.task} · ${v.folder}` : '';
  $('state').textContent = v ? LABEL[v.state] : 'Idle';
  $('files').textContent = v ? `${v.folder}${v.changed.length ? ` · ${v.changed.length} file${v.changed.length > 1 ? 's' : ''} changed` : ''}` : '';
  $('stop').classList.toggle('hidden', !v || !(v.state === 'working' || v.state === 'waiting'));
  renderAsk(v?.pending[0] ?? null);
  // what changed, and whether the tests pass (each file opens in VS Code)
  const changes = $('changes');
  changes.classList.toggle('hidden', !v || (!v.changed.length && !v.tests));
  const list = $('files-list');
  list.textContent = '';
  for (const f of v?.changed ?? []) {
    const b = el('button', 'file', list);
    b.textContent = f;
    b.title = 'Open in VS Code';
    b.addEventListener('click', () => j.supOpenFile(f));
  }
  const tests = $('tests');
  tests.classList.toggle('hidden', !v?.tests);
  if (v?.tests) {
    const t = v.tests;
    tests.className = `tests ${t.ok ? 'ok' : 'bad'}`;
    tests.textContent = [t.passed !== undefined ? `${t.passed} passed` : '', t.failed ? `${t.failed} failed` : ''].filter(Boolean).join(' · ') || (t.ok ? 'Tests pass' : 'Tests fail');
  }
  const feed = $('feed');
  feed.textContent = '';
  for (const u of s.updates.slice(-4).reverse()) {
    const d = el('div', `upd ${u.kind}`, feed);
    el('time', '', d).textContent = new Date(u.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    d.appendChild(document.createTextNode(u.text));
  }
  if (s.say) void speak(s.say);
  fit();
});
new ResizeObserver(fit).observe($('card'));
