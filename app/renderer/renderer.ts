/** Renderer UI. All untrusted text is inserted with textContent, never innerHTML. */
import { initTts, speak, speakStream, stopSpeaking } from '../../speech/tts.js';
import type { Element } from '../../tools/whiteboard/scene.js';
import { initWhiteboard } from './whiteboard.js';
import { startWorldMap } from './worldmap.js';
import { startCapture, stopCapture, CaptureKind } from './audio.js';

interface Ability { name: string; title: string; description: string; group: string; setting: string; options: string[] }
interface HubApp { id: string; name: string; description: string; kind: string; enabled: boolean; connected: boolean; account: string | null; auth: string | null; abilities: Ability[] }
interface Account { id: string; name: string; configured: boolean; connected: boolean; email: string | null; needsSecret: boolean }
interface Suggested { id: string; name: string; description: string; url: string; auth: 'oauth' | 'key' | 'none'; keyHelp?: string; added: boolean }
interface ConfirmReq { id: string; appName: string; abilityTitle: string; group: string; summary: string }

declare global {
  interface Window {
    jarvis: {
      setupCheck(): Promise<any>;
      setupBaseline(): Promise<any>;
      ask(text: string, role?: string | null, opts?: { stream?: boolean }): Promise<any>;
      onAskStart(cb: (s: { roleName: string; roleColor: string; voice: string }) => void): void;
      onAskPartial(cb: (d: string) => void): void;
      historyGet(): Promise<HistoryItem[]>;
      historySet(keep: boolean): Promise<boolean>;
      historyClear(): Promise<boolean>;
      onHistoryAdd(cb: (items: HistoryItem[]) => void): void;
      onHistoryCleared(cb: () => void): void;
      teamList(): Promise<{ roles: TeamRole[]; voices: { id: string; name: string; accent: string; gender: string; grade: string }[] }>;
      teamSetVoice(role: string, voice: string): Promise<string>;
      teamSetName(role: string, name: string): Promise<string>;
      teamSaveNotes(role: string, text: string): Promise<string>;
      teamForget(role: string): Promise<string>;
      teamRefresh(role: string): Promise<string>;
      answerConfirm(id: string, yes: boolean): void;
      hubList(): Promise<HubApp[]>;
      hubSetEnabled(appId: string, on: boolean): Promise<HubApp[]>;
      hubSetAbility(appId: string, ability: string, setting: string): Promise<HubApp[]>;
      hubAddMcp(input: unknown): Promise<HubApp[]>;
      hubRemove(appId: string): Promise<HubApp[]>;
      hubSuggested(): Promise<Suggested[]>;
      hubSignIn(appId: string): Promise<HubApp[]>;
      accountsList(): Promise<Account[]>;
      accountsSetup(id: string, clientId: string, clientSecret?: string): Promise<Account[]>;
      accountsConnect(id: string): Promise<Account[]>;
      accountsDisconnect(id: string): Promise<Account[]>;
      accountsOpenConsole(id: string): Promise<void>;
      accountsOpenGuide(id: string): Promise<void>;
      cancelSignIn(): void;
      usageSummary(): Promise<any>;
      activityList(): Promise<any[]>;
      settingsGet(): Promise<any>;
      settingsSet(patch: unknown): Promise<any>;
      toggleBox(): void;
      onProgress(cb: (label: string) => void): void;
      onConfirm(cb: (req: ConfirmReq) => void): void;
      onConfirmCancel(cb: (id: string) => void): void;
      onNavigate(cb: (view: string) => void): void;
      onNotice(cb: (text: string) => void): void;
      onSettings(cb: (s: any) => void): void;
      onWhiteboardClear(cb: () => void): void;
      onWbDraw(cb: (elements: any) => void): void;
      onWbSnapshot(cb: (id: any) => void): void;
      wbSnapshotReply(id: string, data: unknown): void;
      wbCleared(): void;
      wbExport(format: 'png' | 'pdf', dataUrl: string): Promise<void>;
      onScreenPick(cb: (req: any) => void): void;
      screenPickReply(id: string, choice: unknown): void;
      onScreenArea(cb: (req: any) => void): void;
      screenAreaReply(id: string, rect: unknown): void;
      onAudioStart(cb: (req: { id: string; kind: CaptureKind }) => void): void;
      onAudioStop(cb: (req: { id: string }) => void): void;
      audioReply(channel: string, id: string, value: unknown): void;
      sendPcm(kind: string, data: Uint8Array, level: number): void;
      voiceToggle(): void;
      onVoiceAsk(cb: (text: string) => void): void;
      speechStatus(): Promise<{ engine: boolean; model: boolean; ready: boolean; help?: string; hotkey: string | null }>;
      speechInstall(): Promise<unknown>;
      onSpeechProgress(cb: (p: { label: string; fraction: number }) => void): void;
      setHotkey(accelerator: string | null): Promise<string>;
      cardHotkey(): Promise<string | null>;
      supSettings(patch?: unknown): Promise<{ autonomy: string; updateEvery: number; speak: boolean; watchOwn: boolean; claudeSettings: string }>;
      supWatchOwn(on: boolean): Promise<boolean>;
      paGet(): Promise<{ planAt: string | null; reminders: { id: string; text: string; at: string }[] }>;
      paSetPlan(at: string | null): Promise<string | null>;
      remindersCancel(id: string): Promise<unknown>;
      boardList(): Promise<BoardTask[]>;
      boardAdd(t: { title: string; project?: string; due?: string }): Promise<BoardTask[]>;
      boardUpdate(id: string, patch: { status?: string; due?: string | null }): Promise<BoardTask[]>;
      boardRemove(id: string): Promise<BoardTask[]>;
      onPlannerChanged(cb: () => void): void;
      onAnnounce(cb: (a: { name: string; color: string; voice: string; title: string; text: string }) => void): void;
      setCardHotkey(accelerator: string | null): Promise<string>;
      voiceResize(height: number): void;
      ttsStatus(): Promise<{ installed: boolean; ready: boolean; downloadBytes: number; voice: string; speed: number; voices: { id: string; name: string; accent: string; gender: string; grade: string }[] }>;
      ttsInstall(): Promise<unknown>;
      onTtsProgress(cb: (p: { label: string; fraction: number }) => void): void;
      ttsSpeak(text: string, opts?: { voice?: string }): Promise<number | null>;
      ttsStop(id?: number): void;
      onTtsChunk(cb: (c: { id: number; rate: number; audio: Float32Array }) => void): void;
      onTtsDone(cb: (d: { id: number; error?: string }) => void): void;
      onTtsStopAll(cb: () => void): void;
      voiceHide(): void;
      showMain(): void;
    };
  }
}

const j = window.jarvis;
initTts(j);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...kids);
  return node;
}

const SETTING_LABEL: Record<string, string> = { off: 'Off', ask: 'Ask me first', allowed: 'Allowed' };
let voiceOn = false;

const MODE = new URLSearchParams(location.search).get('mode') ?? 'main';
document.body.classList.add(MODE);
if (MODE === 'main') startWorldMap(document.getElementById('worldmap') as HTMLCanvasElement);

/* Soft fade at the top/bottom of scrolling areas, only where there is more to scroll. */
function trackFade(node: HTMLElement) {
  const update = () => {
    const more = node.scrollHeight - node.clientHeight - node.scrollTop;
    node.style.setProperty('--fto', node.scrollTop > 2 ? '1' : '0');
    node.style.setProperty('--fbo', more > 2 ? '1' : '0');
  };
  node.classList.add('fade-scroll');
  node.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(node);
  new MutationObserver(update).observe(node, { childList: true, subtree: true });
  update();
}
document.querySelectorAll<HTMLElement>('.view:not(#view-chat), #messages, .vc-answer').forEach(trackFade);

/* ---------- menu: one glass pill slides to the tab under the mouse ---------- */
const navPill = document.querySelector<HTMLElement>('.nav-pill');
function movePill(target: HTMLElement | null, instant = false) {
  if (!navPill || !target) return;
  const nav = target.parentElement!.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  if (instant) navPill.style.transition = 'none';
  navPill.style.width = `${r.width}px`;
  navPill.style.height = `${r.height}px`;
  navPill.style.transform = `translate(${r.left - nav.left}px, ${r.top - nav.top}px)`;
  navPill.style.opacity = '1';
  if (instant) {
    void navPill.offsetWidth;
    navPill.style.transition = '';
  }
}
const activeTab = () => document.querySelector<HTMLElement>('#nav button[data-view].active');
document.querySelectorAll<HTMLElement>('#nav button[data-view]').forEach((b) => b.addEventListener('pointerenter', () => movePill(b)));
let pillReturn: number | null = null;
document.querySelectorAll<HTMLElement>('#nav button[data-view]').forEach((b) =>
  b.addEventListener('pointerenter', () => {
    if (pillReturn !== null) window.clearTimeout(pillReturn);
    pillReturn = null;
  }),
);
$('nav').addEventListener('pointerleave', () => {
  if (pillReturn !== null) window.clearTimeout(pillReturn);
  pillReturn = window.setTimeout(() => {
    pillReturn = null;
    movePill(activeTab());
  }, 220);
});
window.addEventListener('resize', () => movePill(activeTab(), true));
requestAnimationFrame(() => movePill(activeTab(), true));

/* ---------- navigation ---------- */
const SUBS: Record<string, string> = {
  chat: 'Ask anything, by typing or with your voice',
  team: 'Your experts, their voices and what they remember',
  hub: 'Your apps and what Jarvis may do in each  ·  changes apply on the next request',
  whiteboard: 'Draw together  ·  ask “what did I draw?”',
  usage: 'Tokens used on your Claude plan  ·  updated after every request',
  activity: 'Everything Jarvis did or was stopped from doing',
  settings: 'Model, voice and shortcuts',
};
const TITLES: Record<string, string> = {
  chat: 'Chat',
  team: 'Team',
  hub: 'Tool Hub',
  whiteboard: 'Whiteboard',
  usage: 'Usage',
  activity: 'Activity',
  settings: 'Settings',
};
function show(view: string) {
  document.querySelectorAll<HTMLButtonElement>('#nav button[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  $('page-title').textContent = TITLES[view] ?? view;
  $('page-sub').textContent = SUBS[view] ?? '';
  movePill(activeTab());
  if (view === 'hub') {
    void renderAccounts();
    void renderHub();
    void renderSuggested();
  }
  if (view === 'team') void renderTeam();
  if (view === 'usage') void renderUsage();
  if (view === 'activity') void renderActivity();
  if (view === 'settings') {
    void renderSettings();
    void renderTts();
    void renderVoice();
  }
}
document.querySelectorAll<HTMLButtonElement>('#nav button[data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view!)));
$('open-box').addEventListener('click', () => j.toggleBox());
j.onNavigate(show);

/* ---------- status chips ---------- */
function setStatus(state: 'ok' | 'busy' | 'err', text: string) {
  $('status-dot').className = `dot ${state}`;
  $('status-text').textContent = text;
  $('orb').classList.toggle('thinking', state === 'busy');
  document.body.classList.toggle('busy', state === 'busy');
}
async function refreshChips() {
  try {
    const [usage, apps] = await Promise.all([j.usageSummary(), j.hubList()]);
    $('chip-tokens').textContent = compact(usage.todayTotal);
    $('chip-apps').textContent = String(apps.filter((a) => a.enabled && a.connected).length);
  } catch {
    /* chips are informational */
  }
}
function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();
}

/* ---------- live replies: speak while Claude is still writing ---------- */
let liveSpeech: ReturnType<typeof speakStream> | null = null;
let liveText = '';
/** True while this window waits for a streamed reply it asked for. */
let awaitingLive = false;
j.onAskStart((s: { roleName: string; roleColor: string; voice: string }) => {
  if (!awaitingLive) return;
  liveText = '';
  // the voice card always speaks; the main chat only when "Speak replies aloud" is on
  liveSpeech = MODE === 'voice' || voiceOn ? speakStream({ voice: s.voice }) : null;
  if (MODE === 'voice') {
    $('vc-name').textContent = s.roleName;
    ($('vc-orb') as HTMLElement).style.setProperty('--c', s.roleColor);
  }
});
j.onAskPartial((d: string) => {
  if (!awaitingLive) return;
  liveText += d;
  liveSpeech?.push(d);
  if (MODE === 'voice' && liveText.trim()) {
    setVoiceStatus(null);
    $('vc-answer').textContent = liveText.trim();
    fitVoice();
  }
});
/** After the full reply: let the live speech finish, or fall back to speaking the reply. */
function finishLive(r: { reply: string; isError?: boolean; lessonShown?: boolean; voice?: string }, speakIfNone: boolean, onEnd?: () => void): void {
  const ls = liveSpeech;
  liveSpeech = null;
  awaitingLive = false;
  if (ls && liveText.trim() && !r.isError) {
    ls.end(onEnd);
    return;
  }
  ls?.cancel();
  if (speakIfNone && !r.isError && !r.lessonShown) speak(r.reply, onEnd, { voice: r.voice });
  else onEnd?.();
}

/* ---------- team ---------- */
interface TeamRole {
  id: string;
  name: string;
  person: string;
  title: string;
  blurb: string;
  color: string;
  examples: string[];
  voice: string;
  apps: string[];
  notes: string | null;
  pending: number;
}
let teamCache: { roles: TeamRole[]; voices: { id: string; name: string; accent: string; gender: string; grade: string }[] } | null = null;
/** Who the chat talks to; null = Auto (Jarvis picks the right expert). */
let pickedRole: string | null = null;

async function loadTeam() {
  teamCache = await j.teamList();
  renderRoleChips();
  renderSuggestions();
  return teamCache;
}

function roleChip(label: string, color: string, on: boolean, title: string) {
  const b = el('button', { type: 'button', className: `role-chip${on ? ' on' : ''}`, title }, el('i', {}), label);
  b.style.setProperty('--c', color);
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(on));
  return b;
}

function pickRole(id: string | null) {
  pickedRole = id;
  const r = teamCache?.roles.find((x) => x.id === id);
  $<HTMLInputElement>('input').placeholder = r ? `Ask ${r.id === 'jarvis' ? 'Jarvis' : `${r.person} (${r.name})`}…` : 'Ask anything… Jarvis passes it to the right expert';
  renderRoleChips();
}

function renderRoleChips() {
  const box = $('role-chips');
  if (!box || !teamCache) return;
  box.replaceChildren();
  const auto = roleChip('Auto', '#f0efec', pickedRole === null, 'Jarvis picks the right expert');
  auto.addEventListener('click', () => pickRole(null));
  box.append(auto);
  for (const r of teamCache.roles) {
    const c = roleChip(r.id === 'jarvis' ? 'Jarvis' : r.person, r.color, pickedRole === r.id, `${r.name}: ${r.blurb}`);
    c.addEventListener('click', () => pickRole(r.id));
    box.append(c);
  }
}

function renderSuggestions() {
  const box = $('suggestions');
  if (!box || !teamCache) return;
  box.replaceChildren();
  for (const r of teamCache.roles.filter((x) => x.id !== 'jarvis')) {
    const text = r.examples[0];
    const b = el('button', { className: 'suggest', type: 'button' }, el('span', { className: 'role-tag' }, el('i', {}), `${r.person} · ${r.name}`), text);
    (b.firstChild as HTMLElement).style.setProperty('--c', r.color);
    b.addEventListener('click', () => {
      pickRole(r.id);
      submitText(text);
    });
    box.append(b);
  }
}

const ROLE_SAMPLE: Record<string, string> = {
  jarvis: "Hello, I'm Jarvis. Ask me anything and I'll bring in the right expert.",
  pa: "Hi, I'm {name}, your personal assistant. You have a light morning, so let's put the report first.",
  educator: "Hello! I'm {name}, your teacher. Let's start with a picture, and the formula will make sense.",
  pm: "Hey, I'm {name}, your project manager. The login page is done and the tests are green.",
  doctor: "Hello, I'm {name}, your doctor. Let's talk about what you're eating and how you're sleeping.",
  finance: "Hi, I'm {name}. Let's look at where your money goes each month.",
};
const sampleFor = (r: TeamRole) => (ROLE_SAMPLE[r.id] ?? 'Hello.').replace('{name}', r.person);

const PLAN_TEXT = "Plan my day: check today's calendar (and any important unread email), then give me a short, friendly plan with times and priorities, and add a reminder 10 minutes before each meeting today.";

async function paPanel(r: TeamRole): Promise<HTMLElement> {
  const pa = await j.paGet();
  const box = el('div', { className: 'pa-panel' });
  const on = el('input', { type: 'checkbox', className: 'switch', checked: Boolean(pa.planAt) });
  const time = el('input', { type: 'time', value: pa.planAt ?? '08:30', className: 'pa-time' });
  const save = async () => void (await j.paSetPlan(on.checked ? time.value : null));
  on.addEventListener('change', save);
  time.addEventListener('change', () => {
    if (on.checked) void save();
  });
  const now = el('button', { type: 'button', className: 'chip' }, 'Plan my day now');
  now.addEventListener('click', () => {
    pickRole('pa');
    show('chat');
    submitText(PLAN_TEXT);
  });
  box.append(el('label', { className: 'team-row pa-row' }, el('span', {}, `Morning plan from ${r.person}`), time, on), el('div', { className: 'team-row' }, el('span', { className: 'spacer' }), now));
  const list = el('div', { className: 'pa-reminders' });
  if (!pa.reminders.length) list.append(el('div', { className: 'muted small' }, 'No upcoming reminders. Try "Maya, remind me to call Mom at 6 pm".'));
  for (const rem of pa.reminders.slice(0, 6)) {
    const x = el('button', { type: 'button', className: 'x', title: 'Cancel this reminder' }, '×');
    x.addEventListener('click', async () => {
      await j.remindersCancel(rem.id);
      void renderTeam();
    });
    const when = new Date(rem.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    list.append(el('div', { className: 'pa-reminder' }, el('span', { className: 'when' }, when), el('span', {}, rem.text), x));
  }
  box.append(el('details', { className: 'team-memory', open: pa.reminders.length > 0 }, el('summary', {}, `Upcoming reminders (${pa.reminders.length})`), list));
  return box;
}

/* ---------- project board ---------- */
interface BoardTask {
  id: string;
  title: string;
  project?: string;
  status: 'todo' | 'doing' | 'done';
  due?: string;
}
const COLUMNS: [BoardTask['status'], string][] = [
  ['todo', 'To do'],
  ['doing', 'Doing'],
  ['done', 'Done'],
];
async function renderBoard(list?: BoardTask[]) {
  const tasks = list ?? (await j.boardList());
  const root = $('task-board');
  if (!root) return;
  root.replaceChildren();
  const today = new Date().toISOString().slice(0, 10);
  for (const [status, label] of COLUMNS) {
    const col = el('div', { className: `board-col ${status}` }, el('div', { className: 'board-head' }, label, el('span', { className: 'muted' }, String(tasks.filter((t) => t.status === status).length))));
    for (const t of tasks.filter((x) => x.status === status)) {
      const sel = el('select', { className: 'board-status' });
      for (const [s, l] of COLUMNS) sel.append(el('option', { value: s, selected: s === t.status }, l));
      sel.addEventListener('change', async () => renderBoard(await j.boardUpdate(t.id, { status: sel.value })));
      const del = el('button', { type: 'button', className: 'x', title: 'Remove' }, '×');
      del.addEventListener('click', async () => renderBoard(await j.boardRemove(t.id)));
      const overdue = t.due && t.status !== 'done' && t.due < today;
      col.append(
        el(
          'div',
          { className: 'board-task' },
          el('div', { className: 'board-title' }, t.title, del),
          el('div', { className: 'board-meta' }, t.project ? el('span', { className: 'pill' }, t.project) : '', t.due ? el('span', { className: `due${overdue ? ' late' : ''}` }, `due ${t.due}`) : '', sel),
        ),
      );
    }
    root.append(col);
  }
}
$('board-add')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $<HTMLInputElement>('board-title').value.trim();
  if (!title) return;
  const list = await j.boardAdd({ title, project: $<HTMLInputElement>('board-project').value.trim() || undefined, due: $<HTMLInputElement>('board-due').value || undefined });
  $<HTMLInputElement>('board-title').value = '';
  void renderBoard(list);
});
j.onPlannerChanged(() => {
  if ($('view-team')?.classList.contains('active')) void renderBoard();
});

async function renderTeam() {
  const team = await loadTeam();
  const grid = $('team-grid');
  grid.replaceChildren();
  for (const r of team.roles) {
    const card = el('div', { className: 'card team-card' });
    card.style.setProperty('--c', r.color);
    const title = el('h3', {}, r.id === 'jarvis' ? 'Jarvis' : r.person);
    const sub = el('div', { className: 'muted' }, r.id === 'jarvis' ? r.title : `${r.name} · ${r.title}`);
    const head = el('div', { className: 'team-head' }, el('span', { className: 'team-orb' }), el('div', {}, title, sub));
    if (r.id !== 'jarvis') {
      const rename = el('button', { type: 'button', className: 'chip team-rename', title: 'Rename' }, 'Rename');
      rename.addEventListener('click', () => {
        const input = el('input', { className: 'team-name-input', value: r.person, maxLength: 20 });
        const err = el('div', { className: 'error small' });
        const save = async () => {
          try {
            r.person = await j.teamSetName(r.id, input.value);
            void renderTeam();
          } catch (e) {
            err.textContent = cleanError(e);
          }
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') void renderTeam();
        });
        title.replaceWith(el('div', {}, input, err));
        rename.textContent = 'Save';
        rename.onclick = () => void save();
        input.focus();
        input.select();
      });
      head.append(el('span', { className: 'spacer' }), rename);
    }
    card.append(head, el('p', { className: 'team-blurb' }, r.blurb));
    const apps = el('div', { className: 'team-apps' });
    for (const a of r.id === 'jarvis' ? ['Every app'] : r.apps) apps.append(el('span', { className: 'pill' }, a));
    card.append(apps);

    // voice (natural voices only)
    const select = el('select', { className: 'team-voice' });
    for (const v of team.voices) select.append(el('option', { value: v.id, selected: v.id === r.voice }, `${v.name} · ${v.accent} ${v.gender.toLowerCase()}`));
    select.addEventListener('change', async () => {
      await j.teamSetVoice(r.id, select.value);
      void speak(sampleFor(r), undefined, { voice: select.value });
    });
    const play = el('button', { type: 'button', className: 'chip' }, 'Play sample');
    play.addEventListener('click', () => void speak(sampleFor(r), undefined, { voice: select.value }));
    card.append(el('label', { className: 'team-row' }, el('span', { className: 'muted' }, 'Voice'), select, play));

    // memory
    if (r.notes !== null) {
      const area = el('textarea', { className: 'team-notes', rows: 5, placeholder: `Nothing yet. ${r.person} will note useful things as you talk, or you can write here.` });
      area.value = r.notes;
      const status = el('span', { className: 'muted small' }, r.pending ? `${r.pending} recent conversation${r.pending > 1 ? 's' : ''} not summarised yet` : '');
      const save = el('button', { type: 'button', className: 'chip' }, 'Save');
      save.addEventListener('click', async () => {
        area.value = await j.teamSaveNotes(r.id, area.value);
        status.textContent = 'Saved';
      });
      const refresh = el('button', { type: 'button', className: 'chip' }, 'Summarise now');
      refresh.disabled = !r.pending;
      refresh.addEventListener('click', async () => {
        status.textContent = 'Summarising…';
        area.value = await j.teamRefresh(r.id);
        status.textContent = 'Up to date';
        refresh.disabled = true;
      });
      const forget = el('button', { type: 'button', className: 'chip danger' }, 'Forget everything');
      forget.addEventListener('click', async () => {
        if (!forget.dataset.sure) {
          forget.dataset.sure = '1';
          forget.textContent = 'Click again to forget';
          return;
        }
        area.value = await j.teamForget(r.id);
        status.textContent = 'Forgotten';
        forget.textContent = 'Forget everything';
        delete forget.dataset.sure;
      });
      card.append(
        el('details', { className: 'team-memory' }, el('summary', {}, `What ${r.person} remembers`), area, el('div', { className: 'team-row' }, status, el('span', { className: 'spacer' }), refresh, forget, save)),
      );
    }
    if (r.id === 'pa') card.append(await paPanel(r));
    const talk = el('button', { type: 'button', className: 'primary team-talk' }, `Talk to ${r.id === 'jarvis' ? 'Jarvis' : r.person}`);
    talk.addEventListener('click', () => {
      pickRole(r.id);
      show('chat');
      $<HTMLInputElement>('input').focus();
    });
    card.append(talk);
    grid.append(card);
  }
  void renderBoard();
}

/* ---------- chat ---------- */
const messages = $('messages');
function addMsg(who: 'user' | 'jarvis', text: string, meta?: string, isError = false, from?: { name: string; color: string }) {
  $('empty').classList.add('hidden');
  const m = el('div', { className: `msg ${who}${isError ? ' error' : ''}` }, text);
  if (from) {
    const badge = el('span', { className: 'who' }, el('i', {}), from.name);
    badge.style.setProperty('--c', from.color);
    m.prepend(badge);
  }
  if (meta) m.append(el('span', { className: 'meta' }, meta));
  messages.append(m);
  messages.scrollTop = messages.scrollHeight;
}
interface HistoryItem {
  at: string;
  who: 'user' | 'assistant';
  text: string;
  roleName?: string;
  color?: string;
  via: 'chat' | 'voice' | 'box';
  meta?: string;
  error?: boolean;
}
const VIA: Record<string, string> = { voice: ' · by voice', box: ' · floating box', chat: '' };
function showHistoryItem(i: HistoryItem) {
  if (i.who === 'user') addMsg('user', i.text, i.via !== 'chat' ? VIA[i.via].replace(' · ', '') : undefined);
  else addMsg('jarvis', i.text, `${i.meta ?? ''}${VIA[i.via] ?? ''}`, Boolean(i.error), i.roleName ? { name: i.roleName, color: i.color ?? '#9a9a96' } : undefined);
}
/** Earlier conversations, shown when Jarvis opens. */
async function loadHistory() {
  const items = await j.historyGet();
  if (!items.length) return;
  addNote('Earlier conversations');
  items.forEach(showHistoryItem);
  addNote('Today');
}
if (MODE === 'main') {
  void loadHistory();
  // what was said by voice or in the floating box appears here too
  j.onHistoryAdd((items) => items.forEach(showHistoryItem));
  j.onHistoryCleared(() => {
    messages.querySelectorAll('.msg, .note').forEach((n) => n.remove());
    $('empty').classList.remove('hidden');
  });
}

function addNote(text: string) {
  messages.append(el('div', { className: 'note' }, text));
}

const progress = $('progress');
function setProgress(label: string | null) {
  $('progress-text').textContent = label ?? '';
  progress.classList.toggle('hidden', label === null);
  if (label) setStatus('busy', label.replace(/…$/, ''));
}
j.onProgress((label) => {
  if (MODE === 'voice') {
    if (label && voiceBusy) setVoiceStatus(label);
    return;
  }
  setProgress(label);
});

j.onNotice((text) => showNotice(text));

document.querySelectorAll<HTMLButtonElement>('[data-suggest]').forEach((b) =>
  b.addEventListener('click', () => {
    $<HTMLInputElement>('input').value = b.dataset.suggest ?? '';
    $<HTMLFormElement>('composer').requestSubmit();
  }),
);

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  stopSpeaking();
  addMsg('user', text);
  const send = $<HTMLButtonElement>('send');
  send.disabled = true;
  setProgress('Thinking…');
  try {
    awaitingLive = voiceOn;
    const r = await j.ask(text, pickedRole, { stream: voiceOn });
    if (r.newConversation && r.kind === 'brain') addNote('New conversation started');
    let meta: string | undefined;
    if (r.kind === 'brain') meta = `${r.model} · ${r.tokens?.toLocaleString() ?? 0} tokens${r.expensive ? ' · ▲ 3× more than usual' : ''}`;
    else meta = 'handled locally · 0 tokens';
    addMsg('jarvis', r.reply, meta, Boolean(r.isError), r.roleName ? { name: r.roleName, color: r.roleColor } : undefined);
    if (r.limitReached) showNotice('Usage limit reached on your Claude plan. Jarvis will work again when the limit resets.');
    if (voiceOn) finishLive(r, true);
    setStatus(r.isError ? 'err' : 'ok', r.isError ? 'Problem' : 'Ready');
    if (r.followUp) pendingFollowUp = r.followUp;
  } catch (err) {
    finishLive({ reply: '', isError: true }, false);
    addMsg('jarvis', String(err), undefined, true);
    setStatus('err', 'Problem');
  } finally {
    send.disabled = false;
    setProgress(null);
    void refreshChips();
    if (pendingFollowUp) {
      const next = pendingFollowUp;
      pendingFollowUp = null;
      submitText(next);
    }
  }
});

let pendingFollowUp: string | null = null;
function submitText(text: string) {
  $<HTMLInputElement>('input').value = text;
  $<HTMLFormElement>('composer').requestSubmit();
}

/* ---------- voice: capture requests from the main process ---------- */
j.onAudioStart(async ({ id, kind }) => {
  try {
    const r = await startCapture(kind, (pcm, level) => j.sendPcm(kind, pcm, level));
    j.audioReply('audio:start', id, { ok: true, systemAudio: r.systemAudio });
    if (kind === 'ptt') $('mic').classList.add('live');
  } catch (err) {
    j.audioReply('audio:start', id, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
j.onAudioStop(async ({ id }) => {
  await stopCapture();
  $('mic').classList.remove('live');
  j.audioReply('audio:stop', id, { ok: true });
});
j.onVoiceAsk((text) => {
  if (MODE === 'voice') {
    void voiceAsk(text);
    return;
  }
  show('chat');
  submitText(text);
});

/* ---------- voice card (spoken requests; no chat window) ---------- */
let voiceBusy = false;
let voiceHideTimer: number | null = null;
const card = $('voice-card');
function fitVoice() {
  requestAnimationFrame(() => j.voiceResize(Math.ceil(card.getBoundingClientRect().height)));
}
function setVoiceStatus(text: string | null) {
  $('vc-status-text').textContent = text ?? '';
  $('vc-status').classList.toggle('hidden', text === null);
  fitVoice();
}
function hideVoiceSoon(ms: number) {
  if (voiceHideTimer) window.clearTimeout(voiceHideTimer);
  voiceHideTimer = window.setTimeout(function check() {
    // Stay while the pointer is over the card or a popup is open.
    if (card.matches(':hover') || !$('confirm').classList.contains('hidden') || !$('screen-pick').classList.contains('hidden')) {
      voiceHideTimer = window.setTimeout(check, 2000);
      return;
    }
    j.voiceHide();
  }, ms);
}
j.onAnnounce((a) => {
  if (MODE !== 'voice' || voiceBusy) return;
  if (voiceHideTimer) window.clearTimeout(voiceHideTimer);
  card.classList.remove('hidden', 'error');
  $('vc-name').textContent = a.name;
  ($('vc-orb') as HTMLElement).style.setProperty('--c', a.color);
  (document.querySelector('.vc-you .muted') as HTMLElement).textContent = a.title;
  $('vc-you').textContent = '';
  $('vc-answer').textContent = a.text;
  setVoiceStatus(null);
  speak(a.text, () => hideVoiceSoon(10_000), { voice: a.voice });
});

async function voiceAsk(text: string): Promise<void> {
  if (voiceHideTimer) window.clearTimeout(voiceHideTimer);
  stopSpeaking();
  voiceBusy = true;
  card.classList.remove('hidden', 'error');
  (document.querySelector('.vc-you .muted') as HTMLElement).textContent = 'You said';
  $('vc-you').textContent = text;
  $('vc-answer').textContent = '';
  setVoiceStatus('Thinking…');
  let followUp: string | undefined;
  try {
    awaitingLive = true;
    const r = await j.ask(text, null, { stream: true });
    $('vc-answer').textContent = r.reply;
    $('vc-name').textContent = r.roleName ?? 'Jarvis';
    ($('vc-orb') as HTMLElement).style.setProperty('--c', r.roleColor ?? '');
    card.classList.toggle('error', Boolean(r.isError));
    followUp = r.followUp;
    voiceBusy = false;
    setVoiceStatus(null);
    // Spoken requests are always answered out loud (usually already speaking while the reply was written).
    if (!r.isError && !followUp) finishLive(r, !r.lessonShown, () => hideVoiceSoon(6000)); // a lesson narrates itself
    else {
      finishLive({ ...r, isError: true }, false);
      if (!followUp) hideVoiceSoon(12000);
    }
  } catch (err) {
    finishLive({ reply: '', isError: true }, false);
    voiceBusy = false;
    card.classList.add('error');
    $('vc-answer').textContent = cleanError(err);
    setVoiceStatus(null);
    hideVoiceSoon(12000);
  }
  if (followUp) await voiceAsk(followUp);
}
$('vc-close').addEventListener('click', () => {
  stopSpeaking();
  if (voiceHideTimer) window.clearTimeout(voiceHideTimer);
  j.voiceHide();
});
$('vc-open').addEventListener('click', () => j.showMain());
$('mic').addEventListener('click', () => j.voiceToggle());

function showNotice(text: string) {
  const n = $('notice');
  n.textContent = text;
  n.classList.remove('hidden');
}

/* ---------- confirmation popup ---------- */
let confirmId: string | null = null;
j.onConfirm((req) => {
  confirmId = req.id;
  const badge = $('confirm-badge');
  badge.textContent = req.group;
  badge.className = `badge ${req.group}`;
  $('confirm-title').textContent = `Allow Jarvis to ${req.abilityTitle.toLowerCase()} in ${req.appName}?`;
  $('confirm-body').textContent = req.summary;
  $('confirm').classList.remove('hidden');
  $('confirm-no').focus();
});
j.onConfirmCancel((id) => {
  if (id === confirmId) closeConfirm();
});
function closeConfirm() {
  confirmId = null;
  $('confirm').classList.add('hidden');
}
$('confirm-yes').addEventListener('click', () => {
  if (confirmId) j.answerConfirm(confirmId, true);
  closeConfirm();
});
$('confirm-no').addEventListener('click', () => {
  if (confirmId) j.answerConfirm(confirmId, false);
  closeConfirm();
});

/* ---------- Tool Hub ---------- */
const ACCOUNT_HELP: Record<string, string> = {
  google:
    'One-time setup (about 10 minutes): create a free "Desktop app" sign-in client in Google Cloud, then paste its Client ID and Client secret here.',
  microsoft:
    'One-time setup (about 5 minutes): register a free app in Microsoft Entra, then paste its Application (client) ID here.',
};
const ACCOUNT_NAME: Record<string, string> = { google: 'Google', microsoft: 'Microsoft' };

/** Electron prefixes IPC errors with "Error invoking remote method …: Error: ". */
function cleanError(err: unknown): string {
  return String(err)
    .replace(/^Error: Error invoking remote method '[^']+': (\w*Error: )?/, '')
    .replace(/^Error: /, '');
}

function showHubError(err: unknown) {
  $('hub-error').textContent = err ? cleanError(err) : '';
}

/** Show the "finish in your browser" card while a sign-in is running. */
async function duringSignIn<T>(fn: () => Promise<T>): Promise<T | undefined> {
  showHubError(null);
  $('signin-wait').classList.remove('hidden');
  try {
    return await fn();
  } catch (err) {
    showHubError(err);
    return undefined;
  } finally {
    $('signin-wait').classList.add('hidden');
  }
}
$('signin-cancel').addEventListener('click', () => j.cancelSignIn());

async function renderAccounts(list?: Account[]) {
  const accounts = list ?? (await j.accountsList());
  const root = $('accounts');
  root.replaceChildren(...accounts.map((a) => (a.configured || a.connected ? accountCard(a) : setupCard(a))));
}

function accountCard(a: Account): HTMLElement {
  const card = el('div', { className: 'card' });
  const pill = el('span', { className: `pill${a.connected ? ' ok' : ''}` }, a.connected ? 'Connected' : 'Not connected');
  card.append(el('div', { className: 'app-head' }, el('h3', {}, `${a.name} account`), pill));
  if (a.connected) {
    card.append(el('div', {}, a.email ? `Signed in as ${a.email}` : 'Signed in'));
    const out = el('button', {}, 'Disconnect');
    out.addEventListener('click', async () => {
      await renderAccounts(await j.accountsDisconnect(a.id));
      renderHub();
    });
    card.append(el('div', { className: 'row-buttons' }, out));
    return card;
  }
  const go = el('button', { className: 'primary' }, `Sign in with ${a.name}`);
  go.addEventListener('click', async () => {
    const res = await duringSignIn(() => j.accountsConnect(a.id));
    if (res) {
      await renderAccounts(res);
      renderHub();
    }
  });
  const change = el('button', { className: 'link' }, 'Change setup');
  change.addEventListener('click', () => card.replaceWith(setupCard(a)));
  card.append(el('div', { className: 'row-buttons' }, go, change));
  return card;
}

function setupCard(a: Account): HTMLElement {
  const card = el('div', { className: 'card' });
  card.append(el('div', { className: 'app-head' }, el('h3', {}, `${a.name} account`), el('span', { className: 'pill' }, 'Needs setup')));
  card.append(el('div', { className: 'help' }, ACCOUNT_HELP[a.id] ?? ''));
  const guide = el('button', { className: 'link', type: 'button' }, 'Step-by-step guide');
  guide.addEventListener('click', () => j.accountsOpenGuide(a.id).catch(showHubError));
  const open = el('button', { className: 'link', type: 'button' }, `Open ${a.name} console`);
  open.addEventListener('click', () => j.accountsOpenConsole(a.id));
  const id = el('input', { placeholder: 'Client ID', autocomplete: 'off' });
  const secret = el('input', { placeholder: 'Client secret', type: 'password', autocomplete: 'off' });
  const form = el('form', { className: 'stack' }, el('label', {}, 'Client ID', id));
  if (a.needsSecret) form.append(el('label', {}, 'Client secret (kept in your system keychain)', secret));
  form.append(el('div', { className: 'row-buttons' }, el('button', { type: 'submit' }, 'Save'), guide, open));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!id.value.trim() || (a.needsSecret && !secret.value.trim())) {
      showHubError(a.needsSecret ? 'Please paste both the Client ID and the Client secret.' : 'Please paste the Client ID.');
      return;
    }
    try {
      showHubError(null);
      await renderAccounts(await j.accountsSetup(a.id, id.value.trim(), a.needsSecret ? secret.value.trim() : undefined));
    } catch (err) {
      showHubError(err);
    }
  });
  card.append(form);
  return card;
}

async function renderHub(list?: HubApp[]) {
  const apps = list ?? (await j.hubList());
  const root = $('hub-list');
  root.replaceChildren();
  for (const a of apps) {
    const toggle = el('input', { type: 'checkbox', checked: a.enabled, className: 'switch', title: a.enabled ? 'On' : 'Off' });
    toggle.addEventListener('change', async () => renderHub(await j.hubSetEnabled(a.id, toggle.checked)));
    let status = a.connected ? 'Connected' : 'Not connected';
    if (!a.connected && a.account) status = `Sign in to ${ACCOUNT_NAME[a.account]} above`;
    const head = el(
      'div',
      { className: 'app-head' },
      el('h3', {}, a.name),
      el('span', { className: `pill${a.connected ? ' ok' : ''}` }, status),
      toggle,
    );
    if (a.auth === 'oauth') {
      const signIn = el('button', {}, a.connected ? 'Sign in again' : 'Sign in');
      signIn.addEventListener('click', async () => {
        const res = await duringSignIn(() => j.hubSignIn(a.id));
        if (res) renderHub(res);
      });
      head.append(signIn);
    }
    if (a.kind === 'mcp') {
      const rm = el('button', {}, 'Remove');
      rm.addEventListener('click', async () => {
        await renderHub(await j.hubRemove(a.id));
        renderSuggested();
      });
      head.append(rm);
    }
    const table = el('table', { className: 'abilities' });
    for (const ab of a.abilities) {
      const select = el('select');
      for (const opt of ab.options) select.append(el('option', { value: opt, selected: opt === ab.setting }, SETTING_LABEL[opt]));
      select.addEventListener('change', async () => {
        try {
          showHubError(null);
          renderHub(await j.hubSetAbility(a.id, ab.name, select.value));
        } catch (err) {
          showHubError(err);
        }
      });
      table.append(
        el(
          'tr',
          {},
          el('td', {}, ab.title, el('div', { className: 'muted' }, ab.description)),
          el('td', { className: 'group' }, ab.group),
          el('td', {}, select),
        ),
      );
    }
    const details = el('details', {}, el('summary', {}, `What Jarvis may do (${a.abilities.length})`), table);
    const users = (teamCache?.roles ?? []).filter((r) => r.id !== 'jarvis' && r.apps.includes(a.name));
    const usedBy = el('div', { className: 'used-by' }, users.length ? 'Used by ' : 'Used by Jarvis');
    for (const u of users) {
      const chip = el('span', { className: 'role-tag' }, el('i', {}), u.name);
      chip.style.setProperty('--c', u.color);
      usedBy.append(chip);
    }
    root.append(el('div', { className: 'card' }, head, el('div', { className: 'muted' }, a.description), usedBy, details));
  }
}

async function renderSuggested() {
  const list = await j.hubSuggested();
  const root = $('suggested');
  root.replaceChildren();
  for (const s of list) {
    const card = el(
      'div',
      { className: 'card' },
      el('div', { className: 'app-head' }, el('h3', {}, s.name)),
      el('div', { className: 'muted' }, s.description),
    );
    if (s.added) {
      card.append(el('div', {}, el('span', { className: 'pill ok' }, 'Added')));
    } else if (s.auth === 'key') {
      const key = el('input', { type: 'password', placeholder: 'Access token', autocomplete: 'off' });
      const add = el('button', { className: 'primary' }, 'Add');
      add.addEventListener('click', async () => {
        if (!key.value.trim()) return showHubError(`Paste your ${s.name} access token first.`);
        try {
          showHubError(null);
          add.disabled = true;
          await renderHub(await j.hubAddMcp({ id: s.id, name: s.name, url: s.url, apiKey: key.value.trim() }));
          renderSuggested();
        } catch (err) {
          showHubError(err);
        } finally {
          add.disabled = false;
        }
      });
      card.append(el('div', { className: 'help' }, s.keyHelp ?? ''), key, el('div', { className: 'row-buttons' }, add));
    } else {
      const add = el('button', { className: 'primary' }, s.auth === 'none' ? 'Add' : 'Add and sign in');
      add.addEventListener('click', async () => {
        const res = await duringSignIn(() => j.hubAddMcp({ id: s.id, name: s.name, url: s.url }));
        if (res) {
          await renderHub(res);
          renderSuggested();
        }
      });
      card.append(el('div', { className: 'row-buttons' }, add));
    }
    root.append(card);
  }
}

$('add-app').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const data = Object.fromEntries(new FormData(f).entries()) as Record<string, string>;
  const [command, ...args] = (data.command ?? '').trim().split(/\s+/).filter(Boolean);
  $('add-error').textContent = '';
  const res = await duringSignIn(() =>
    j.hubAddMcp({ name: data.name, url: data.url || undefined, command, args, apiKey: data.apiKey || undefined }),
  );
  if (res) {
    f.reset();
    renderHub(res);
  } else {
    $('add-error').textContent = $('hub-error').textContent;
  }
});

/* ---------- usage ---------- */
interface UsageEntry { ts: string; request: string; model: string; tokens: number; expensive: boolean; usage?: { input: number; output: number; cacheCreation: number; cacheRead: number } }

async function renderUsage() {
  const s = await j.usageSummary();
  const stat = (label: string, value: string) => el('div', { className: 'stat' }, el('b', {}, value), el('span', {}, label));
  const today: UsageEntry[] = s.entries.filter((e: UsageEntry) => new Date(e.ts).toDateString() === new Date().toDateString());
  $('usage-stats').replaceChildren(
    stat('Tokens today', s.todayTotal.toLocaleString()),
    stat('Requests today', String(today.length)),
    stat('Reused from cache today', s.todayReused ? `${s.todayReused.toLocaleString()}` : '0'),
    stat('Unusually large today', String(today.filter((e) => e.expensive).length)),
  );
  renderUsageChart(s.entries.slice(-30), s.baseline);
  renderRings(today);

  const head = () => el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'Request'), el('th', {}, 'Model'), el('th', { className: 'num' }, 'Tokens'));
  const row = (e: UsageEntry, flag: boolean) =>
    el(
      'tr',
      { className: flag && e.expensive ? 'hot' : '' },
      el('td', {}, new Date(e.ts).toLocaleTimeString()),
      el('td', {}, flag && e.expensive ? `▲ ${e.request}` : e.request),
      el('td', {}, e.model),
      el('td', { className: 'num', title: e.usage ? `${(e.usage.cacheRead ?? 0).toLocaleString()} reused from cache (cheaper), ${(e.usage.input + e.usage.output + e.usage.cacheCreation).toLocaleString()} new` : '' }, e.tokens.toLocaleString()),
    );
  $('usage-top').replaceChildren(head(), ...s.topExpensive.map((e: UsageEntry) => row(e, false)));
  $('usage-table').replaceChildren(head(), ...[...s.entries].reverse().map((e: UsageEntry) => row(e, true)));
}

/** Single-series bar chart: one bar per request, expensive ones marked ▲ (not by color alone). */
function renderUsageChart(entries: UsageEntry[], baseline: number | null) {
  const root = $('usage-chart');
  const tip = $('chart-tip');
  $('chart-sub').textContent = entries.length ? `last ${entries.length} requests` : '';
  if (entries.length === 0) {
    root.replaceChildren(el('div', { className: 'chart-empty' }, 'No requests yet. Ask Jarvis something to see usage here.'));
    return;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const W = Math.max(320, root.clientWidth || 800);
  const H = 240;
  const pad = { l: 48, r: 8, t: 18, b: 22 };
  const max = Math.max(...entries.map((e) => e.tokens), (baseline ?? 0) * 3, 1);
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / entries.length;
  const barW = Math.max(3, Math.min(28, slot - 2)); // >= 2px gap between bars
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Tokens per request; full numbers are in the Recent requests table below');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text) n.textContent = text;
    svg.append(n);
    return n;
  };
  const defs = document.createElementNS(NS, 'defs');
  for (const [id, light, base] of [['bar-cool', '#5fd3ee', '#12a2c6'], ['bar-hot', '#d76be0', '#b02fb8']]) {
    const g = document.createElementNS(NS, 'linearGradient');
    g.id = id;
    g.setAttribute('x1', '0');
    g.setAttribute('y1', '0');
    g.setAttribute('x2', '0');
    g.setAttribute('y2', '1');
    for (const [off, col] of [['0', light], ['1', base]]) {
      const st = document.createElementNS(NS, 'stop');
      st.setAttribute('offset', off);
      st.setAttribute('stop-color', col);
      g.append(st);
    }
    defs.append(g);
  }
  svg.append(defs);
  for (let v = 0; v <= top; v += step) {
    add('line', { class: 'grid-line', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) });
    add('text', { class: 'axis-label', x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, compact(v));
  }
  if (baseline) {
    add('line', { class: 'baseline', x1: pad.l, x2: W - pad.r, y1: y(baseline * 3), y2: y(baseline * 3) });
    add('text', { class: 'baseline-label', x: W - pad.r, y: y(baseline * 3) - 5, 'text-anchor': 'end' }, '3× baseline');
  }
  entries.forEach((e, i) => {
    const x = pad.l + i * slot + (slot - barW) / 2;
    const h = Math.max(1, y(0) - y(e.tokens));
    const r = Math.min(4, barW / 2, h);
    // Rounded top (4px), square at the baseline.
    const d = `M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + barW - r} Q${x + barW},${y(0) - h} ${x + barW},${y(0) - h + r} V${y(0)} Z`;
    const bar = add('path', { class: `bar${e.expensive ? ' hot' : ''}`, d });
    if (e.expensive) add('text', { class: 'flag', x: x + barW / 2, y: y(0) - h - 4 }, '▲');
    const hit = add('rect', { class: 'hit', x: pad.l + i * slot, y: pad.t, width: slot, height: H - pad.t - pad.b });
    hit.addEventListener('pointerenter', () => {
      bar.classList.add('hover');
      const cached = e.usage?.cacheRead ? ` (${e.usage.cacheRead.toLocaleString()} reused from cache)` : '';
      tip.replaceChildren(
        el('div', {}, el('b', {}, `${e.tokens.toLocaleString()} tokens`), cached),
        el('div', { className: 'muted' }, `${new Date(e.ts).toLocaleTimeString()} · ${e.model}`),
        el('div', {}, e.request),
        ...(e.expensive ? [el('div', {}, '▲ above 3× baseline')] : []),
      );
      tip.classList.remove('hidden');
      const card = root.parentElement!.getBoundingClientRect();
      const b = (hit as SVGGraphicsElement).getBoundingClientRect();
      tip.style.left = `${Math.min(card.width - 290, Math.max(8, b.left - card.left + b.width / 2 - 140))}px`;
      tip.style.top = `${b.top - card.top + 8}px`;
    });
    hit.addEventListener('pointerleave', () => {
      bar.classList.remove('hover');
      tip.classList.add('hidden');
    });
  });
  root.replaceChildren(svg);
}

/** Two radial progress rings, as in the design. Each shows its number in text too. */
function renderRings(today: UsageEntry[]) {
  const total = today.reduce((a, e) => a + e.tokens, 0);
  const cached = today.reduce((a, e) => a + (e.usage?.cacheRead ?? 0), 0);
  const normal = today.filter((e) => !e.expensive).length;
  const rings: [number | null, string, string, string][] = [
    [total ? cached / total : null, '#e6e6e6', 'Reused from cache', 'Share of today’s tokens Claude reused from memory (cheaper).'],
    [today.length ? normal / today.length : null, '#5a8fd0', 'Normal-cost requests', 'Requests today that stayed under 3× your baseline.'],
  ];
  const NS = 'http://www.w3.org/2000/svg';
  $('usage-rings').replaceChildren(
    ...rings.map(([frac, color, title, sub]) => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 92 92');
      const r = 38;
      const c = 2 * Math.PI * r;
      const track = document.createElementNS(NS, 'circle');
      track.setAttribute('class', 'track');
      const val = document.createElementNS(NS, 'circle');
      val.setAttribute('class', 'value');
      for (const n of [track, val]) {
        n.setAttribute('cx', '46');
        n.setAttribute('cy', '46');
        n.setAttribute('r', String(r));
      }
      val.setAttribute('stroke', color);
      val.setAttribute('style', `color:${color}`);
      val.setAttribute('stroke-dasharray', `${c * (frac ?? 0)} ${c}`);
      val.setAttribute('transform', 'rotate(-90 46 46)');
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('class', 'pct');
      label.setAttribute('x', '46');
      label.setAttribute('y', '46');
      label.textContent = frac === null ? '–' : `${Math.round(frac * 100)}%`;
      svg.append(track, val, label);
      return el('div', { className: 'card ring-card' }, svg, el('div', {}, el('b', {}, title), el('span', {}, sub)));
    }),
  );
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/* ---------- activity ---------- */
async function renderActivity() {
  const list = await j.activityList();
  $('activity-table').replaceChildren(
    el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'App'), el('th', {}, 'Ability'), el('th', {}, 'Outcome'), el('th', {}, 'Detail')),
    ...[...list].reverse().map((e) =>
      el('tr', {}, el('td', {}, new Date(e.ts).toLocaleString()), el('td', {}, e.appId), el('td', {}, e.ability), el('td', {}, e.outcome), el('td', {}, e.detail)),
    ),
  );
}

/* ---------- settings ---------- */
/* ---------- natural voice settings ---------- */
const SAMPLE = "Hello, I'm Jarvis. This is how I'll sound when I read your messages and answers aloud.";
async function renderTts() {
  const st = await j.ttsStatus();
  const pill = $('tts-pill');
  pill.textContent = st.installed ? 'Ready' : 'Not installed';
  pill.className = `pill${st.installed ? ' ok' : ''}`;
  $('tts-install').classList.toggle('hidden', st.installed);
  const sel = $<HTMLSelectElement>('tts-voice');
  if (!sel.options.length) {
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const v of st.voices) {
      const key = `${v.accent} ${v.gender.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, el('optgroup', { label: key }));
      groups.get(key)!.append(el('option', { value: v.id }, `${v.name}  ·  grade ${v.grade}`));
    }
    sel.append(...groups.values());
  }
  sel.value = st.voice;
  const speed = $<HTMLInputElement>('tts-speed');
  speed.value = String(st.speed);
  $('tts-speed-label').textContent = `${Number(st.speed).toFixed(2)}×`;
}
$('tts-install').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('tts-install');
  btn.disabled = true;
  $('tts-error').textContent = '';
  $('tts-progress').classList.remove('hidden');
  try {
    await j.ttsInstall();
  } catch (err) {
    $('tts-error').textContent = cleanError(err);
  } finally {
    btn.disabled = false;
    $('tts-progress').classList.add('hidden');
    void renderTts();
  }
});
j.onTtsProgress(({ label, fraction }) => {
  const bar = $('tts-progress');
  (bar.querySelector('i') as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
  bar.querySelector('span')!.textContent = `${label} ${Math.round(fraction * 100)}%`;
});
$('tts-voice').addEventListener('change', async () => {
  await j.settingsSet({ ttsVoice: $<HTMLSelectElement>('tts-voice').value });
  void speak(SAMPLE);
});
$('tts-speed').addEventListener('input', () => {
  $('tts-speed-label').textContent = `${Number($<HTMLInputElement>('tts-speed').value).toFixed(2)}×`;
});
$('tts-speed').addEventListener('change', async () => {
  await j.settingsSet({ ttsSpeed: Number($<HTMLInputElement>('tts-speed').value) });
});
$('tts-sample').addEventListener('click', () => void speak(SAMPLE));

async function renderVoice() {
  const st = await j.speechStatus();
  const pill = $('speech-pill');
  pill.textContent = st.ready ? 'Ready' : 'Not installed';
  pill.className = `pill${st.ready ? ' ok' : ''}`;
  $('speech-install').classList.toggle('hidden', st.ready || Boolean(st.help));
  $('speech-help').textContent = st.help ?? '';
  $('speech-help').classList.toggle('hidden', !st.help);
  const hk = $<HTMLInputElement>('ptt-hotkey');
  if (document.activeElement !== hk) hk.value = st.hotkey ?? '';
  const ck = $<HTMLInputElement>('card-hotkey');
  if (document.activeElement !== ck) ck.value = (await j.cardHotkey()) ?? '';
}
$('card-save').addEventListener('click', async () => {
  $('ptt-error').textContent = '';
  try {
    $<HTMLInputElement>('card-hotkey').value = await j.setCardHotkey($<HTMLInputElement>('card-hotkey').value || null);
  } catch (err) {
    $('ptt-error').textContent = cleanError(err);
  }
});
$('speech-check').addEventListener('click', () => void renderVoice());
$('speech-install').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('speech-install');
  btn.disabled = true;
  $('speech-progress').classList.remove('hidden');
  try {
    await j.speechInstall();
  } catch (err) {
    $('ptt-error').textContent = cleanError(err);
  } finally {
    btn.disabled = false;
    $('speech-progress').classList.add('hidden');
    void renderVoice();
  }
});
j.onSpeechProgress(({ label, fraction }) => {
  const bar = $('speech-progress');
  (bar.querySelector('i') as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
  bar.querySelector('span')!.textContent = `${label} ${Math.round(fraction * 100)}%`;
});
$('ptt-save').addEventListener('click', async () => {
  $('ptt-error').textContent = '';
  try {
    $<HTMLInputElement>('ptt-hotkey').value = await j.setHotkey($<HTMLInputElement>('ptt-hotkey').value || null);
  } catch (err) {
    $('ptt-error').textContent = cleanError(err);
  }
});

async function renderSettings(s?: any) {
  const snap = s ?? (await j.settingsGet());
  $<HTMLSelectElement>('model-override').value = snap.modelOverride ?? '';
  $<HTMLInputElement>('voice-output').checked = snap.voiceOutput;
  $<HTMLInputElement>('keep-history').checked = snap.keepHistory !== false;
  $<HTMLSelectElement>('explain-level').value = snap.explainLevel ?? 'auto';
  voiceOn = snap.voiceOutput;
}
$('model-override').addEventListener('change', async (e) => {
  const v = (e.target as HTMLSelectElement).value;
  renderSettings(await j.settingsSet({ modelOverride: v || null }));
});
$('voice-output').addEventListener('change', async (e) => {
  renderSettings(await j.settingsSet({ voiceOutput: (e.target as HTMLInputElement).checked }));
});
async function renderSupervisor(patch?: Record<string, unknown>) {
  const s = await j.supSettings(patch);
  $<HTMLSelectElement>('sup-autonomy').value = s.autonomy;
  $<HTMLSelectElement>('sup-updates').value = String(s.updateEvery);
  $<HTMLInputElement>('sup-speak').checked = s.speak;
  $<HTMLInputElement>('sup-watch').checked = s.watchOwn;
  $('sup-watch-help').textContent = `This adds two small entries (marked "jarvis-claude-hook") to ${s.claudeSettings}; turning it off removes exactly those. A copy of the original file is kept next to it.`;
}
$('sup-watch').addEventListener('change', async (e) => {
  $('sup-watch-error').textContent = '';
  try {
    await j.supWatchOwn((e.target as HTMLInputElement).checked);
  } catch (err) {
    $('sup-watch-error').textContent = cleanError(err);
  }
  void renderSupervisor();
});
if (MODE === 'main') void renderSupervisor();
if (MODE === 'main') void loadTeam();
$('sup-autonomy').addEventListener('change', (e) => void renderSupervisor({ autonomy: (e.target as HTMLSelectElement).value }));
$('sup-updates').addEventListener('change', (e) => void renderSupervisor({ updateEvery: Number((e.target as HTMLSelectElement).value) }));
$('sup-speak').addEventListener('change', (e) => void renderSupervisor({ speak: (e.target as HTMLInputElement).checked }));
$('keep-history').addEventListener('change', async (e) => {
  const keep = (e.target as HTMLInputElement).checked;
  await j.historySet(keep);
  $('history-status').textContent = keep ? 'History is kept on this computer.' : 'History is off and was cleared.';
});
$('clear-history').addEventListener('click', async () => {
  await j.historyClear();
  $('history-status').textContent = 'Cleared.';
});
$('explain-level').addEventListener('change', async (e) => {
  renderSettings(await j.settingsSet({ explainLevel: (e.target as HTMLSelectElement).value }));
});
j.onSettings((s) => renderSettings(s));

/* ---------- whiteboard ---------- */
const board = initWhiteboard($<HTMLCanvasElement>('board'), () => {
  board.clear();
  j.wbCleared();
});
j.onWhiteboardClear(() => board.clear());
j.onWbDraw((elements: Element[]) => {
  show('whiteboard');
  board.draw(elements);
});
j.onWbSnapshot((id: string) => j.wbSnapshotReply(id, board.snapshot()));
for (const format of ['png', 'pdf'] as const) {
  $(`wb-${format}`).addEventListener('click', async () => {
    try {
      await j.wbExport(format, board.exportData(format));
    } catch (err) {
      alertInline($('board'), String(err));
    }
  });
}
function alertInline(after: HTMLElement, text: string) {
  after.after(el('div', { className: 'error' }, text));
}

/* ---------- screen picker ---------- */
interface PickRequest { id: string; reason: string; sources: { id: string; name: string; kind: string; thumbnail: string }[] }
let pickId: string | null = null;
function closePick(choice: { sourceId: string; area: boolean } | null) {
  if (pickId) j.screenPickReply(pickId, choice);
  pickId = null;
  $('screen-pick').classList.add('hidden');
}
j.onScreenPick((req: PickRequest) => {
  if (pickId) closePick(null);
  pickId = req.id;
  $('screen-reason').textContent = req.reason ? `Jarvis wants to: ${req.reason}` : '';
  $<HTMLInputElement>('screen-area').checked = false;
  const sorted = [...req.sources].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1));
  $('screen-sources').replaceChildren(
    ...sorted.map((s) => {
      const b = el('button', { className: 'source', title: s.name }, el('img', { src: s.thumbnail, alt: '' }), el('span', {}, s.kind === 'screen' ? `🖥 ${s.name}` : s.name));
      b.addEventListener('click', () => closePick({ sourceId: s.id, area: $<HTMLInputElement>('screen-area').checked }));
      return b;
    }),
  );
  $('screen-pick').classList.remove('hidden');
});
$('screen-cancel').addEventListener('click', () => closePick(null));

/* ---------- area picker ---------- */
let areaId: string | null = null;
let areaRect: { x: number; y: number; width: number; height: number } | null = null;
const areaImg = $<HTMLImageElement>('area-img');
const areaBox = $('area-rect');
function closeArea(send: boolean) {
  if (areaId) j.screenAreaReply(areaId, send ? areaRect : null);
  areaId = null;
  areaRect = null;
  $('area-pick').classList.add('hidden');
}
j.onScreenArea((req: { id: string; preview: string }) => {
  if (areaId) closeArea(false);
  areaId = req.id;
  areaRect = null;
  areaBox.classList.add('hidden');
  $<HTMLButtonElement>('area-ok').disabled = true;
  areaImg.src = req.preview;
  $('area-pick').classList.remove('hidden');
});
let dragStart: { x: number; y: number } | null = null;
const norm = (ev: PointerEvent) => {
  const r = areaImg.getBoundingClientRect();
  return { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) };
};
areaImg.addEventListener('pointerdown', (ev) => {
  areaImg.setPointerCapture(ev.pointerId);
  dragStart = norm(ev);
});
areaImg.addEventListener('pointermove', (ev) => {
  if (!dragStart) return;
  const p = norm(ev);
  areaRect = { x: Math.min(dragStart.x, p.x), y: Math.min(dragStart.y, p.y), width: Math.abs(p.x - dragStart.x), height: Math.abs(p.y - dragStart.y) };
  const img = areaImg.getBoundingClientRect();
  const stage = areaImg.parentElement!.getBoundingClientRect();
  Object.assign(areaBox.style, {
    left: `${img.left - stage.left + areaRect.x * img.width}px`,
    top: `${img.top - stage.top + areaRect.y * img.height}px`,
    width: `${areaRect.width * img.width}px`,
    height: `${areaRect.height * img.height}px`,
  });
  areaBox.classList.remove('hidden');
});
areaImg.addEventListener('pointerup', () => {
  dragStart = null;
  $<HTMLButtonElement>('area-ok').disabled = !areaRect || areaRect.width < 0.01 || areaRect.height < 0.01;
});
$('area-ok').addEventListener('click', () => closeArea(true));
$('area-cancel').addEventListener('click', () => closeArea(false));

/* ---------- setup ---------- */
async function runSetup() {
  const s = await j.setupCheck();
  if (s.envNotice) showNotice(s.envNotice);
  const overlay = $('setup');
  const testBtn = $('setup-test');
  if (s.step === 'ready' && s.baseline) {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  if (s.step === 'install' || s.step === 'login') {
    $('setup-text').textContent = s.instructions;
    testBtn.classList.add('hidden');
  } else {
    $('setup-text').textContent = 'Claude Code is installed and logged in.\nRun one small test request to record your baseline token use.';
    testBtn.classList.remove('hidden');
  }
}
$('setup-retry').addEventListener('click', runSetup);
$('setup-test').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('setup-test');
  btn.disabled = true;
  $('setup-text').textContent = 'Running test request…';
  const r = await j.setupBaseline();
  btn.disabled = false;
  if (r.ok) {
    $('setup').classList.add('hidden');
    addMsg('jarvis', r.reply, `setup test · baseline ${r.tokens.toLocaleString()} tokens`);
  } else {
    $('setup-text').textContent = `The test request failed:\n${r.reply}`;
  }
});

void renderSettings();
if (MODE === 'main') void runSetup();
void refreshChips();
