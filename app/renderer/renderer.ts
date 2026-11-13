/** Renderer UI. All untrusted text is inserted with textContent, never innerHTML. */
import { initTts, isSpeaking, speak, speakStream, speakWhenFree, stopSpeaking } from '../../speech/tts.js';
import { startWorldMap } from './worldmap.js';
import { Onboarding, sayMyName } from './onboard.js';
import { renderMarkdown } from './markdown.js';
import { startCapture, stopCapture, CaptureKind } from './audio.js';
import { initViewerPanel, ShownSet } from './viewer-panel.js';

interface Ability { name: string; title: string; description: string; group: string; setting: string; options: string[] }
/** A Tool Hub app: one of Jarvis's own tools, or (kind "connector") an app from the user's Claude account. */
interface HubApp { id: string; name: string; description: string; kind: string; enabled: boolean; connected: boolean; status: string | null; maker: string | null; category: string | null; toolCount: number; auth: string | null; abilities: Ability[]; members: string[]; everyone: boolean; membersChanged: boolean }
interface ConfirmReq { id: string; appName: string; abilityTitle: string; group: string; summary: string; title?: string }

declare global {
  interface Window {
    jarvis: {
      setupCheck(): Promise<any>;
      setupBaseline(): Promise<any>;
      onboardState(): Promise<any>;
      onboardSetName(name: string): Promise<string>;
      nameGet(): Promise<{ name: string; sayAs: string }>;
      appUninstall(): Promise<boolean>;
      mediaSpeaking(on: boolean): void;
      ask(text: string, role?: string | null, opts?: { stream?: boolean; files?: string[] }): Promise<any>;
      onAskStart(cb: (s: { roleName: string; roleColor: string; voice: string }) => void): void;
      onAskPartial(cb: (d: string) => void): void;
      onAskNote(cb: (n: { text: string; roleName: string; roleColor: string; first: boolean }) => void): void;
      onViewerShow(cb: (v: ShownSet & { id: string; who: string; color: string; card: boolean }) => void): void;
      viewerRead(rel: string): Promise<{ text: string; cut: boolean; kind: string }>;
      viewerOpen(rel: string): Promise<void>;
      viewerReveal(rel: string): Promise<void>;
      historyPrepare(): Promise<{ conv: string; isNew: boolean }>;
      historyList(query?: string): Promise<{ items: ConvSummary[]; current: string | null }>;
      historyOpen(id: string): Promise<{ conv: ConvSummary; messages: HistoryItem[]; current: boolean }>;
      historyContinue(id: string): Promise<{ conv: ConvSummary; messages: HistoryItem[] }>;
      historyNew(): Promise<boolean>;
      historyRemove(ids: string[]): Promise<number>;
      onHistoryChanged(cb: (p: { newChat?: boolean }) => void): void;
      historySet(keep: boolean): Promise<boolean>;
      historyClear(): Promise<boolean>;
      onHistoryAdd(cb: (items: HistoryItem[]) => void): void;
      onHistoryCleared(cb: () => void): void;
      teamList(): Promise<{ roles: TeamRole[]; voices: { id: string; name: string; accent: string; gender: string; grade: string }[] }>;
      teamSetVoice(role: string, voice: string): Promise<string>;
      onTeamRenamed(cb: () => void): void;
      teamSetName(role: string, name: string): Promise<string>;
      teamSaveNotes(role: string, text: string): Promise<string>;
      teamForget(role: string): Promise<string>;
      teamRefresh(role: string): Promise<string>;
      answerConfirm(id: string, yes: boolean): void;
      hubList(): Promise<HubApp[]>;
      hubSetEnabled(appId: string, on: boolean): Promise<HubApp[]>;
      hubSetAbility(appId: string, ability: string, setting: string): Promise<HubApp[]>;
      connectorsInfo(): Promise<{ checkedAt: number; checking: boolean; url: string; suggestions: { name: string; maker?: string; description: string; category: string }[] }>;
      connectorsRefresh(): Promise<HubApp[]>;
      connectorsOpen(): Promise<void>;
      onConnectorsChanged(cb: () => void): void;
      usageSummary(): Promise<any>;
      hubSetMembers(appId: string, members: string[] | null): Promise<HubApp[]>;
      activityList(): Promise<ActivityItem[]>;
      activityRemove(ids: string[]): Promise<number>;
      activityClear(): Promise<void>;
      teamOpenFolder(role: string): Promise<void>;
      settingsGet(): Promise<any>;
      settingsSet(patch: unknown): Promise<any>;
      toggleBox(): void;
      minimizeBox(): void;
      onConfirm(cb: (req: ConfirmReq) => void): void;
      onConfirmCancel(cb: (id: string) => void): void;
      onNavigate(cb: (view: string) => void): void;
      onNotice(cb: (text: string) => void): void;
      onSettings(cb: (s: any) => void): void;
      onScreenPick(cb: (req: any) => void): void;
      screenPickReply(id: string, choice: unknown): void;
      onScreenArea(cb: (req: any) => void): void;
      screenAreaReply(id: string, rect: unknown): void;
      onAudioStart(cb: (req: { id: string; kind: CaptureKind; screen?: boolean }) => void): void;
      onAudioStop(cb: (req: { id: string; kind?: CaptureKind }) => void): void;
      audioReply(channel: string, id: string, value: unknown): void;
      sendPcm(kind: string, data: Uint8Array, level: number): void;
      sendMeetingVideo(chunk: Uint8Array, mimeType: string): void;
      sendMeetingFrame(jpeg: Uint8Array): void;
      onShareRequest(cb: (req: { id: string; name: string; color: string; prompt: string }) => void): void;
      shareReply(id: string, paths: string[] | null): void;
      onShareClose(cb: (id: string) => void): void;
      pickAttachments(): Promise<{ name: string; path: string }[]>;
      pathOf(file: File): string;
      openMeetingsFolder(): Promise<void>;
      voiceToggle(): void;
      onVoiceAsk(cb: (text: string) => void): void;
      speechStatus(): Promise<{ engine: boolean; model: boolean; ready: boolean; help?: string; hotkey: string | null }>;
      speechInstall(): Promise<unknown>;
      onSpeechProgress(cb: (p: { label: string; fraction: number }) => void): void;
      setHotkey(accelerator: string | null): Promise<string>;
      cardHotkey(): Promise<string | null>;
      supSettings(patch?: unknown): Promise<{ autonomy: string; updateEvery: number; speak: boolean; watchOwn: boolean; claudeSettings: string }>;
      supWatchOwn(on: boolean): Promise<boolean>;
      paGet(): Promise<{ planAt: string | null; reviewAt: string | null; reminders: { id: string; text: string; at: string; from?: string }[] }>;
      paSetPlan(at: string | null): Promise<string | null>;
      paSetReview(at: string | null): Promise<string | null>;
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
      onSettingsChanged(cb: (s: { voiceOutput: boolean }) => void): void;
      voiceMinimize(): void;
      onChatMirror(cb: (m: { kind: 'user' | 'note'; text: string; via?: string; roleName?: string; color?: string }) => void): void;
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
// "Speak replies aloud" applies in every window, and follows changes made in another one
void j.settingsGet().then((s: { voiceOutput: boolean }) => (voiceOn = s.voiceOutput !== false));
j.onSettingsChanged((s) => {
  voiceOn = s.voiceOutput !== false;
  if (!voiceOn) stopSpeaking(); // turned off while something is being read: it stops
});
// first run: cover the app with the welcome's backdrop before the first frame is painted
if (MODE === 'main' && new URLSearchParams(location.search).get('welcome') === '1') {
  document.body.classList.add('onboarding');
  document.getElementById('onboard')?.classList.remove('hidden');
}
document.body.classList.add(MODE);
// the drifting world map behind the main window and the floating box
if (MODE === 'main' || MODE === 'box') startWorldMap(document.getElementById('worldmap') as HTMLCanvasElement);

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
  hub: 'Your apps and tools, and what your team may do in each  ·  changes apply on the next request',
  activity: 'What your team did or was stopped from doing, day by day',
  settings: 'Model, voice and shortcuts',
};
const TITLES: Record<string, string> = {
  chat: 'Chat',
  team: 'Team',
  hub: 'Tool Hub',
  activity: 'Activity',
  settings: 'Settings',
};
function show(view: string) {
  document.querySelectorAll<HTMLButtonElement>('#nav button[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  $('page-title').textContent = TITLES[view] ?? view;
  $('page-sub').textContent = SUBS[view] ?? '';
  movePill(activeTab());
  if (view === 'hub') void loadHub();
  if (view === 'team') void renderTeam();
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
function setStatus(state: 'ok' | 'busy' | 'err') {
  $('orb').classList.toggle('thinking', state === 'busy');
  document.body.classList.toggle('busy', state === 'busy');
}

/* ---------- live replies: speak while Claude is still writing ---------- */
let liveSpeech: ReturnType<typeof speakStream> | null = null;
let liveText = '';
/** True while this window waits for a streamed reply it asked for. */
let awaitingLive = false;
/** Requests sent from this window and not answered yet: members work at the same time. */
let inflight = 0;
j.onAskStart((s: { roleName: string; roleColor: string; voice: string }) => {
  if (!awaitingLive) return;
  liveText = '';
  // spoken only with "Speak replies aloud" on (the main chat, the floating box and the voice card alike)
  liveSpeech = voiceOn ? speakStream({ voice: s.voice }) : null;
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
    setVoiceStatus(false);
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
  skills?: { id: string; when: string }[];
  folder: string;
  model: string | null;
}
let teamCache: { roles: TeamRole[]; voices: { id: string; name: string; accent: string; gender: string; grade: string }[] } | null = null;
/** Who the chat talks to; null = Auto (Jarvis picks the right expert). */
let pickedRole: string | null = null;

// a member was renamed (here or in another window): every window shows the new name
j.onTeamRenamed(() => void loadTeam());

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
  $<HTMLInputElement>('input').placeholder = r ? `Ask ${r.id === 'jarvis' ? 'Jarvis' : `${r.person} (${r.name})`}…` : 'Ask anything… say a name to choose who answers';
  renderRoleChips();
}

function renderRoleChips() {
  const box = $('role-chips');
  if (!box || !teamCache) return;
  box.replaceChildren();
  const auto = roleChip('Auto', '#f0efec', pickedRole === null, 'Say a name to talk to someone; you stay with them until you name someone else');
  auto.addEventListener('click', () => pickRole(null));
  box.append(auto);
  // Jarvis is the front desk, not someone you talk to: only the experts are here
  for (const r of teamCache.roles.filter((x) => x.id !== 'jarvis')) {
    const c = roleChip(r.person, r.color, pickedRole === r.id, `${r.name}: ${r.blurb}`);
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
  // the spoken end-of-day review: what got done, what is open, what is due tomorrow, anything missed
  const rOn = el('input', { type: 'checkbox', className: 'switch', checked: Boolean(pa.reviewAt) });
  const rTime = el('input', { type: 'time', value: pa.reviewAt ?? '18:30', className: 'pa-time' });
  const rSave = async () => void (await j.paSetReview(rOn.checked ? rTime.value : null));
  rOn.addEventListener('change', rSave);
  rTime.addEventListener('change', () => {
    if (rOn.checked) void rSave();
  });
  const wrap = el('button', { type: 'button', className: 'chip' }, 'Wrap up my day now');
  wrap.addEventListener('click', () => {
    pickRole('pa');
    show('chat');
    submitText('Wrap up my day: what got done today, what is still open, what is due tomorrow, and anything I missed in email.');
  });
  box.append(
    el('label', { className: 'team-row pa-row' }, el('span', {}, `Morning plan from ${r.person}`), time, on),
    el('label', { className: 'team-row pa-row' }, el('span', {}, `Evening review from ${r.person}`), rTime, rOn),
    el('div', { className: 'team-row' }, el('span', { className: 'spacer' }), now, wrap),
  );
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
      // one button, one action at a time: "Rename" opens the name box, "Save" saves what is typed in it
      // (it used to keep its "Rename" action too, which reopened the box with the old name and saved that)
      const rename = el('button', { type: 'button', className: 'chip team-rename', title: 'Rename' }, 'Rename');
      let input: HTMLInputElement | null = null;
      const err = el('div', { className: 'error small' });
      const save = async () => {
        if (!input) return;
        try {
          r.person = await j.teamSetName(r.id, input.value);
          void renderTeam();
        } catch (e) {
          err.textContent = cleanError(e);
        }
      };
      rename.addEventListener('click', () => {
        if (input) return void save();
        input = el('input', { className: 'team-name-input', value: r.person, maxLength: 20 });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') void renderTeam();
        });
        title.replaceWith(el('div', {}, input, err));
        rename.textContent = 'Save';
        rename.title = 'Save the new name';
        input.focus();
        input.select();
      });
      head.append(el('span', { className: 'spacer' }), rename);
    }
    card.append(head, el('p', { className: 'team-blurb' }, r.blurb));
    const apps = el('div', { className: 'team-apps' });
    for (const a of r.id === 'jarvis' ? ['Every app'] : r.apps) apps.append(el('span', { className: 'pill' }, a));
    card.append(apps);
    if (r.skills?.length) {
      const skills = el('div', { className: 'team-apps team-skills' });
      for (const k of r.skills) skills.append(el('span', { className: 'pill skill', title: `Used for: ${k.when}` }, k.id.replace(/-/g, ' ')));
      card.append(el('div', { className: 'team-sub muted small' }, 'Skills'), skills);
    }
    if (r.model) card.append(el('p', { className: 'muted small team-model' }, `Thinks with ${r.model}, the strongest model for building projects.`));

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
    const folder = el('button', { type: 'button', className: 'chip team-folder', title: `Open ${r.folder} in the Jarvis folder` }, 'Open folder');
    folder.addEventListener('click', () => void j.teamOpenFolder(r.id).catch((e: unknown) => showNotice(String(e))));
    // Jarvis is the front desk: you don't talk to it, it passes you to the right expert
    if (r.id === 'jarvis') card.append(el('div', { className: 'team-row team-actions' }, folder));
    else {
      const talk = el('button', { type: 'button', className: 'primary team-talk' }, `Talk to ${r.person}`);
      talk.addEventListener('click', () => {
        pickRole(r.id);
        show('chat');
        $<HTMLInputElement>('input').focus();
      });
      card.append(el('div', { className: 'team-row team-actions' }, talk, folder));
    }
    grid.append(card);
  }
  void renderBoard();
}

/* ---------- chat ---------- */
const messages = $('messages');
/** The preview next to the chat (files a member shows you). */
const viewer = initViewerPanel(j, (msg) => showNotice(msg));
/** A reply, formatted (bold, lists, code, links); links open in the browser. */
function mdBlock(text: string): HTMLElement {
  const box = el('div', { className: 'md' });
  box.innerHTML = renderMarkdown(text);
  return box;
}
function addMsg(who: 'user' | 'jarvis', text: string, meta?: string, isError = false, from?: { name: string; color: string }): HTMLElement {
  $('empty').classList.add('hidden');
  const m = el('div', { className: `msg ${who}${isError ? ' error' : ''}` });
  if (who === 'jarvis' && !isError) m.append(mdBlock(text));
  else m.append(el('div', { className: 'md plain' }, text));
  if (from) {
    const badge = el('span', { className: 'who' }, el('i', {}), from.name);
    badge.style.setProperty('--c', from.color);
    m.prepend(badge);
  }
  if (meta) m.append(el('span', { className: 'meta' }, meta));
  messages.append(m);
  messages.scrollTop = messages.scrollHeight;
  return m;
}
interface HistoryItem {
  id: string;
  conv: string;
  at: string;
  who: 'user' | 'assistant';
  text: string;
  roleName?: string;
  color?: string;
  via: 'chat' | 'voice' | 'box';
  meta?: string;
  error?: boolean;
  shown?: ShownSet[];
}
const VIA: Record<string, string> = { voice: ' · by voice', box: ' · floating box', chat: '' };
function showHistoryItem(i: HistoryItem) {
  if (i.who === 'user') addMsg('user', i.text, i.via !== 'chat' ? VIA[i.via].replace(' · ', '') : undefined);
  else {
    const m = addMsg('jarvis', i.text, `${i.meta ?? ''}${VIA[i.via] ?? ''}`, Boolean(i.error), i.roleName ? { name: i.roleName, color: i.color ?? '#9a9a96' } : undefined);
    if (i.meta === 'while working') m.classList.add('interim');
    // the files shown while answering: a card before the reply, to open them again
    const who = { who: (i.roleName ?? '').split(' · ')[0], color: i.color ?? '#9a9a96' };
    for (const set of i.shown ?? []) m.before(viewer.card(set, who));
  }
}
/* ---------- conversations: the History panel next to the chat ---------- */
interface ConvSummary { id: string; title: string; startedAt: string; updatedAt: string; count: number; people: { name: string; color: string }[] }
/** The conversation shown in the chat; null = a new, empty chat. */
let shownConv: string | null = null;
/** True while looking at an earlier conversation (read-only until "Continue"). */
let viewingOld = false;
let convSelecting = false;
const convSelected = new Set<string>();
let convItems: ConvSummary[] = [];
let convQuery = '';

function clearChatView() {
  messages.querySelectorAll('.msg, .note').forEach((n) => n.remove());
  $('empty').classList.remove('hidden');
}

/** Shows a saved conversation, with a date line wherever the day changes. */
function renderConversation(items: HistoryItem[]) {
  clearChatView();
  let day = '';
  for (const i of items) {
    const d = new Date(i.at).toDateString();
    if (d !== day) {
      addNote(dayLabel(new Date(i.at)));
      day = d;
    }
    showHistoryItem(i);
  }
  messages.scrollTop = messages.scrollHeight;
}

function setOldMode(conv: ConvSummary | null) {
  viewingOld = conv !== null;
  $('old-banner').classList.toggle('hidden', !viewingOld);
  $('composer').classList.toggle('hidden', viewingOld);
  $('role-chips').classList.toggle('hidden', viewingOld);
  if (conv) {
    const d = new Date(conv.updatedAt);
    $('old-when').textContent = `An earlier conversation · ${dayLabel(d)}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  }
}

/** Narrow windows show the panel over the chat; close it after picking. */
const narrow = () => window.matchMedia('(max-width: 860px)').matches;
function setChatsOpen(open: boolean) {
  const v = $('view-chat');
  if (narrow()) v.classList.toggle('chats-open', open);
  else {
    v.classList.toggle('chats-hidden', !open);
    try {
      localStorage.setItem('jarvis.chatsHidden', open ? '0' : '1');
    } catch {
      /* only a convenience */
    }
  }
}

async function startNewChat() {
  await j.historyNew();
  shownConv = null;
  setOldMode(null);
  clearChatView();
  if (narrow()) setChatsOpen(false);
  void renderChats();
  $<HTMLInputElement>('input').focus();
}

async function openConv(id: string) {
  if (convSelecting) return;
  const r = await j.historyOpen(id);
  renderConversation(r.messages);
  shownConv = id;
  setOldMode(r.current ? null : r.conv);
  if (narrow()) setChatsOpen(false);
  void renderChats();
}

async function continueConv() {
  if (!shownConv) return;
  const r = await j.historyContinue(shownConv);
  renderConversation(r.messages);
  addNote('Continuing this conversation');
  setOldMode(null);
  void renderChats();
  $<HTMLInputElement>('input').focus();
}

function convGroup(d: Date): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function syncChatsBar() {
  $('chats-bar').classList.toggle('hidden', !convSelecting);
  $('chats-select').textContent = convSelecting ? 'Done' : 'Select';
  const n = convSelected.size;
  $('chats-count').textContent = n ? `${n} selected` : '';
  $<HTMLButtonElement>('chats-delete').disabled = n === 0;
  const all = $<HTMLInputElement>('chats-all');
  all.checked = n > 0 && n === convItems.length;
  all.indeterminate = n > 0 && n < convItems.length;
}

async function renderChats() {
  if (MODE !== 'main') return;
  const { items } = await j.historyList(convQuery);
  convItems = items;
  for (const id of [...convSelected]) if (!items.some((c) => c.id === id)) convSelected.delete(id);
  const list = $('chats-list');
  if (!items.length) {
    list.replaceChildren(el('p', { className: 'chats-empty muted small' }, convQuery ? `No conversation mentions “${convQuery}”.` : 'Your conversations will appear here, grouped by day.'));
    syncChatsBar();
    return;
  }
  const out: HTMLElement[] = [];
  let group = '';
  for (const c of items) {
    const d = new Date(c.updatedAt);
    const g = convGroup(d);
    if (g !== group) {
      out.push(el('div', { className: 'chats-group' }, g));
      group = g;
    }
    const when = g === 'Today' || g === 'Yesterday' ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const dots = el('span', { className: 'chats-dots' });
    for (const p of c.people.slice(0, 5)) {
      const dot = el('i', { title: p.name });
      dot.style.background = p.color;
      dots.append(dot);
    }
    const item = el('button', { type: 'button', className: `chats-item${c.id === shownConv ? ' active' : ''}${convSelected.has(c.id) ? ' selected' : ''}`, title: c.title });
    if (convSelecting) {
      const box = el('input', { type: 'checkbox', className: 'activity-check', tabIndex: -1 });
      box.checked = convSelected.has(c.id);
      item.append(box);
    }
    item.append(el('span', { className: 'chats-title' }, c.title), el('span', { className: 'chats-meta' }, dots, el('span', { className: 'muted' }, `${when} · ${Math.ceil(c.count / 2)} message${c.count > 2 ? 's' : ''}`)));
    item.addEventListener('click', () => {
      if (!convSelecting) return void openConv(c.id);
      if (convSelected.has(c.id)) convSelected.delete(c.id);
      else convSelected.add(c.id);
      void renderChats();
    });
    out.push(item);
  }
  list.replaceChildren(...out);
  syncChatsBar();
}

/** After conversations were deleted: if the one on screen is gone, show an empty chat. */
function afterDelete(ids: string[]) {
  if (shownConv && ids.includes(shownConv)) {
    shownConv = null;
    setOldMode(null);
    clearChatView();
  }
}

if (MODE === 'main') {
  try {
    if (localStorage.getItem('jarvis.chatsHidden') === '1') $('view-chat').classList.add('chats-hidden');
  } catch {
    /* only a convenience */
  }
  void renderChats();
  $('chat-new').addEventListener('click', () => void startNewChat());
  $('old-new').addEventListener('click', () => void startNewChat());
  $('old-continue').addEventListener('click', () => void continueConv());
  $('chats-hide').addEventListener('click', () => setChatsOpen(false));
  $('chats-show').addEventListener('click', () => setChatsOpen(true));
  $('chats-select').addEventListener('click', () => {
    convSelecting = !convSelecting;
    convSelected.clear();
    void renderChats();
  });
  $('chats-all').addEventListener('change', (ev) => {
    convSelected.clear();
    if ((ev.target as HTMLInputElement).checked) for (const c of convItems) convSelected.add(c.id);
    void renderChats();
  });
  let searchTimer = 0;
  $('chats-q').addEventListener('input', (ev) => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      convQuery = (ev.target as HTMLInputElement).value.trim();
      void renderChats();
    }, 200);
  });
  confirmTwice($<HTMLButtonElement>('chats-delete'), 'Delete', () => `Delete ${convSelected.size} for good?`, async () => {
    const ids = [...convSelected];
    await j.historyRemove(ids);
    convSelected.clear();
    afterDelete(ids);
    void renderChats();
  });
  confirmTwice($<HTMLButtonElement>('chats-clear'), 'Delete all', () => 'Delete every conversation?', async () => {
    await j.historyClear();
    convSelected.clear();
    convSelecting = false;
  });
  // what was said by voice or in the floating box appears here too, if that conversation is on screen
  // a request said on the voice card (or typed in the box) shows here at once, with the member's first
  // line ("On it…"); once it is answered, the saved conversation replaces these
  j.onChatMirror((m: { kind: 'user' | 'note'; text: string; via?: string; roleName?: string; color?: string }) => {
    if (viewingOld) return;
    $('empty').classList.add('hidden');
    const el = m.kind === 'user'
      ? addMsg('user', m.text, m.via === 'voice' ? 'by voice' : 'floating box')
      : addMsg('jarvis', m.text, 'while working', false, { name: m.roleName ?? 'Jarvis', color: m.color ?? '#9a9a96' });
    el.classList.add('live-mirror');
    if (m.kind === 'note') el.classList.add('interim');
    setProgress(true);
  });
  j.onHistoryAdd((items) => {
    // the answer is in: what was shown while it was being answered makes way for the saved messages
    messages.querySelectorAll('.live-mirror').forEach((n) => n.remove());
    if (inflight === 0) setProgress(false);
    const conv = items[0]?.conv;
    if (!conv || viewingOld || (shownConv !== null && shownConv !== conv)) return;
    shownConv = conv;
    items.forEach(showHistoryItem);
  });
  j.onHistoryChanged((p) => {
    if (p?.newChat && !viewingOld) {
      shownConv = null;
      clearChatView();
    }
    void renderChats();
  });
  j.onHistoryCleared(() => {
    shownConv = null;
    setOldMode(null);
    clearChatView();
    void renderChats();
  });
}

function addNote(text: string) {
  messages.append(el('div', { className: 'note' }, text));
}

/** A quiet "typing" indicator while a reply is on its way (no step-by-step labels: they lagged behind). */
const progress = $('progress');
function setProgress(working: boolean) {
  progress.classList.toggle('hidden', !working);
  if (!working) $('progress-text').textContent = '';
  if (working) setStatus('busy');
}

j.onNotice((text) => showNotice(text));

/* ---------- while they work: "On it, about 2 minutes", then a quiet status line ---------- */
j.onAskNote(({ text, roleName, roleColor, first }) => {
  if (MODE === 'voice') return; // the voice card already speaks it as it is written
  if (first) {
    addMsg('jarvis', text, 'while working', false, { name: roleName, color: roleColor }).classList.add('interim');
    $('progress-text').textContent = '';
  } else $('progress-text').textContent = text.replace(/\s+/g, ' ').slice(0, 140);
});

/* ---------- files a member shows you: the preview next to the chat ---------- */
j.onViewerShow((v) => {
  if (MODE !== 'main') return;
  show('chat');
  const who = { who: v.who, color: v.color };
  viewer.open(v, who);
  if (v.card) {
    // more files for the same preview: the card is brought up to date instead of adding another
    const card = viewer.card(v, who);
    card.dataset.set = v.id;
    const old = messages.querySelector(`.msg.shown[data-set="${CSS.escape(v.id)}"]`);
    if (old) old.replaceWith(card);
    else messages.append(card);
    messages.scrollTop = messages.scrollHeight;
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-suggest]').forEach((b) =>
  b.addEventListener('click', () => {
    $<HTMLInputElement>('input').value = b.dataset.suggest ?? '';
    $<HTMLFormElement>('composer').requestSubmit();
  }),
);

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('input');
  const typed = input.value.trim() || (attached.length ? 'Please look at the file I attached.' : '');
  if (!typed) return;
  const files = attached.map((a) => a.name);
  const text = typed;
  const sendFiles = takeAttachments();
  input.value = '';
  // a new message quiets the last answer, unless a member is still working on an earlier one
  if (inflight === 0) stopSpeaking();
  if (MODE === 'main') {
    const prep = await j.historyPrepare();
    if (prep.conv !== shownConv) {
      if (shownConv !== null) {
        clearChatView();
        addNote('New conversation · the last message was over 30 minutes ago');
      }
      shownConv = prep.conv;
    }
  }
  addMsg('user', files.length ? `${typed}\n(attached: ${files.join(', ')})` : typed);
  // the box stays open: you can ask another member while the first one works
  inflight++;
  setProgress(true);
  // one reply is spoken while it is written; the others are said after it, in turn
  const streamThis = voiceOn && !awaitingLive;
  try {
    if (streamThis) awaitingLive = true;
    const r = await j.ask(text, pickedRole, { stream: streamThis, files: sendFiles.length ? sendFiles : undefined });
    if (r.command === 'new_conversation' && MODE === 'main') {
      shownConv = null;
      clearChatView();
    }
    if (r.newConversation && r.kind === 'brain') addNote('Fresh start for this expert: earlier messages are not sent again, to save tokens');
    let meta: string | undefined;
    if (r.kind === 'brain') meta = `${r.model} · ${r.tokens?.toLocaleString() ?? 0} tokens${r.expensive ? ' · ▲ 3× more than usual' : ''}`;
    else meta = 'handled locally · 0 tokens';
    addMsg('jarvis', r.reply, meta, Boolean(r.isError), r.roleName ? { name: r.roleName, color: r.roleColor } : undefined);
    // you named someone else: the chip moves to them, so the next messages stay with them too
    if (pickedRole !== null && r.role && r.role !== 'jarvis' && r.role !== pickedRole) pickRole(r.role);
    if (r.limitReached) showNotice('Usage limit reached on your Claude plan. Jarvis will work again when the limit resets.');
    if (streamThis) finishLive(r, true);
    else if (voiceOn && !r.isError && !r.lessonShown) speakWhenFree(r.reply, { voice: r.voice }, () => awaitingLive);
    setStatus(r.isError ? 'err' : 'ok');
    if (r.followUp) pendingFollowUp = r.followUp;
  } catch (err) {
    if (streamThis) finishLive({ reply: '', isError: true }, false);
    addMsg('jarvis', String(err), undefined, true);
    setStatus('err');
  } finally {
    inflight--;
    setProgress(inflight > 0);
    if (inflight > 0) setStatus('busy');
    if (pendingFollowUp) {
      const next = pendingFollowUp;
      pendingFollowUp = null;
      submitText(next);
    }
  }
});

let pendingFollowUp: string | null = null;
/* ---------- files for the team: drop on the window or use the paperclip ---------- */
let attached: { name: string; path: string }[] = [];
function renderAttachments() {
  const box = $('attachments');
  box.classList.toggle('hidden', attached.length === 0);
  box.replaceChildren(
    ...attached.map((a, i) => {
      const x = el('button', { type: 'button', className: 'attachment-x', title: 'Remove' }, '\u00d7');
      x.addEventListener('click', () => {
        attached.splice(i, 1);
        renderAttachments();
      });
      return el('span', { className: 'attachment' }, el('span', {}, a.name), x);
    }),
  );
}
async function addAttachments(files: { name: string; path: string }[]) {
  if (!files.length) return;
  attached = [...attached, ...files].slice(-6);
  renderAttachments();
  $<HTMLInputElement>('input').focus();
}
$('attach').addEventListener('click', async () => {
  try {
    await addAttachments(await j.pickAttachments());
  } catch (err) {
    showNotice(cleanError(err));
  }
});
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault();
    document.body.classList.add('dropping');
  }
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dropping');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dropping');
  const paths = [...(e.dataTransfer?.files ?? [])].map((f) => j.pathOf(f)).filter(Boolean);
  if (!paths.length) return;
  if (shareOpen) {
    shareOpen.give(paths);
    return;
  }
  await addAttachments(paths.slice(0, 6).map((p) => ({ name: p.split(/[\\/]/).pop() ?? p, path: p })));
});
/** The message text with the attached files named, so the expert reads them. */
/** The files to send with the message (they go to the folder of the member who answers); clears the list. */
function takeAttachments(): string[] {
  const list = attached.map((a) => a.path);
  attached = [];
  renderAttachments();
  return list;
}

/* ---------- a member asks to be shown something: their drop box ---------- */
let shareOpen: { id: string; give(paths: string[]): void } | null = null;
j.onShareRequest(({ id, name, color, prompt }) => {
  shareOpen?.give([]); // only one box at a time
  const box = el('div', { className: 'share-box' });
  box.dataset.id = id;
  box.style.setProperty('--c', color);
  const choose = el('button', { type: 'button', className: 'primary' }, 'Choose files…');
  const cancel = el('button', { type: 'button', className: 'chip' }, 'Not now');
  const zone = el(
    'div',
    { className: 'share-zone' },
    el('div', { className: 'share-who' }, el('i', {}), `${name} would like to see it`),
    el('div', { className: 'share-prompt' }, prompt),
    el('div', { className: 'muted small' }, 'Drop a PDF, photo, video or recording here. It is saved in their folder (Shared with me).'),
    el('div', { className: 'row-buttons' }, choose, cancel),
  );
  box.append(zone);
  const done = (paths: string[] | null) => {
    if (shareOpen?.id !== id) return;
    shareOpen = null;
    box.remove();
    j.shareReply(id, paths && paths.length ? paths : null);
    if (MODE === 'voice') fitVoice();
  };
  shareOpen = { id, give: (paths) => done(paths) };
  choose.addEventListener('click', async () => {
    const picked = await j.pickAttachments().catch(() => []);
    if (picked.length) done(picked.map((f) => f.path));
  });
  cancel.addEventListener('click', () => done(null));
  zone.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  if (MODE === 'voice') {
    $('voice-card').append(box);
    fitVoice();
  } else {
    if (MODE === 'main') show('chat');
    $('composer').before(box);
  }
});
j.onShareClose((id: string) => {
  if (shareOpen?.id === id) shareOpen.give([]);
});

function submitText(text: string) {
  $<HTMLInputElement>('input').value = text;
  $<HTMLFormElement>('composer').requestSubmit();
}

/* ---------- voice: capture requests from the main process ---------- */
j.onAudioStart(async ({ id, kind, screen }) => {
  try {
    const meeting = kind === 'meeting' ? { screen: screen !== false, sinks: { video: (c: Uint8Array, t: string) => j.sendMeetingVideo(c, t), frame: (f: Uint8Array) => j.sendMeetingFrame(f) } } : undefined;
    const r = await startCapture(kind, (pcm, level) => j.sendPcm(kind, pcm, level), meeting);
    j.audioReply('audio:start', id, { ok: true, systemAudio: r.systemAudio, screen: r.screen });
    if (kind === 'ptt') $('mic').classList.add('live');
  } catch (err) {
    j.audioReply('audio:start', id, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
j.onAudioStop(async ({ id, kind }) => {
  await stopCapture(kind);
  if (!kind || kind === 'ptt') $('mic').classList.remove('live');
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
function setVoiceStatus(working: boolean) {
  $('vc-status').classList.toggle('hidden', !working);
  fitVoice();
}
function hideVoiceSoon(ms: number) {
  if (voiceHideTimer) window.clearTimeout(voiceHideTimer);
  voiceHideTimer = window.setTimeout(function check() {
    // Stay while the pointer is over the card or a popup is open.
    if (card.matches(':hover') || voiceInflight > 0 || !$('confirm').classList.contains('hidden') || !$('screen-pick').classList.contains('hidden')) {
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
  $('vc-answer').replaceChildren(mdBlock(a.text));
  setVoiceStatus(false);
  speak(a.text, () => hideVoiceSoon(10_000), { voice: a.voice });
});

/** Spoken requests not answered yet. A second one, while the first member works, is answered after it. */
let voiceInflight = 0;
let voiceMore: Promise<void> = Promise.resolve();
async function voiceAsk(text: string): Promise<void> {
  if (voiceInflight > 0) return voiceAskMore(text);
  voiceInflight++;
  let followUp: string | undefined;
  try {
    followUp = await voiceAskFirst(text);
  } finally {
    voiceInflight--;
  }
  if (followUp) await voiceAsk(followUp);
}

/** Asked while another member is still answering: works at the same time, shown and said when the card is free. */
async function voiceAskMore(text: string): Promise<void> {
  voiceInflight++;
  let r: Awaited<ReturnType<typeof j.ask>> | null = null;
  let error = '';
  try {
    r = await j.ask(text, null, { stream: false });
  } catch (err) {
    error = cleanError(err);
  }
  const mine = voiceMore.then(async () => {
    // wait until the first answer has been said (and nobody else on this card is speaking)
    const t0 = Date.now();
    while ((voiceBusy || awaitingLive || isSpeaking()) && Date.now() - t0 < 300_000) await new Promise((res) => setTimeout(res, 250));
    voiceInflight--;
    if (voiceHideTimer) window.clearTimeout(voiceHideTimer);
    card.classList.remove('hidden');
    (document.querySelector('.vc-you .muted') as HTMLElement).textContent = 'You said';
    $('vc-you').textContent = text;
    setVoiceStatus(false);
    if (!r) {
      card.classList.add('error');
      $('vc-answer').textContent = error;
      hideVoiceSoon(12000);
      return;
    }
    $('vc-answer').replaceChildren(mdBlock(r.reply));
    $('vc-name').textContent = r.roleName ?? 'Jarvis';
    ($('vc-orb') as HTMLElement).style.setProperty('--c', r.roleColor ?? '');
    card.classList.toggle('error', Boolean(r.isError));
    fitVoice();
    if (!r.isError && !r.quiet && voiceOn && !r.lessonShown) await new Promise<void>((res) => void speak(r!.reply, () => res(), { voice: r!.voice }).catch(() => res()));
    hideVoiceSoon(r.isError ? 12000 : r.quiet || !voiceOn ? 30000 : 6000);
  });
  voiceMore = mine.catch(() => undefined);
  await mine;
}

async function voiceAskFirst(text: string): Promise<string | undefined> {
  if (voiceHideTimer) window.clearTimeout(voiceHideTimer);
  stopSpeaking();
  voiceBusy = true;
  card.classList.remove('hidden', 'error');
  (document.querySelector('.vc-you .muted') as HTMLElement).textContent = 'You said';
  $('vc-you').textContent = text;
  $('vc-answer').textContent = '';
  setVoiceStatus(true);
  let followUp: string | undefined;
  try {
    awaitingLive = true;
    const r = await j.ask(text, null, { stream: true });
    $('vc-answer').replaceChildren(mdBlock(r.reply));
    $('vc-name').textContent = r.roleName ?? 'Jarvis';
    ($('vc-orb') as HTMLElement).style.setProperty('--c', r.roleColor ?? '');
    card.classList.toggle('error', Boolean(r.isError));
    followUp = r.followUp;
    voiceBusy = false;
    setVoiceStatus(false);
    // Spoken requests are answered out loud (usually already speaking while the reply was written),
    // except during a recorded meeting or with "Speak replies aloud" off: then the answer stays on the
    // card, written, for longer.
    if (!r.isError && !followUp && (r.quiet || !voiceOn)) {
      finishLive(r, false);
      hideVoiceSoon(r.quiet ? 45000 : 30000);
    } else if (!r.isError && !followUp) finishLive(r, !r.lessonShown, () => hideVoiceSoon(6000)); // a lesson narrates itself
    else {
      finishLive({ ...r, isError: true }, false);
      if (!followUp) hideVoiceSoon(12000);
    }
  } catch (err) {
    finishLive({ reply: '', isError: true }, false);
    voiceBusy = false;
    card.classList.add('error');
    $('vc-answer').textContent = cleanError(err);
    setVoiceStatus(false);
    hideVoiceSoon(12000);
  }
  return followUp;
}
$('vc-close').addEventListener('click', () => {
  stopSpeaking();
  if (voiceHideTimer) window.clearTimeout(voiceHideTimer);
  j.voiceHide();
});
$('vc-open').addEventListener('click', () => j.showMain());
$('vc-min').addEventListener('click', () => j.voiceMinimize());
$('mic').addEventListener('click', () => j.voiceToggle());

/** A notice at the top of the chat; it has a × to close it. */
function showNotice(text: string) {
  const n = $('notice');
  const x = el('button', { type: 'button', className: 'notice-x', title: 'Close', ariaLabel: 'Close' }, '×');
  x.addEventListener('click', () => n.classList.add('hidden'));
  n.replaceChildren(el('span', {}, text), x);
  n.classList.remove('hidden');
}
/** Closes the notice if it is about this (e.g. a shortcut that has now been changed). */
function clearNotice(about: string) {
  const n = $('notice');
  if (n.textContent?.includes(about)) n.classList.add('hidden');
}

/* ---------- confirmation popup ---------- */
let confirmId: string | null = null;
/** Popups waiting while another is open (members working at the same time may each ask): shown in turn. */
const confirmQueue: ConfirmReq[] = [];
j.onConfirm((req) => {
  if (confirmId) {
    confirmQueue.push(req);
    return;
  }
  showConfirm(req);
});
function showConfirm(req: ConfirmReq) {
  confirmId = req.id;
  const badge = $('confirm-badge');
  badge.textContent = req.group;
  badge.className = `badge ${req.group}`;
  $('confirm-title').textContent = req.title || `Allow Jarvis to ${req.abilityTitle.toLowerCase()} in ${req.appName}?`;
  $('confirm-body').textContent = req.summary;
  $('confirm').classList.remove('hidden');
  $('confirm-no').focus();
}
j.onConfirmCancel((id) => {
  if (id === confirmId) closeConfirm();
  else {
    const i = confirmQueue.findIndex((q) => q.id === id);
    if (i >= 0) confirmQueue.splice(i, 1);
  }
});
function closeConfirm() {
  confirmId = null;
  $('confirm').classList.add('hidden');
  const next = confirmQueue.shift();
  if (next) setTimeout(() => showConfirm(next), 150);
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
/*
 * Two kinds of apps:
 * - apps from the user's Claude account (Gmail, Notion, Spotify…): connected on claude.ai, used here
 *   under Jarvis's rules (on/off, who can use it, reading / making changes / deleting);
 * - Jarvis's own team tools (screen, recorder, folders…), built in and working on this computer.
 */
type AppFilter = 'all' | 'connected' | 'signin';
interface Suggestion { name: string; maker?: string; description: string; category: string }
interface ConnectorsInfo { checkedAt: number; checking: boolean; url: string; suggestions: Suggestion[] }

let hubApps: HubApp[] = [];
let appsInfo: ConnectorsInfo | null = null;
let appFilter: AppFilter = 'all';
let hubQuery = '';
/** The user went to claude.ai to connect an app: check again when they come back. */
let waitingFor: { name: string | null; connectedBefore: number; before: string[]; since: number } | null = null;
let checking = false;

const STATUS_LABEL: Record<string, string> = { connected: 'Connected', 'needs-auth': 'Sign in needed', pending: 'Starting', failed: 'Not reachable' };

/** Electron prefixes IPC errors with "Error invoking remote method …: Error: ". */
function cleanError(err: unknown): string {
  return String(err)
    .replace(/^Error: Error invoking remote method '[^']+': (\w*Error: )?/, '')
    .replace(/^Error: /, '');
}

function showHubError(err: unknown) {
  $('hub-error').textContent = err ? cleanError(err) : '';
}

/** The team members (not Jarvis), for "Who can use it". */
async function teamMembers(): Promise<TeamRole[]> {
  if (!teamCache) teamCache = await j.teamList().catch(() => null);
  return (teamCache?.roles ?? []).filter((r) => r.id !== 'jarvis');
}

/** One chip per member; on = may use the app. */
function memberChips(members: TeamRole[], on: Set<string>, onToggle: (id: string) => void, disabled = false): HTMLElement {
  const row = el('div', { className: 'member-chips' });
  for (const m of members) {
    const chip = el('button', { type: 'button', className: `member-chip${on.has(m.id) ? ' on' : ''}`, title: `${m.person} · ${m.name}`, disabled });
    chip.style.setProperty('--c', m.color);
    chip.setAttribute('aria-pressed', String(on.has(m.id)));
    chip.append(el('i', {}), m.person);
    chip.addEventListener('click', () => onToggle(m.id));
    row.append(chip);
  }
  return row;
}

/* a calm coloured tile with the app's initials (no outside images) */
function hueOf(name: string): number {
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function initials(name: string): string {
  // "Google Calendar" → GC, "Gmail" → G, "Microsoft 365" → M, "monday.com" → M
  const words = name.replace(/\.[a-z]+$/i, '').split(/[^A-Za-z]+/).filter(Boolean);
  if (words.length > 1 && /^[A-Z]/.test(words[1])) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? '?').slice(0, 1).toUpperCase();
}
function appLogo(name: string): HTMLElement {
  const tile = el('span', { className: 'app-logo', ariaHidden: 'true' }, initials(name));
  tile.style.setProperty('--h', String(hueOf(name)));
  return tile;
}

/** Simple line icons for Jarvis's own tools. */
const TOOL_ICON: Record<string, string> = {
  lesson: 'M4 6l8-3 8 3-8 3zM7 8v5c0 1.5 2.2 3 5 3s5-1.5 5-3V8',
  documents: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  coding: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  team: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5M17 11a2.5 2.5 0 1 0 0-5M16 14c2.4 0 4.2 1.8 4.6 4.5',
  files: 'M3 7h6l2 2h10v10H3z',
  skills: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.6 5.7 3.6 9s-1.1 6.3-3.6 9c-2.5-2.7-3.6-5.7-3.6-9S9.5 5.7 12 3z',
  reminders: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  board: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v7h-4z',
  screen: 'M3 5h18v11H3zM8 20h8M12 16v4',
  recorder: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
};
function toolLogo(id: string): HTMLElement {
  const tile = el('span', { className: 'app-logo tool', ariaHidden: 'true' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', TOOL_ICON[id] ?? 'M5 5h14v14H5z');
  svg.append(p);
  tile.append(svg);
  return tile;
}

/** The query words, for search and highlighting. */
const queryWords = () => hubQuery.toLowerCase().split(/\s+/).filter(Boolean);
function matchesQuery(...texts: (string | null | undefined)[]): boolean {
  const words = queryWords();
  if (!words.length) return true;
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
/** The name with the searched words highlighted (text nodes only, never HTML). */
function highlighted(text: string): (Node | string)[] {
  const words = queryWords();
  if (!words.length) return [text];
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  return text.split(re).map((part, i) => (i % 2 ? el('mark', { className: 'hit' }, part) : part));
}

function sinceText(ms: number): string {
  if (!ms) return '';
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return 'Checked just now.';
  if (min < 60) return `Checked ${min} min ago.`;
  return `Checked at ${new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
}

const isConnector = (a: HubApp) => a.kind === 'connector';
const needsSignIn = (a: HubApp) => a.status !== 'connected';

/** "Who can use it" for one app. */
function whoRow(a: HubApp, team: TeamRole[]): HTMLElement {
  const who = el('div', { className: 'who-uses' }, el('span', { className: 'who-label muted small' }, 'Who can use it'));
  if (a.everyone) {
    who.append(el('span', { className: 'muted small' }, 'Everyone on the team, always'));
    return who;
  }
  const on = new Set(a.members);
  who.append(
    memberChips(team, on, async (id) => {
      if (on.has(id)) on.delete(id);
      else on.add(id);
      try {
        showHubError(null);
        teamCache = null; // the Team page lists each member's apps
        setHub(await j.hubSetMembers(a.id, [...on]));
      } catch (err) {
        showHubError(err);
      }
    }),
    el('span', { className: 'muted small who-note' }, on.size ? '+ Jarvis' : 'Only Jarvis'),
  );
  if (a.membersChanged) {
    const reset = el('button', { type: 'button', className: 'link-btn small' }, 'Reset');
    reset.title = 'Back to the usual members';
    reset.addEventListener('click', async () => {
      teamCache = null;
      setHub(await j.hubSetMembers(a.id, null));
    });
    who.append(reset);
  }
  return who;
}

/** "What it may do": each ability (or, for apps from the Claude account, its three rules) with its setting. */
/** The apps whose rules list is open (kept open when the Tool Hub redraws after a change). */
const openRules = new Set<string>();
function rulesDetails(a: HubApp, label: string, note?: string): HTMLElement {
  const table = el('table', { className: 'abilities' });
  for (const ab of a.abilities) {
    const select = el('select', { ariaLabel: `${ab.title} in ${a.name}` });
    for (const opt of ab.options) select.append(el('option', { value: opt, selected: opt === ab.setting }, SETTING_LABEL[opt]));
    select.addEventListener('change', async () => {
      try {
        showHubError(null);
        setHub(await j.hubSetAbility(a.id, ab.name, select.value));
      } catch (err) {
        showHubError(err);
      }
    });
    table.append(el('tr', {}, el('td', {}, ab.title, el('div', { className: 'muted' }, ab.description)), el('td', {}, select)));
  }
  const details = el('details', {}, el('summary', {}, label), table);
  details.open = openRules.has(a.id);
  details.addEventListener('toggle', () => (details.open ? openRules.add(a.id) : openRules.delete(a.id)));
  if (note) details.append(el('p', { className: 'rules-note' }, note));
  return details;
}

function onOff(a: HubApp): HTMLInputElement {
  const toggle = el('input', { type: 'checkbox', checked: a.enabled, className: 'switch', title: a.enabled ? 'On: your team can use it' : 'Off' });
  toggle.setAttribute('aria-label', `Let your team use ${a.name}`);
  toggle.addEventListener('change', async () => setHub(await j.hubSetEnabled(a.id, toggle.checked)));
  return toggle;
}

/** One app from the Claude account. */
function connectorCard(a: HubApp, team: TeamRole[]): HTMLElement {
  const connected = a.status === 'connected';
  const sub = [a.maker ? `by ${a.maker}` : null, a.category].filter(Boolean).join(' · ');
  const title = el('div', { className: 'app-title' }, appLogo(a.name), el('div', {}, el('h3', {}, ...highlighted(a.name)), el('span', { className: 'app-sub' }, sub || 'From your Claude account')));
  const status = el('span', { className: `status ${a.status ?? 'failed'}` }, el('i', {}), STATUS_LABEL[a.status ?? 'failed'] ?? 'Unknown');
  const head = el('div', { className: 'app-head' }, title, status);
  if (connected) head.append(onOff(a));
  const card = el('div', { className: `card app-card${connected ? (a.enabled ? '' : ' off') : ' dim'}` }, head, el('div', { className: 'muted app-desc' }, a.description));
  if (connected) {
    const actions = a.toolCount ? `${a.toolCount} action${a.toolCount === 1 ? '' : 's'}` : 'What it may do';
    card.append(whoRow(a, team), rulesDetails(a, `${actions} · your rules`, 'Jarvis sorts each action by its name: looking things up, making changes (create, send, play…), or deleting and paying. Deleting always asks you.'));
    return card;
  }
  const row = el('div', { className: 'app-actions' });
  if (a.status === 'needs-auth') {
    const go = el('button', { type: 'button', className: 'primary' }, 'Sign in on claude.ai');
    go.addEventListener('click', () => openConnect(a.name));
    row.append(go, el('span', { className: 'muted' }, 'It is in your Claude account but not signed in yet.'));
  } else {
    const again = el('button', { type: 'button' }, 'Check again');
    again.addEventListener('click', () => void checkNow());
    row.append(again, el('span', { className: 'muted' }, a.status === 'pending' ? 'It was still starting.' : 'Claude could not reach it just now.'));
  }
  card.append(row);
  return card;
}

/** A small tile: an app to sign in to, or a popular app to add. */
function appTile(name: string, text: string, button: string, onClick: () => void, title?: string): HTMLElement {
  const b = el('button', { type: 'button' }, button);
  b.addEventListener('click', onClick);
  if (title) b.title = title;
  return el('div', { className: 'suggest-card' }, appLogo(name), el('div', { className: 'suggest-text' }, el('b', {}, ...highlighted(name)), el('span', { title: text }, text)), b);
}

/** One of Jarvis's own tools. */
function toolCard(a: HubApp, team: TeamRole[]): HTMLElement {
  const title = el('div', { className: 'app-title' }, toolLogo(a.id), el('div', {}, el('h3', {}, ...highlighted(a.name)), el('span', { className: 'app-sub' }, 'Built into Jarvis')));
  const head = el('div', { className: 'app-head' }, title, onOff(a));
  return el(
    'div',
    { className: `card app-card${a.enabled ? '' : ' off'}` },
    head,
    el('div', { className: 'muted app-desc' }, a.description),
    whoRow(a, team),
    rulesDetails(a, `What it may do (${a.abilities.length})`),
  );
}

function renderFilters(apps: HubApp[]) {
  const counts: Record<AppFilter, number> = { all: apps.length, connected: apps.filter((a) => !needsSignIn(a)).length, signin: apps.filter(needsSignIn).length };
  const label: Record<AppFilter, string> = { all: 'All', connected: 'Connected', signin: 'Sign in needed' };
  const root = $('hub-filters');
  root.replaceChildren(
    ...(Object.keys(label) as AppFilter[]).map((f) => {
      const b = el('button', { type: 'button', className: `hub-filter${appFilter === f ? ' on' : ''}` }, label[f], el('span', { className: 'count' }, String(counts[f])));
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(appFilter === f));
      b.addEventListener('click', () => {
        appFilter = f;
        void renderHubAll();
      });
      return b;
    }),
  );
}

function emptyCard(title: string, text: string, button?: { label: string; run: () => void }): HTMLElement {
  const kids: HTMLElement[] = [el('h3', {}, title), el('p', {}, text)];
  if (button) {
    const b = el('button', { type: 'button', className: 'primary' }, button.label);
    b.addEventListener('click', button.run);
    kids.push(b);
  }
  return el('div', {}, ...kids);
}

async function renderHubAll() {
  const team = await teamMembers();
  const all = hubApps.filter(isConnector);
  renderFilters(all);
  $('apps-checked').textContent = checking ? 'Checking your Claude account…' : sinceText(appsInfo?.checkedAt ?? 0);
  $('apps-check').classList.toggle('busy', checking);
  $<HTMLButtonElement>('apps-check').disabled = checking;

  // apps from the Claude account: full cards for the ones ready to use, small tiles for the ones to sign in to
  const shown = all
    .filter((a) => appFilter === 'all' || (appFilter === 'connected' ? !needsSignIn(a) : needsSignIn(a)))
    .filter((a) => matchesQuery(a.name, a.description, a.maker, a.category))
    .sort((x, y) => x.name.localeCompare(y.name));
  const ready = shown.filter((a) => a.status !== 'needs-auth');
  const signIn = shown.filter((a) => a.status === 'needs-auth');
  ready.sort((x, y) => Number(x.status !== 'connected') - Number(y.status !== 'connected'));
  $('hub-apps').replaceChildren(...ready.map((a) => connectorCard(a, team)));
  $('apps-signin-head').classList.toggle('hidden', !signIn.length);
  $('apps-signin').replaceChildren(...signIn.map((a) => appTile(a.name, a.description, 'Sign in', () => openConnect(a.name), `Sign in to ${a.name} on claude.ai`)));

  const empty = $('apps-empty');
  const connectedAny = all.some((a) => a.status === 'connected');
  let message: HTMLElement | null = null;
  if (!all.length && !appsInfo?.checkedAt)
    message = emptyCard(checking ? 'Checking your Claude account…' : 'Your Claude account has not been checked yet', 'Jarvis asks Claude Code which apps you connected on claude.ai. It takes a few seconds and uses no messages from your plan.', checking ? undefined : { label: 'Check now', run: () => void checkNow() });
  else if (hubQuery && !shown.length)
    message = /git\s*hub/i.test(hubQuery)
      ? emptyCard('GitHub is not offered as an app for Jarvis', "claude.ai's GitHub Integration works only inside claude.ai (Projects and cloud sessions); it never reaches other apps. Your Project Manager already works with code and Git on this computer through coding tasks.")
      : emptyCard(`No app in your account matches “${hubQuery}”`, 'Not there yet? Connect it on claude.ai: it shows up here as soon as you are signed in.', { label: 'Connect an app', run: () => openConnect(null) });
  else if (!connectedAny && appFilter !== 'signin')
    message = emptyCard('No apps connected yet', 'Connect Gmail, Google Calendar, Notion, Spotify or any other app on claude.ai, sign in once, and your team can use it here.', { label: 'Connect an app', run: () => openConnect(null) });
  else if (appFilter === 'signin' && !shown.length) message = emptyCard('Every app is signed in', 'All the apps in your Claude account are ready to use.');
  empty.classList.toggle('hidden', !message);
  if (message) empty.replaceChildren(message);

  // popular apps the account does not have yet
  const suggestions = appFilter === 'connected' ? [] : (appsInfo?.suggestions ?? []).filter((s) => matchesQuery(s.name, s.description, s.maker, s.category));
  $('apps-suggest-head').classList.toggle('hidden', !suggestions.length);
  $('apps-suggest').replaceChildren(...suggestions.map((s) => appTile(s.name, s.description, 'Connect', () => openConnect(s.name), `Connect ${s.name} on claude.ai`)));

  // Jarvis's own tools
  const tools = hubApps.filter((a) => !isConnector(a) && matchesQuery(a.name, a.description, ...a.abilities.map((b) => b.title)));
  $('hub-list').replaceChildren(...tools.map((a) => toolCard(a, team)));
  const none = $('hub-none');
  none.classList.toggle('hidden', tools.length > 0 || !hubQuery);
  if (!tools.length && hubQuery) none.replaceChildren(emptyCard(`No team tool matches “${hubQuery}”`, 'Try another word, like “screen”, “reminders” or “record”.'));
}

function setHub(list: HubApp[]) {
  hubApps = list;
  void renderHubAll();
}

async function loadHub() {
  const [list, info] = await Promise.all([j.hubList(), j.connectorsInfo()]);
  hubApps = list;
  appsInfo = info;
  checking = info.checking;
  await renderHubAll();
}

/** Ask the Claude account again which apps are connected (a few seconds, no tokens). */
async function checkNow() {
  if (checking) return;
  checking = true;
  void renderHubAll();
  try {
    showHubError(null);
    hubApps = await j.connectorsRefresh();
    appsInfo = await j.connectorsInfo();
  } catch (err) {
    showHubError(err);
  } finally {
    checking = false;
  }
  if (waitingFor) {
    const nowConnected = hubApps.filter((a) => isConnector(a) && a.status === 'connected');
    const want = waitingFor.name?.toLowerCase();
    // names can differ a little ("GitHub" / "GitHub Enterprise"): match either way round
    const target = want ? nowConnected.find((a) => a.name.toLowerCase().includes(want) || want.includes(a.name.toLowerCase())) : null;
    if (target || nowConnected.length > waitingFor.connectedBefore) {
      const name = target?.name ?? nowConnected.find((a) => !waitingFor!.before.includes(a.name))?.name ?? waitingFor.name;
      stopWaitingTimer();
      waitingFor = null;
      // say so right here, then fade the message away
      const box = $('apps-waiting');
      box.classList.add('done');
      $('apps-waiting-title').textContent = name ? `${name} is connected` : 'Your new app is connected';
      $('apps-waiting-sub').textContent = 'Your team can use it now. Its rules and who can use it are on its card below.';
      window.setTimeout(() => {
        if (!waitingFor) closeWaiting();
      }, 6000);
    } else {
      const minutes = (Date.now() - waitingFor.since) / 60_000;
      const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const who = waitingFor.name ?? 'The app';
      if (minutes >= WAIT_MINUTES) {
        stopWaitingTimer();
        $('apps-waiting-title').textContent = `${who} is not in your Claude account's apps`;
        $('apps-waiting-sub').textContent = `Checked at ${at}. On claude.ai it must say "Connected" under Settings → Connectors. Some claude.ai integrations (like GitHub's) work only on claude.ai itself and never reach other apps. Press Check again after connecting.`;
      } else {
        $('apps-waiting-sub').textContent = `Not connected yet (checked at ${at}). Jarvis checks again every few seconds while you finish on claude.ai: this message goes away by itself once it is connected.`;
      }
    }
  }
  await renderHubAll();
}

/** While waiting for an app: check every 15 seconds for up to WAIT_MINUTES (and whenever the window gets focus). */
const WAIT_MINUTES = 5;
let waitingTimer = 0;
function stopWaitingTimer() {
  window.clearInterval(waitingTimer);
  waitingTimer = 0;
}

/** Open claude.ai's connectors page and wait for the user to come back. */
function openConnect(name: string | null) {
  showHubError(null);
  j.connectorsOpen().catch(showHubError);
  const connected = hubApps.filter((a) => isConnector(a) && a.status === 'connected');
  waitingFor = { name, connectedBefore: connected.length, before: connected.map((a) => a.name), since: Date.now() };
  $('apps-waiting-title').textContent = name ? `Finish connecting ${name} on claude.ai` : 'Finish on claude.ai';
  $('apps-waiting-sub').textContent = name
    ? `Find ${name}, click Connect and sign in. This message goes away by itself once Jarvis sees it connected.`
    : 'Find the app you want, click Connect and sign in. This message goes away by itself once Jarvis sees it connected.';
  $('apps-waiting').classList.remove('hidden', 'done');
  stopWaitingTimer();
  waitingTimer = window.setInterval(() => {
    if (waitingFor && !document.hidden) void checkNow();
  }, 15_000);
}
function closeWaiting() {
  stopWaitingTimer();
  waitingFor = null;
  $('apps-waiting').classList.add('hidden');
  $('apps-waiting').classList.remove('done');
}

$('hub-q').addEventListener('input', () => {
  hubQuery = $<HTMLInputElement>('hub-q').value.trim();
  void renderHubAll();
});
$('apps-check').addEventListener('click', () => void checkNow());
$('apps-connect').addEventListener('click', () => openConnect(null));
$('apps-waiting-check').addEventListener('click', () => void checkNow());
$('apps-waiting-close').addEventListener('click', closeWaiting);
// back from the browser: see whether the app is connected now
window.addEventListener('focus', () => {
  if (waitingFor) void checkNow();
});
j.onConnectorsChanged(() => {
  if ($('view-hub').classList.contains('active')) void loadHub();
});

/* ---------- activity ---------- */
interface ActivityItem { id: string; ts: string; role?: string; appId: string; ability: string; outcome: 'done' | 'blocked' | 'declined' | 'error'; detail: string }
const OUTCOME: Record<ActivityItem['outcome'], string> = { done: 'Done', blocked: 'Blocked', declined: 'You said no', error: 'Failed' };
const activitySelected = new Set<string>();
let activityItems: ActivityItem[] = [];
/** "Gmail" for gmail, "Team folders" for files: the app's name from the Tool Hub when known. */
let appNames: Record<string, string> = {};

function dayLabel(d: Date): string {
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 86_400_000);
  const date = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  return days === 0 ? `Today · ${date}` : days === 1 ? `Yesterday · ${date}` : date;
}

/** Claude Code's own tools, in plain words. */
const CLAUDE_TOOL: Record<string, string> = {
  Write: 'Save a file', Edit: 'Edit a file', MultiEdit: 'Edit a file', NotebookEdit: 'Edit a notebook', Read: 'Read a file',
  Glob: 'Look for files', Grep: 'Search in files', Bash: 'Run a command', PowerShell: 'Run a command', WebFetch: 'Read a web page', WebSearch: 'Search the web',
};
function abilityName(e: ActivityItem): string {
  if (e.appId === 'claude') return CLAUDE_TOOL[e.ability] ?? `Use ${e.ability}`;
  return e.ability.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function whoDid(role?: string): { name: string; color: string } {
  const r = teamCache?.roles.find((x) => x.id === (role || 'jarvis'));
  return r ? { name: r.id === 'jarvis' ? 'Jarvis' : r.person, color: r.color } : { name: 'Jarvis', color: '#9a9a96' };
}

function syncActivityBar() {
  const n = activitySelected.size;
  $('activity-count').textContent = n ? `${n} selected` : `${activityItems.length} item${activityItems.length === 1 ? '' : 's'}`;
  $<HTMLButtonElement>('activity-delete').disabled = n === 0;
  $<HTMLButtonElement>('activity-clear').disabled = activityItems.length === 0;
  const all = $<HTMLInputElement>('activity-all');
  all.checked = n > 0 && n === activityItems.length;
  all.indeterminate = n > 0 && n < activityItems.length;
}

async function renderActivity() {
  const [list, apps] = await Promise.all([j.activityList(), j.hubList().catch(() => [] as HubApp[])]);
  if (!teamCache) teamCache = await j.teamList().catch(() => null);
  appNames = { ...Object.fromEntries(apps.map((a) => [a.id, a.name])), claude: 'Claude Code' };
  activityItems = [...list].reverse();
  for (const id of [...activitySelected]) if (!activityItems.some((e) => e.id === id)) activitySelected.delete(id);
  const root = $('activity-list');
  if (!activityItems.length) {
    root.replaceChildren(el('div', { className: 'activity-empty muted' }, 'Nothing here yet. When your team uses an app (email, calendar, the web, their folders…), it shows up here, day by day.'));
    syncActivityBar();
    return;
  }
  const groups = new Map<string, ActivityItem[]>();
  for (const e of activityItems) {
    const key = new Date(e.ts).toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  const out: HTMLElement[] = [];
  for (const [key, items] of groups) {
    const dayBox = el('input', { type: 'checkbox', className: 'activity-check', title: 'Select this whole day' });
    dayBox.checked = items.every((e) => activitySelected.has(e.id));
    dayBox.addEventListener('change', () => {
      for (const e of items) {
        if (dayBox.checked) activitySelected.add(e.id);
        else activitySelected.delete(e.id);
      }
      void renderActivity();
    });
    const rows = items.map((e) => {
      const box = el('input', { type: 'checkbox', className: 'activity-check', title: 'Select' });
      box.checked = activitySelected.has(e.id);
      const p = whoDid(e.role);
      const dot = el('i', { className: 'activity-dot' });
      dot.style.background = p.color;
      const what = el('span', { className: 'activity-what' }, el('b', {}, abilityName(e)), el('span', { className: 'muted' }, ` · ${appNames[e.appId] ?? e.appId}`));
      if (e.detail && e.outcome !== 'done') what.append(el('span', { className: 'activity-detail muted small' }, e.detail));
      const row = el(
        'label',
        { className: `activity-row${box.checked ? ' selected' : ''}` },
        box,
        el('span', { className: 'activity-time' }, new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })),
        el('span', { className: 'activity-who' }, dot, p.name),
        what,
        el('span', { className: `activity-outcome ${e.outcome}` }, OUTCOME[e.outcome] ?? e.outcome),
      );
      box.addEventListener('change', () => {
        if (box.checked) activitySelected.add(e.id);
        else activitySelected.delete(e.id);
        row.classList.toggle('selected', box.checked);
        dayBox.checked = items.every((x) => activitySelected.has(x.id));
        syncActivityBar();
      });
      return row;
    });
    const head = el('header', { className: 'activity-day-head' }, dayBox, el('h3', {}, dayLabel(new Date(key))), el('span', { className: 'pill' }, String(items.length)));
    out.push(el('section', { className: 'activity-day card' }, head, ...rows));
  }
  root.replaceChildren(...out);
  syncActivityBar();
}

/** Two clicks for anything permanent: the first asks, the second does it (resets after 4 s). */
function confirmTwice(btn: HTMLButtonElement, label: string, ask: () => string, run: () => Promise<void>) {
  btn.addEventListener('click', async () => {
    if (!btn.dataset.sure) {
      btn.dataset.sure = '1';
      btn.textContent = ask();
      btn.classList.add('danger');
      setTimeout(() => {
        delete btn.dataset.sure;
        btn.textContent = label;
        btn.classList.remove('danger');
      }, 4000);
      return;
    }
    delete btn.dataset.sure;
    btn.textContent = label;
    btn.classList.remove('danger');
    await run();
  });
}

$('activity-all').addEventListener('change', (ev) => {
  const on = (ev.target as HTMLInputElement).checked;
  activitySelected.clear();
  if (on) for (const e of activityItems) activitySelected.add(e.id);
  void renderActivity();
});
confirmTwice($<HTMLButtonElement>('activity-delete'), 'Delete selected', () => `Delete ${activitySelected.size} for good?`, async () => {
  await j.activityRemove([...activitySelected]);
  activitySelected.clear();
  void renderActivity();
});
confirmTwice($<HTMLButtonElement>('activity-clear'), 'Delete all', () => 'Delete the whole history?', async () => {
  await j.activityClear();
  activitySelected.clear();
  void renderActivity();
});

/* ---------- settings ---------- */
/* ---------- natural voice settings ---------- */
const SAMPLE = 'Hello! This is how your team will sound at this speed.';
async function renderTts() {
  const st = await j.ttsStatus();
  const pill = $('tts-pill');
  pill.textContent = st.installed ? 'Ready' : 'Not installed';
  pill.className = `pill${st.installed ? ' ok' : ''}`;
  $('tts-install').classList.toggle('hidden', st.installed);
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
    clearNotice('voice card shortcut');
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
    clearNotice('push-to-talk shortcut');
  } catch (err) {
    $('ptt-error').textContent = cleanError(err);
  }
});

async function renderSettings(s?: any) {
  const snap = s ?? (await j.settingsGet());
  $<HTMLInputElement>('voice-output').checked = snap.voiceOutput;
  $<HTMLInputElement>('pause-media').checked = snap.pauseMedia !== false;
  $<HTMLInputElement>('record-screen').checked = snap.recordScreen !== false;
  $<HTMLInputElement>('claude-tools').checked = snap.claudeTools !== false;
  $<HTMLInputElement>('keep-meeting-media').checked = snap.keepMeetingMedia === true;
  $<HTMLInputElement>('keep-history').checked = snap.keepHistory !== false;
  $<HTMLSelectElement>('explain-level').value = snap.explainLevel ?? 'auto';
  voiceOn = snap.voiceOutput;
}
$('pause-media').addEventListener('change', async (e) => {
  renderSettings(await j.settingsSet({ pauseMedia: (e.target as HTMLInputElement).checked }));
});
$('claude-tools').addEventListener('change', async (e) => {
  renderSettings(await j.settingsSet({ claudeTools: (e.target as HTMLInputElement).checked }));
});
$('record-screen').addEventListener('change', async (e) => {
  renderSettings(await j.settingsSet({ recordScreen: (e.target as HTMLInputElement).checked }));
});
$('keep-meeting-media').addEventListener('change', async (e) => {
  renderSettings(await j.settingsSet({ keepMeetingMedia: (e.target as HTMLInputElement).checked }));
});
$('meetings-folder').addEventListener('click', () => void j.openMeetingsFolder());
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

/* ---------- the floating box's title bar ---------- */
if (MODE === 'box') {
  $('box-close').addEventListener('click', () => j.toggleBox()); // hides it; the shortcut brings it back
  $('box-open').addEventListener('click', () => j.showMain());
  $('box-min').addEventListener('click', () => j.minimizeBox());
}

/* ---------- shortcut boxes: press the keys and the box shows them (Control+Alt+Space) ---------- */
const KEY_NAMES: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};
/** The key part of a shortcut, from the physical key (so Shift+1 is "1", not "!"); null for modifier keys. */
function keyName(e: KeyboardEvent): string | null {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return `num${c.slice(6)}`;
  if (/^F\d{1,2}$/.test(c)) return c;
  return KEY_NAMES[c] ?? null;
}
const MOD_OF: Record<string, string> = { ControlLeft: 'Control', ControlRight: 'Control', AltLeft: 'Alt', AltRight: 'Alt', ShiftLeft: 'Shift', ShiftRight: 'Shift', MetaLeft: 'Super', MetaRight: 'Super', OSLeft: 'Super', OSRight: 'Super' };
const MOD_ORDER = ['Control', 'Alt', 'Shift', 'Super'];
/**
 * A shortcut box you fill by pressing keys one at a time (no need to hold them): Ctrl, then Alt, then K
 * shows "Control+Alt+K". While it records, every key is caught (Tab or Enter do nothing else).
 * Click elsewhere to finish, Esc to cancel; the × clears it. Windows allows any number of modifier
 * keys and one main key, so a second main key replaces the first (and the box says so).
 */
function shortcutBox(input: HTMLInputElement) {
  input.readOnly = true;
  input.classList.add('shortcut');
  input.placeholder = 'Click to record';
  const row = input.closest('.set-row');
  const hint = el('p', { className: 'shortcut-hint' });
  row?.querySelector('.set-text')?.append(hint);
  const clear = el('button', { type: 'button', className: 'shortcut-clear', title: 'Clear' }, '×');
  input.after(clear);
  let before = input.value;
  let mods = new Set<string>();
  let main: string | null = null;
  let recording = false;
  const show = () => {
    const parts = [...MOD_ORDER.filter((m) => mods.has(m)), ...(main ? [main] : [])];
    input.value = parts.join('+');
  };
  const say = (text: string) => (hint.textContent = text);
  const start = () => {
    recording = true;
    before = input.value;
    mods = new Set();
    main = null;
    input.value = '';
    input.classList.add('recording');
    say('Recording: press the keys one by one, then click anywhere else. Esc cancels.');
  };
  const stop = (keep: boolean) => {
    if (!recording) return;
    recording = false;
    input.classList.remove('recording');
    if (!keep || (!main && !mods.size)) {
      input.value = before;
      say('');
      return;
    }
    if (!main) {
      input.value = before;
      say('A shortcut needs one key besides Ctrl, Alt, Shift or the Windows key (a letter, a number, Space, F1…). Try again.');
      return;
    }
    say(input.value === before ? '' : 'Press Save to use it.');
  };
  input.addEventListener('focus', start);
  input.addEventListener('mousedown', () => {
    if (document.activeElement === input && !recording) start();
  });
  input.addEventListener('blur', () => stop(true));
  input.addEventListener('keydown', (e) => {
    if (!recording) return;
    // nothing else happens while a shortcut is being recorded (Tab, Enter, Space…)
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.key === 'Escape') {
      stop(false);
      input.blur();
      return;
    }
    const mod = MOD_OF[e.code];
    if (mod) mods.add(mod);
    else {
      const key = keyName(e);
      if (!key) return;
      if (main && main !== key) say(`A shortcut has one main key, so ${key} replaces ${main}. Ctrl, Alt, Shift and the Windows key can all be added.`);
      else say('Recording: press the keys one by one, then click anywhere else. Esc cancels.');
      main = key;
    }
    show();
  });
  clear.addEventListener('click', () => {
    input.focus();
    start();
  });
}
if (MODE === 'main') {
  shortcutBox($<HTMLInputElement>('ptt-hotkey'));
  shortcutBox($<HTMLInputElement>('card-hotkey'));
}

/* ---------- Settings: the section list on the left ---------- */
if (MODE === 'main') {
  const view = $('view-settings');
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.set-nav a')];
  const mark = (id: string) => links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${id}`));
  links.forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const id = a.getAttribute('href')!.slice(1);
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      mark(id);
    }),
  );
  view.addEventListener('scroll', () => {
    const top = view.getBoundingClientRect().top + 90;
    const secs = [...view.querySelectorAll<HTMLElement>('.set-sec')];
    // at the very bottom the last section counts, even if it is short
    const atEnd = view.scrollTop + view.clientHeight >= view.scrollHeight - 4;
    const current = atEnd ? secs[secs.length - 1] : [...secs].reverse().find((sec) => sec.getBoundingClientRect().top <= top) ?? secs[0];
    if (current) mark(current.id);
  });
}

/* ---------- first-run welcome (replaces the old setup dialog) ---------- */
let onboarding: Onboarding | null = null;
function welcome(from?: 'title' | 'claude' | 'meet', only = false) {
  onboarding = new Onboarding(() => {
    onboarding = null;
    void renderTeam();
    void renderChats();
    $<HTMLInputElement>('input').focus();
  });
  void onboarding.start(from, only);
}
/** Settings → You: the name and how it should sound. */
async function renderYou() {
  const { name } = await j.nameGet();
  $<HTMLInputElement>('you-name').value = name;
  $('you-say').replaceChildren(name ? sayMyName(name, { compact: true }) : el('p', { className: 'help' }, 'Add your name to choose how your team says it.'));
}
async function checkWelcome() {
  const st = await j.onboardState();
  if (!st.onboarded) welcome('title');
  else if (st.claude !== 'ready') welcome('claude', true); // Claude Code was removed or signed out
}
if (MODE === 'main') {
  void renderYou();
  $('you-save').addEventListener('click', async () => {
    try {
      await j.onboardSetName($<HTMLInputElement>('you-name').value);
      void renderYou();
    } catch (err) {
      $('you-say').replaceChildren(el('p', { className: 'error' }, String(err).replace(/^Error.*?: /, '')));
    }
  });
  $('meet-again').addEventListener('click', () => welcome('meet', true));
  $('setup-again').addEventListener('click', () => welcome('title'));
  const un = $<HTMLButtonElement>('uninstall');
  confirmTwice(un, 'Uninstall Jarvis', () => 'Remove Jarvis and all its data?', async () => {
    try {
      $('uninstall-msg').textContent = 'Opening the uninstaller…';
      await j.appUninstall();
    } catch (err) {
      $('uninstall-msg').textContent = String(err).replace(/^Error.*?: /, '');
    }
  });
}

void renderSettings();
if (MODE === 'main') void checkWelcome();

/* ---------- pause the user's music while this window speaks ---------- */
{
  let was = false;
  setInterval(() => {
    const now = isSpeaking();
    if (now !== was) {
      was = now;
      j.mediaSpeaking(now);
    }
  }, 200);
}
