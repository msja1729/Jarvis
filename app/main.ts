/** Electron main process. */
import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, shell, systemPreferences } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ActivityLog } from '../gateway/activity-log.js';
import { GatewayCore } from '../gateway/core.js';
import { startControlServer, ControlServer } from '../gateway/control-server.js';
import { SettingsStore, defaultSetting, groupOf } from '../gateway/settings.js';
import type { AbilitySetting, ConfirmRequest, ExplainLevel } from '../gateway/types.js';
import { ClaudeCLIBrain } from '../brain/claude-cli.js';
import { CLI_MODEL } from '../brain/brain.js';
import { SessionManager } from '../brain/session.js';
import { UsageLog } from '../brain/usage.js';
import { checkSetup, openInstallTerminal, openLoginTerminal, SetupStep } from '../brain/setup.js';
import { fallbackIntros, introCards, introPrompt, Intros, parseIntros } from '../roles/intros.js';
import { uninstallCleanup } from './uninstall-cleanup.js';
import { MediaHolds, systemMedia } from '../speech/media.js';
import { applyPronunciations, parseRespelling, respellPrompt } from '../speech/pronounce.js';
import { allowedSettings } from '../security/destructive-lock.js';
import { createKeyringStore, SecretStore } from '../security/secrets.js';
import { AccountId, AccountManager, APP_ACCOUNT, PROVIDERS } from '../security/accounts.js';
import type { LocalCommand } from '../router/commands.js';
import { ScreenExecutor, ScreenUI } from '../tools/screen/executor.js';
import { ElectronScreenBackend } from '../tools/screen/electron-backend.js';
import { TranscriptExecutor } from '../tools/recorder/executor.js';
import { LessonExecutor } from '../tools/lesson/executor.js';
import { DocumentsExecutor } from '../tools/documents/executor.js';
import { Coder } from '../brain/coder.js';
import { Supervisor } from '../supervisor/supervisor.js';
import { CodingExecutor } from '../tools/coding/executor.js';
import { TeamExecutor } from '../tools/team/executor.js';
import { BoardExecutor, RemindersExecutor } from '../tools/planner/executor.js';
import { BoardStore, ReminderStore } from '../supervisor/reminders.js';
import { ChatHistory } from './history.js';
import { hookCommand, hooksInstalled, installHooks, removeHooks } from '../supervisor/hooks.js';
import { shortTask } from '../supervisor/supervisor.js';
import os from 'node:os';
import { fullName, isRole, peopleNames, PERSON_NAME, roleById, RoleId, ROLES } from '../roles/roles.js';
import { canUse, cleanMembers, guessMembers, isShared, membersOf } from '../roles/access.js';
import { rolePrompt } from '../roles/prompts.js';
import { RoleMemory } from '../roles/memory.js';
import { timePrefix } from '../brain/system-prompt.js';
import { modelFor } from '../router/model.js';
import { FALLBACK_ROLE } from '../router/roles.js';
import { ensureRoleFolders, ROLE_FOLDER, roleFolder } from '../roles/folders.js';
import { casebookContext, seedCasebook } from '../roles/casebook.js';
import { SKILLS } from '../roles/skills/index.js';
import { noteTaker, notesRequest } from '../roles/notes.js';
import { FilesExecutor } from '../tools/files/executor.js';
import { SkillsExecutor } from '../tools/skills/executor.js';
import { WebExecutor } from '../tools/web/executor.js';
import { pdfPages } from '../tools/documents/pdf-text.js';
import type { Lesson } from '../tools/lesson/spec.js';
import { bgraToGray, chooseSide, SIDE_FRACTION, Side } from '../tools/lesson/placement.js';
import { AppCatalog } from './apps.js';
import { KokoroEngine } from '../speech/kokoro.js';
import { DEFAULT_VOICE, isVoice, MAX_SPEED, MIN_SPEED, VOICES } from '../speech/kokoro-files.js';
import { glassOptions, mainChromeOptions } from './glass.js';
import { DEFAULT_PTT_HOTKEY, VoiceController } from './voice.js';
import { Orchestrator } from './orchestrator.js';

const HOTKEY_BOX = 'CommandOrControl+Shift+Space';
const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;

const data = (f: string) => path.join(app.getPath('userData'), f);

let mainWindow: BrowserWindow | null = null;
let voiceWindow: BrowserWindow | null = null;
let boxWindow: BrowserWindow | null = null;
let control: ControlServer | null = null;
let setupState: SetupStep | null = null;
let envNotice: string | null = null;

let store: SettingsStore;
let activity: ActivityLog;
let usage: UsageLog;
let catalog: AppCatalog;
let core: GatewayCore;
let orchestrator: Orchestrator | null = null;
let brain: ClaudeCLIBrain | null = null;
const sessions = new SessionManager();
let secrets: SecretStore;
let accounts: AccountManager;
let signInAbort: AbortController | null = null;
const pendingConfirms = new Map<string, (yes: boolean) => void>();
let requestSeq = 0;
let lessons: LessonExecutor;
let coder: Coder | null = null;
let roleMemory: RoleMemory;
let history: ChatHistory;
let media: MediaHolds;
let stopMediaHelper: () => void = () => undefined;
let reminders: ReminderStore;
let board: BoardStore;
/** The board task for the coding job the supervisor is running. */
let codingTaskId: string | null = null;

const CLAUDE_SETTINGS = () => path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'settings.json');
const HOOK_SCRIPT = () => path.join(__dirname, '..', 'supervisor', 'jarvis-claude-hook.mjs');

/** A team member says something out loud on the voice card (reminders, morning plan, sessions finished). */
async function announce(role: RoleId, title: string, text: string) {
  const w = await readyVoiceWindow();
  placeVoiceWindow(w, w.getBounds().height);
  w.showInactive();
  w.webContents.send('voice:announce', { name: role === 'jarvis' ? 'Jarvis' : `${people()[role]} · ${roleById(role).name}`, color: roleById(role).color, voice: roleVoice(role), title, text });
}

const PLAN_PROMPT =
  "Plan my day. Use your inbox-triage skill on new email first (put new deadlines and tasks on the board with reminders), then your daily-plan skill: today's calendar, tasks due soon or overdue, and my teammates' notes where useful. Save the plan in your Plans folder and give me a short, friendly version with times and the top 3 priorities. Add a reminder 10 minutes before each meeting today.";

/** The PA's clock: due reminders, and the morning plan once a day. Free; Claude is only used for the plan. */
function plannerTick() {
  for (const r of reminders.takeDue()) {
    const late = Date.now() - Date.parse(r.at) > 120_000 ? ' (while Jarvis was closed)' : '';
    void announce('pa', `Reminder${late}`, r.text);
  }
  const pa = store.snapshot().pa ?? {};
  if (!pa.planAt || !orchestrator || orchestrator.isBusy) return;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [h, m] = pa.planAt.split(':').map(Number);
  const due = new Date(now);
  due.setHours(h, m, 0, 0);
  if (pa.lastPlan === today || now < due || now.getTime() - due.getTime() > 3 * 3600_000) return;
  store.setPa({ lastPlan: today });
  void (async () => {
    const w = await readyVoiceWindow();
    requestSender = w.webContents; // any popup appears on the voice card, not the main window
    const res = await orchestrator!.handle(PLAN_PROMPT, 'pa');
    void announce('pa', 'Your plan for today', res.reply);
  })();
}

/** The natural voice of a team member (Jarvis itself keeps the voice from Settings → Natural voice). */
/** The team members' names (the user's choices, else Maya, Ryan, Sara, Victor). */
const people = () => peopleNames(store.snapshot().roleNames ?? {});

function roleVoice(role: RoleId): string {
  const snap = store.snapshot();
  if (role === 'jarvis') return isVoice(snap.ttsVoice) ? snap.ttsVoice : DEFAULT_VOICE;
  const chosen = snap.roleVoices?.[role];
  return isVoice(chosen) ? chosen : roleById(role).defaultVoice;
}
let supervisor: Supervisor;
let supWindow: BrowserWindow | null = null;
const supUpdates: { kind: string; text: string; at: number }[] = [];
let supHideTimer: NodeJS.Timeout | null = null;
const SUP_WIDTH = 440;
let lessonWindow: BrowserWindow | null = null;
let lessonSide: Side = 'right';
let voice: VoiceController;
let kokoro: KokoroEngine;

/** Stops any reply being spoken, in every window (e.g. when push-to-talk starts). */
function stopAllSpeech() {
  kokoro?.cancel();
  send('tts:stop-all');
}

/** Make sure the main window exists, is loaded, and is in front. */
async function readyMainWindow(show = true): Promise<BrowserWindow> {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow(show);
  const w = mainWindow!;
  if (w.webContents.isLoading()) await new Promise<void>((r) => w.webContents.once('did-finish-load', () => r()));
  if (show) {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }
  return w;
}

/** Send a request to the main window and wait for its reply on `${channel}:reply`. */
async function askRenderer<T>(channel: string, payload: Record<string, unknown>, timeoutMs = CONFIRM_TIMEOUT_MS, show = true): Promise<T | null> {
  return askWindow<T>(await readyMainWindow(show), channel, payload, timeoutMs);
}

/**
 * Where the current request came from. Requests from the floating box (typed or
 * spoken) never bring the main window forward: popups appear in the box instead.
 */
let requestSender: Electron.WebContents | null = null;

function originIsMain(): boolean {
  return !requestSender || requestSender.isDestroyed() || (mainWindow !== null && requestSender === mainWindow.webContents);
}

/** The window that should show popups for the current request (floating box, voice card, or main). */
async function originWindow(): Promise<BrowserWindow> {
  const w = !originIsMain() ? BrowserWindow.fromWebContents(requestSender!) : null;
  if (w && !w.isDestroyed()) {
    if (w.webContents.isLoading()) await new Promise<void>((r) => w.webContents.once('did-finish-load', () => r()));
    if (!w.isVisible()) w.showInactive();
    return w;
  }
  return readyMainWindow(true);
}

/** Lets the floating box grow to fit a popup, then puts it back exactly as it was. */
async function withRoom<T>(w: BrowserWindow, size: { width: number; height: number } | 'large', fn: () => Promise<T>): Promise<T> {
  if (w === mainWindow) return fn();
  const before = w.getBounds();
  const area = screen.getDisplayMatching(before).workArea;
  const want = size === 'large' ? { width: Math.round(area.width * 0.8), height: Math.round(area.height * 0.85) } : size;
  const width = Math.min(area.width, Math.max(before.width, want.width));
  const height = Math.min(area.height, Math.max(before.height, want.height));
  if (width !== before.width || height !== before.height) {
    const x = Math.min(Math.max(area.x, before.x + Math.round((before.width - width) / 2)), area.x + area.width - width);
    const y = Math.min(Math.max(area.y, before.y + Math.round((before.height - height) / 2)), area.y + area.height - height);
    w.setBounds({ x, y, width, height });
  }
  w.focus();
  try {
    return await fn();
  } finally {
    if (!w.isDestroyed()) {
      w.setBounds(before);
      // A popup had to show the hidden voice card; hide it again (speech carries on).
      if (w === voiceWindow && !voiceCardShown) w.hide();
    }
  }
}

async function askWindow<T>(w: BrowserWindow, channel: string, payload: Record<string, unknown>, timeoutMs = CONFIRM_TIMEOUT_MS): Promise<T | null> {
  const id = crypto.randomUUID();
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener(`${channel}:reply`, listener);
      resolve(null);
    }, timeoutMs);
    const listener = (_e: unknown, replyId: string, value: T | null) => {
      if (replyId !== id) return;
      clearTimeout(timer);
      ipcMain.removeListener(`${channel}:reply`, listener);
      resolve(value ?? null);
    };
    ipcMain.on(`${channel}:reply`, listener);
    w.webContents.send(channel, { id, ...payload });
  });
}

/** Small always-on-top notice, excluded from screen captures. */
function showIndicator(text: string, ms = 3500) {
  const area = screen.getPrimaryDisplay().workArea;
  const w = new BrowserWindow({
    width: 340,
    height: 50,
    x: area.x + area.width - 356,
    y: area.y + area.height - 66,
    frame: false,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    ...glassOptions(),
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  w.setContentProtection(true);
  w.setIgnoreMouseEvents(true);
  const html =
    `<html style="background:transparent"><body style="margin:0;height:100vh;display:flex;gap:10px;align-items:center;padding:0 16px;box-sizing:border-box;` +
    `font:600 13px 'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif;color:#fff;background:linear-gradient(155deg,#2a2a2a,#1b1b1b)">` +
    `<span style="width:9px;height:9px;border-radius:50%;background:#ff8fa3;flex:none"></span>${text}</body></html>`;
  void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => w.showInactive());
  setTimeout(() => !w.isDestroyed() && w.close(), ms);
}

const screenUI: ScreenUI = {
  pick: async (sources, reason) => {
    const w = await originWindow();
    return withRoom(w, { width: 760, height: 600 }, () => askWindow(w, 'screen:pick', { sources, reason }));
  },
  pickArea: async (preview, width, height) => {
    const w = await originWindow();
    return withRoom(w, 'large', () => askWindow(w, 'screen:area', { preview, width, height }));
  },
  indicate: () => showIndicator('Jarvis looked at your screen (1 picture)'),
};

/** Opens sign-in pages in the user's normal browser. Only https pages are allowed. */
async function openBrowser(url: string) {
  if (!url.startsWith('https://')) throw new Error('Refusing to open a non-https page.');
  await shell.openExternal(url);
}

/** Runs one browser sign-in at a time; "Cancel" in the UI aborts it. */
async function withSignIn<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  signInAbort?.abort();
  const ctrl = new AbortController();
  signInAbort = ctrl;
  try {
    return await fn(ctrl.signal);
  } finally {
    if (signInAbort === ctrl) signInAbort = null;
  }
}

/**
 * Recognised speech: from the mic button it goes into that window's chat; from the
 * hotkey it goes to the small voice card above the taskbar (no chat window opens).
 */
async function deliverSpeech(text: string, target: Electron.WebContents | null): Promise<void> {
  // "the second one" / "yes, allow it" / "go with yours" while Claude is waiting for the user
  const supReply = supervisor?.answerFromText(text);
  if (supReply) {
    void pushSup(supReply, true, 6000);
    return;
  }
  if (target && !target.isDestroyed()) {
    target.send('voice:ask', text);
    return;
  }
  const w = await readyVoiceWindow();
  placeVoiceWindow(w, w.getBounds().height);
  // The card stays hidden (Jarvis still speaks) unless the user showed it with the card shortcut.
  if (voiceCardShown) w.showInactive();
  w.webContents.send('voice:ask', text);
}

const VOICE_WIDTH = 480;
const DEFAULT_CARD_HOTKEY = 'Control+Alt+J';
/** Whether the user asked to see the voice card (card shortcut). Hidden by default. */
let voiceCardShown = false;
let cardHotkey: string | null = null;

/** Card shortcut: shows the voice card, or hides it. Hiding never stops the speech. */
async function toggleVoiceCard(): Promise<void> {
  const w = await readyVoiceWindow();
  if (w.isVisible()) {
    voiceCardShown = false;
    w.hide();
  } else {
    voiceCardShown = true;
    placeVoiceWindow(w, w.getBounds().height);
    w.showInactive();
  }
}

/** Registers the show/hide-card shortcut. Returns false if another app already uses it. */
function setCardHotkey(accelerator: string): boolean {
  if (cardHotkey) globalShortcut.unregister(cardHotkey);
  cardHotkey = null;
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, () => void toggleVoiceCard());
  } catch {
    ok = false;
  }
  if (ok) cardHotkey = accelerator;
  return ok;
}

function placeVoiceWindow(w: BrowserWindow, height: number) {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const h = Math.max(80, Math.min(Math.round(height), Math.round(area.height * 0.6)));
  w.setBounds({ x: Math.round(area.x + (area.width - VOICE_WIDTH) / 2), y: area.y + area.height - h - 12, width: VOICE_WIDTH, height: h });
}

async function readyVoiceWindow(): Promise<BrowserWindow> {
  if (!voiceWindow || voiceWindow.isDestroyed()) {
    voiceWindow = new BrowserWindow({
      width: VOICE_WIDTH,
      height: 160,
      frame: false,
      ...glassOptions(),
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      title: 'Jarvis',
      webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    voiceWindow.setAlwaysOnTop(true, 'floating');
    voiceWindow.on('closed', () => (voiceWindow = null));
    await voiceWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { mode: 'voice' } });
  }
  return voiceWindow;
}

/* ---------- coding supervisor card ---------- */

function supSettings() {
  const s = store.snapshot().supervisor ?? {};
  return { autonomy: s.autonomy ?? 'balanced', updateEvery: s.updateEvery ?? 5, speak: s.speak ?? true } as const;
}

function placeSup(w: BrowserWindow, height: number) {
  const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const h = Math.max(120, Math.min(Math.round(height), Math.round(a.height * 0.8)));
  w.setBounds({ x: a.x + a.width - SUP_WIDTH - 16, y: a.y + a.height - h - 16, width: SUP_WIDTH, height: h });
}

async function readySupWindow(): Promise<BrowserWindow> {
  if (!supWindow || supWindow.isDestroyed()) {
    supWindow = new BrowserWindow({
      width: SUP_WIDTH,
      height: 220,
      frame: false,
      ...glassOptions(),
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      title: 'Jarvis coding supervisor',
      webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    supWindow.setAlwaysOnTop(true, 'floating');
    supWindow.on('closed', () => (supWindow = null));
    await supWindow.loadFile(path.join(__dirname, '..', 'renderer', 'supervisor.html'));
  }
  return supWindow;
}

/** Refreshes the card; optionally speaks `say`, shows the card without taking focus, and hides it after a while. */
async function pushSup(say?: string, show = true, autoHideMs = 0) {
  const w = await readySupWindow();
  w.webContents.send('sup:state', { view: supervisor.view(), updates: supUpdates, say: supSettings().speak ? say : undefined, pm: people().pm });
  if (show && !w.isVisible()) {
    placeSup(w, w.getBounds().height);
    w.showInactive();
  }
  if (supHideTimer) clearTimeout(supHideTimer);
  supHideTimer = null;
  if (autoHideMs && !supervisor.view()?.pending.length) {
    supHideTimer = setTimeout(() => {
      if (!supervisor.view()?.pending.length) supWindow?.hide();
    }, autoHideMs);
  }
}

/** Project folder picker for a coding task. The user's choice is the go-ahead. */
async function pickProject(task: string): Promise<string | null> {
  const w = await originWindow();
  const res = await dialog.showOpenDialog(w, {
    title: `Choose the project folder for: ${task.slice(0, 80)}`,
    buttonLabel: 'Let Claude work here',
    defaultPath: store.snapshot().supervisor?.lastFolder,
    properties: ['openDirectory'],
  });
  if (w === voiceWindow && !voiceCardShown && !w.isDestroyed()) w.hide();
  const folder = res.canceled ? null : (res.filePaths[0] ?? null);
  if (folder) store.setSupervisor({ lastFolder: folder });
  return folder;
}

function makeSupervisor() {
  supervisor = new Supervisor({
    run: (args, cwd, onEvent, runId) => {
      if (!coder || !control) throw new Error('Claude Code is not set up yet. Finish setup first.');
      const shim = {
        command: process.execPath,
        args: [path.join(__dirname, '..', 'gateway', 'shim.mjs')],
        // the limited token: it can only send permission prompts to the supervisor
        env: { ELECTRON_RUN_AS_NODE: '1', JARVIS_CONTROL_URL: control.url, JARVIS_CONTROL_TOKEN: control.supToken, JARVIS_SHIM_MODE: 'supervisor', JARVIS_RUN_ID: runId },
      };
      // the Project Manager's coding sessions run on Opus 5.5, the strongest model for building projects
      return coder.run({ ...args, shim, model: CLI_MODEL.opus }, cwd, onEvent);
    },
    // the advisor runs in Jarvis's own folder, not the project, so no project files steer it
    advise: (prompt, system) => (coder ? coder.advise(prompt, system, data('brain-cwd')) : Promise.resolve(null)),
    ui: {
      ask: (p) => void pushSup(supervisor.describe(p), true),
      settled: () => void pushSup(undefined, false),
      update: (u) => {
        // the coding job is on the project board: doing while it runs, done when it finishes
        const v = supervisor.view();
        try {
          if (u.kind === 'started' && v) codingTaskId = board.add({ title: shortTask(v.task, 80), project: v.folder, status: 'doing', notes: 'Started by the coding supervisor' }).id;
          if (u.kind === 'done' && codingTaskId) board.update(codingTaskId, { status: 'done' });
          if ((u.kind === 'error' || u.kind === 'stopped') && codingTaskId) board.update(codingTaskId, { notes: u.kind === 'error' ? 'Claude ran into a problem' : 'Stopped' });
          send('planner:changed');
        } catch {
          /* the board is a convenience; never let it break the supervisor */
        }
        supUpdates.push({ ...u, at: Date.now() });
        if (supUpdates.length > 40) supUpdates.shift();
        // the start is already announced in the chat/voice reply, so it is not spoken twice
        void pushSup(u.kind === 'started' ? undefined : u.text, true, u.kind === 'progress' || u.kind === 'started' ? 12_000 : 0);
      },
    },
    settings: () => supSettings(),
  });
}

/* ---------- lesson window ---------- */

/** Looks at a tiny grey picture of the screen (on this computer) to find an empty side. */
async function emptySide(display: Electron.Display): Promise<Side> {
  try {
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 256, height: 160 } });
    const src = list.find((s) => s.display_id === String(display.id)) ?? list[0];
    if (!src || src.thumbnail.isEmpty()) return 'full';
    const { width, height } = src.thumbnail.getSize();
    const gray = bgraToGray(src.thumbnail.toBitmap(), width, height);
    // An all-black picture means screen capture is not allowed (macOS): use the side anyway.
    if (gray.every((v) => v < 4)) return 'right';
    return chooseSide(gray, width, height).choice;
  } catch {
    return 'full';
  }
}

function placeLesson(w: BrowserWindow, side: Side, display: Electron.Display) {
  const a = display.workArea;
  lessonSide = side;
  if (side === 'full') {
    w.setAlwaysOnTop(false);
    w.setBounds(a);
  } else {
    // At the side it floats above what the user is watching, so it stays visible.
    const width = Math.max(440, Math.round(a.width * SIDE_FRACTION));
    w.setBounds({ x: side === 'left' ? a.x : a.x + a.width - width, y: a.y, width, height: a.height });
    w.setAlwaysOnTop(true, 'floating');
  }
  if (!w.webContents.isLoading()) w.webContents.send('lesson:placed', side);
}

async function readyLessonWindow(): Promise<BrowserWindow> {
  if (!lessonWindow || lessonWindow.isDestroyed()) {
    lessonWindow = new BrowserWindow({
      width: 800,
      height: 700,
      minWidth: 420,
      minHeight: 420,
      frame: false,
      ...glassOptions(),
      show: false,
      title: 'Jarvis lesson',
      webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    lessonWindow.on('closed', () => (lessonWindow = null));
    await lessonWindow.loadFile(path.join(__dirname, '..', 'renderer', 'lesson.html'));
  }
  return lessonWindow;
}

/** Cuts the asked-for part (plus some context around it) out of the last screenshot, for a lesson. */
function snipScreen(shot: { jpegBase64: string; width: number; height: number } | null, r: { x: number; y: number; w: number; h: number }) {
  if (!shot) return null;
  const x = Math.max(0, Math.min(shot.width - 1, r.x));
  const y = Math.max(0, Math.min(shot.height - 1, r.y));
  const w = Math.max(1, Math.min(shot.width - x, r.w));
  const h = Math.max(1, Math.min(shot.height - y, r.h));
  const padX = Math.round(Math.max(24, w * 0.25));
  const padY = Math.round(Math.max(24, h * 0.35));
  const cx = Math.max(0, x - padX);
  const cy = Math.max(0, y - padY);
  const cw = Math.min(shot.width - cx, w + 2 * padX);
  const ch = Math.min(shot.height - cy, h + 2 * padY);
  const img = nativeImage.createFromBuffer(Buffer.from(shot.jpegBase64, 'base64')).crop({ x: Math.round(cx), y: Math.round(cy), width: Math.round(cw), height: Math.round(ch) });
  return {
    image: `data:image/jpeg;base64,${img.toJPEG(88).toString('base64')}`,
    hl: { x: (x - cx) / cw, y: (y - cy) / ch, w: w / cw, h: h / ch },
  };
}

/** File or folder picker for the Documents app. The user's choice is the permission to read it. */
async function pick(kind: 'openFile' | 'openDirectory', reason: string): Promise<string | null> {
  const w = await originWindow();
  const res = await dialog.showOpenDialog(w, {
    title: reason || (kind === 'openFile' ? 'Choose a file for Jarvis to read' : 'Choose a folder for Jarvis to read'),
    buttonLabel: 'Let Jarvis read this',
    properties: [kind],
    filters:
      kind === 'openFile'
        ? [
            { name: 'Documents and code', extensions: ['pdf', 'txt', 'md', 'markdown', 'rst', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'sql', 'sh', 'ps1', 'r', 'm', 'scala', 'dart', 'lua', 'toml', 'ini', 'tex', 'ipynb'] },
            { name: 'All files', extensions: ['*'] },
          ]
        : undefined,
  });
  // the voice card may have been shown just to hold the picker: hide it again
  if (w === voiceWindow && !voiceCardShown && !w.isDestroyed()) w.hide();
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
}

/** Opens a lesson beside what the user is looking at (an empty side), or full screen. */
/** Who opened the lesson on screen: it is narrated in their voice. */
let lessonBy: RoleId = 'doctor';

async function showLesson(lesson: Lesson, role?: string): Promise<Side> {
  if (isRole(role) && role !== 'jarvis') lessonBy = role;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const open = lessonWindow && !lessonWindow.isDestroyed() && lessonWindow.isVisible();
  let side: Side;
  if (lesson.placement === 'full' || lesson.placement === 'left' || lesson.placement === 'right') side = lesson.placement;
  else if (open) side = lessonSide; // keep the window where it is
  else side = await emptySide(display); // look before our window covers anything
  const w = await readyLessonWindow();
  if (!open || lesson.placement !== 'auto') placeLesson(w, side, display);
  w.webContents.send('lesson:show', { lesson, side });
  if (side === 'full') {
    w.show();
    w.focus();
  } else w.showInactive();
  return side;
}

function send(channel: string, payload?: unknown) {
  for (const w of [mainWindow, boxWindow, voiceWindow]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function preloadPath() {
  return path.join(__dirname, 'preload.cjs');
}

function createMainWindow(show = true) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    title: 'Jarvis',
    // shown only once its first frame is painted, so it never flashes an empty or half-built screen
    show: false,
    ...glassOptions(),
    ...mainChromeOptions(),
    // Keep audio capture running while the window is hidden (push-to-talk, recording).
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // first run: the page starts with the welcome already covering it (no glimpse of the app behind)
  const welcome = store.snapshot().onboarded === true ? '0' : '1';
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { mode: 'main', welcome } });
  if (show) mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => (mainWindow = null));
}

function toggleBox() {
  if (boxWindow && !boxWindow.isDestroyed()) {
    if (boxWindow.isVisible()) boxWindow.hide();
    else {
      boxWindow.show();
      boxWindow.focus();
    }
    return;
  }
  boxWindow = new BrowserWindow({
    width: 460,
    height: 320,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    title: 'Jarvis',
    ...glassOptions(),
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  boxWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { mode: 'box' } });
  boxWindow.on('closed', () => (boxWindow = null));
}

/** "Ask me first" popup. Resolves false on No, timeout, or closed window. */
async function confirm(req: ConfirmRequest): Promise<boolean> {
  const win = await originWindow();
  const id = crypto.randomUUID();
  return withRoom(
    win,
    { width: 560, height: 460 },
    () =>
      new Promise<boolean>((resolve) => {
        const onClosed = () => pendingConfirms.get(id)?.(false);
        const timer = setTimeout(() => {
          pendingConfirms.delete(id);
          if (!win.isDestroyed()) {
            win.removeListener('closed', onClosed);
            win.webContents.send('confirm:cancel', id);
          }
          resolve(false);
        }, CONFIRM_TIMEOUT_MS);
        pendingConfirms.set(id, (yes) => {
          clearTimeout(timer);
          pendingConfirms.delete(id);
          if (!win.isDestroyed()) win.removeListener('closed', onClosed);
          resolve(yes);
        });
        win.once('closed', onClosed);
        win.webContents.send('confirm:request', { id, ...req });
      }),
  );
}

/** Names speech recognition should expect, so it spells them the team's way (Sara, not Sarah). */
const teamVocabulary = () => {
  const user = store.snapshot().userName;
  return `${user ? `${user}, ` : ''}${ROLES.filter((r) => r.id !== 'jarvis').map((r) => people()[r.id]).join(', ')}, Jarvis.`;
};

/** What a member has in mind when a conversation starts: their notes and their Profile files. */
function memoryPrefix(role: RoleId): string {
  return [roleMemory.prefix(role), casebookContext(app.getPath('userData'), role)].filter(Boolean).join('\n');
}

/** Tools shown in the welcome, to switch on or off (the rest are always on or set up later). */
const ONBOARD_TOOLS = ['web', 'lesson', 'documents', 'recorder', 'screen', 'reminders', 'board', 'coding'];

/** Fresh introductions written by Claude for this user (hand-written ones if that fails or is slow). */
let introsPromise: Promise<Intros> | null = null;
async function writeIntros(): Promise<Intros> {
  const user = store.snapshot().userName;
  const fallback = fallbackIntros(people(), user);
  if (!coder) return fallback;
  const { prompt, system } = introPrompt(people(), user);
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 60_000));
  const raw = await Promise.race([coder.advise(prompt, system, data('brain-cwd')), timeout]).catch(() => null);
  return parseIntros(raw, fallback);
}

/** The conversation the next message belongs to; a new one means fresh Claude sessions for everyone. */
function prepareConversation() {
  const r = history.prepare();
  if (r.isNew) orchestrator?.resetSessions();
  return r;
}

/** The team member who takes notes when the current recording ends. */
let recordingFor: RoleId = 'pm';

async function startRecordingFor(asked: RoleId) {
  const r = await voice.startRecording();
  if (!voice.recorder.recording) return r;
  recordingFor = noteTaker(asked);
  const who = fullName(recordingFor, people());
  return { ...r, reply: `${r.reply}\n${who} will take the notes when you say "stop recording".` };
}

async function stopRecordingWithNotes() {
  const r = await voice.stopRecording();
  return r.followUp ? { ...r, followUp: notesRequest(recordingFor, people()[recordingFor]) } : r;
}

async function runLocal(cmd: LocalCommand, role: RoleId = 'jarvis'): Promise<string | { reply: string; followUp?: string }> {
  switch (cmd) {
    case 'open_tool_hub':
      send('ui:navigate', 'hub');
      return 'Tool Hub opened.';
    case 'new_conversation':
      return 'New conversation started.';
    case 'mute_voice':
      store.setVoiceOutput(false);
      send('settings:changed', store.snapshot());
      return 'Voice muted.';
    case 'unmute_voice':
      store.setVoiceOutput(true);
      send('settings:changed', store.snapshot());
      return 'Voice on.';
    case 'start_recording':
      return startRecordingFor(role);
    case 'stop_recording':
      return stopRecordingWithNotes();
  }
}

/**
 * Checks Claude Code and starts Jarvis's brain. Runs at start-up by itself (the voice card
 * must not depend on the main window), and again whenever a request finds it missing.
 */
async function ensureBrain(): Promise<void> {
  setupState = await checkSetup();
  if (setupState.step === 'ready' && (!brain || brainCommand !== setupState.command)) buildBrain(setupState.command);
}
let brainCommand: string | null = null;

function buildBrain(command: string) {
  brainCommand = command;
  coder = new Coder({ command });
  brain = new ClaudeCLIBrain({
    command,
    cwd: data('brain-cwd'),
    gateway: (role, consult) =>
      control && {
        command: process.execPath,
        args: [path.join(__dirname, '..', 'gateway', 'shim.mjs')],
        // the role decides which apps' tools this run sees (see the control server scope)
        env: { ELECTRON_RUN_AS_NODE: '1', JARVIS_CONTROL_URL: control.url, JARVIS_CONTROL_TOKEN: control.token, JARVIS_ROLE: role ?? '', JARVIS_CONSULT: consult ? '1' : '0' },
      },
    systemPrompt: (role) => rolePrompt(isRole(role) ? role : 'jarvis', people()),
    progressFor: (tool) => catalog.progressFor(tool),
    onEnvScrubbed: (removed) => {
      envNotice = `${removed.join(', ')} was set on this computer. Jarvis removed it for Claude so requests use your Claude plan, not API billing.`;
      send('notice', envNotice);
    },
  });
  orchestrator = new Orchestrator({
    brain,
    sessions,
    usage,
    modelOverride: () => store.snapshot().modelOverride,
    // a new conversation starts with the member's notes and their filled-in Profile files
    memory: { prefix: (r) => memoryPrefix(r), remember: (r, u, a) => roleMemory.remember(r, u, a) },
    people,
    level: () => {
      const l = store.snapshot().explainLevel;
      return l && l !== 'auto' ? l : null;
    },
    runLocal,
    onProgress: () => undefined, // no step-by-step labels in the UI
    onRequestStart: () => {
      requestSeq += 1;
    },
  });
}

async function accountList() {
  return Promise.all(
    (Object.keys(PROVIDERS) as AccountId[]).map(async (id) => ({ ...(await accounts.status(id)), consoleUrl: PROVIDERS[id].consoleUrl })),
  );
}

async function hubList() {
  const snap = store.snapshot();
  return Promise.all(
    catalog.all().map(async (a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      kind: a.kind,
      enabled: store.isEnabled(a),
      connected: await catalog.isConnected(a),
      account: APP_ACCOUNT[a.id] ?? null,
      auth: a.mcp?.auth ?? null,
      members: membersOf(a, snap.appRoles),
      everyone: isShared(a.id),
      membersChanged: Boolean(snap.appRoles?.[a.id]),
      abilities: a.abilities.map((ab) => ({
        name: ab.name,
        title: ab.title,
        description: ab.description,
        group: groupOf(ab),
        setting: snap.apps[a.id]?.abilities?.[ab.name] ?? defaultSetting(ab),
        options: allowedSettings(groupOf(ab)),
      })),
    })),
  );
}

function registerIpc() {
  ipcMain.handle('setup:check', async () => {
    await ensureBrain();
    return { ...setupState!, baseline: usage.baseline, envNotice };
  });
  ipcMain.handle('setup:baseline', async () => {
    if (!brain) return { ok: false, reply: 'Claude Code is not ready.' };
    const res = await brain.ask('Say hello in one short sentence.', null, 'haiku');
    if (!res.is_error) usage.setBaseline(res.tokens_used);
    usage.add({ request: '(setup test request)', model: res.model ?? 'haiku', tokens: res.tokens_used, usage: res.usage, isError: res.is_error });
    return { ok: !res.is_error, reply: res.reply, tokens: res.tokens_used, limitReached: res.limit_reached };
  });
  /* ---------- first-run welcome (setup, tools, voices, meet the team) ---------- */
  ipcMain.handle('onboard:state', async () => {
    await ensureBrain().catch(() => undefined);
    const snap = store.snapshot();
    const micStatus = process.platform === 'linux' ? 'granted' : systemPreferences.getMediaAccessStatus('microphone');
    return {
      onboarded: snap.onboarded === true,
      userName: snap.userName ?? '',
      platform: process.platform,
      claude: setupState?.step ?? 'install',
      voice: kokoro.status(),
      speech: voice.engine.status(),
      mic: micStatus,
      tools: ONBOARD_TOOLS.flatMap((id) => {
        const a = catalog.find(id);
        return a ? [{ id, name: a.name, description: a.description, enabled: store.isEnabled(a) }] : [];
      }),
      cards: introCards(people()),
    };
  });
  ipcMain.handle('onboard:installClaude', () => openInstallTerminal());
  // the user signs in in their browser; Jarvis never sees or stores the login
  ipcMain.handle('onboard:loginClaude', () => openLoginTerminal());
  ipcMain.handle('onboard:setName', (_e, name: string) => {
    const before = store.snapshot().userName;
    const clean = store.setUserName(String(name ?? ''));
    if (before && before !== clean) store.setPronunciation(before, null);
    // every member learns the name (kept in their memory notes, which the user can edit)
    for (const r of ROLES) {
      if (r.id === 'jarvis') continue;
      const notes = roleMemory.notes(r.id).replace(/^- The user's name is .*\n?/m, '');
      roleMemory.setNotes(r.id, clean ? `- The user's name is ${clean}.\n${notes}` : notes);
    }
    introsPromise = null; // write them again with the name
    voice.engine.vocabulary = teamVocabulary();
    return clean;
  });
  /** The user's name and how it should sound. */
  ipcMain.handle('name:get', () => {
    const snap = store.snapshot();
    const name = snap.userName ?? '';
    return { name, sayAs: name ? (snap.pronunciations?.[name] ?? '') : '' };
  });
  ipcMain.handle('name:setSayAs', (_e, sayAs: string) => {
    const name = store.snapshot().userName;
    if (!name) throw new Error('Tell Jarvis your name first.');
    store.setPronunciation(name, typeof sayAs === 'string' ? sayAs : null);
    introsPromise = null;
    return store.snapshot().pronunciations?.[name] ?? '';
  });
  /** Claude suggests a spelling the English voice reads the right way. */
  ipcMain.handle('name:suggest', async (_e, name?: string) => {
    const n = (typeof name === 'string' && name.trim()) || store.snapshot().userName;
    if (!n || !coder) return null;
    const { prompt, system } = respellPrompt(n);
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 25_000));
    return parseRespelling(await Promise.race([coder.advise(prompt, system, data('brain-cwd')), timeout]).catch(() => null), n);
  });
  ipcMain.handle('onboard:askMic', async () => {
    if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone');
    return process.platform === 'linux' ? 'granted' : systemPreferences.getMediaAccessStatus('microphone');
  });
  ipcMain.handle('onboard:micSettings', () =>
    shell.openExternal(process.platform === 'win32' ? 'ms-settings:privacy-microphone' : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'),
  );
  ipcMain.handle('onboard:intros', async () => {
    // Claude starts writing them when Claude is connected; if they are still not ready, the hand-written ones play
    const late = new Promise<Intros>((r) => setTimeout(() => r(fallbackIntros(people(), store.snapshot().userName)), 8000));
    const intros = await Promise.race([(introsPromise ??= writeIntros()), late]);
    return { intros, cards: introCards(people()), voices: Object.fromEntries(ROLES.map((r) => [r.id, roleVoice(r.id)])) };
  });
  ipcMain.handle('onboard:prepareIntros', () => {
    introsPromise ??= writeIntros();
    return true;
  });
  ipcMain.handle('onboard:finish', async () => {
    store.setOnboarded(true);
    // the small test request that records the usual request size (used to spot unusually large ones)
    if (brain && !usage.baseline) {
      void brain.ask('Say hello in one short sentence.', null, 'haiku').then((res) => {
        if (!res.is_error) usage.setBaseline(res.tokens_used);
      });
    }
    return true;
  });
  ipcMain.handle('app:uninstall', async () => {
    if (process.platform === 'win32') {
      const uninstaller = path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`);
      if (!app.isPackaged || !fs.existsSync(uninstaller)) throw new Error('Uninstall works in the installed app (Windows Settings → Apps → Jarvis also works).');
      const err = await shell.openPath(uninstaller);
      if (err) throw new Error(err);
      setTimeout(() => app.quit(), 300);
      return true;
    }
    if (process.platform === 'darwin' && app.isPackaged) {
      await uninstallCleanup({ home: os.homedir(), userData: app.getPath('userData'), keepUserData: true });
      const bundle = path.resolve(path.dirname(process.execPath), '..', '..');
      if (bundle.endsWith('.app')) await shell.trashItem(bundle).catch(() => undefined);
      fs.rmSync(app.getPath('userData'), { recursive: true, force: true });
      app.exit(0);
      return true;
    }
    throw new Error('Uninstall works in the installed app.');
  });
  // the user's music stays paused from when they spoke until the answer has started (main releases 'reply')
  ipcMain.handle('ask', async (e, text: string, picked?: string, opts?: { stream?: boolean }) => {
    try {
      return await askInner(e, text, picked, opts);
    } finally {
      setTimeout(() => media?.hold('reply', false), 1500);
    }
  });
  const askInner = async (e: Electron.IpcMainInvokeEvent, text: string, picked?: string, opts?: { stream?: boolean }) => {
    requestSender = e.sender;
    // not started yet (or Claude Code was just installed / logged in): check again now
    if (!orchestrator) await ensureBrain();
    if (!orchestrator) return { kind: 'local', reply: setupState && 'instructions' in setupState ? setupState.instructions : 'Claude Code is not ready yet.', isError: true };
    const before = lessons?.shown ?? 0;
    const target = e.sender;
    const fromVoice = BrowserWindow.fromWebContents(target) === voiceWindow;
    const stream = opts?.stream === true;
    const conv = prepareConversation().conv;
    const res = await orchestrator.handle(String(text), isRole(picked) ? picked : null, {
      spoken: fromVoice,
      // who answers, so the window can show their name and use their voice right away
      onRole: stream
        ? (r) => !target.isDestroyed() && target.send('ask:start', { role: r, roleName: r === 'jarvis' ? 'Jarvis' : `${people()[r]} · ${roleById(r).name}`, roleColor: roleById(r).color, voice: roleVoice(r) })
        : undefined,
      // the reply as it is written; stops once a lesson opens (the lesson narrates itself)
      onText: stream ? (d) => !target.isDestroyed() && (lessons?.shown ?? 0) === before && target.send('ask:partial', d) : undefined,
    });
    // Jarvis never answers or speaks while you work (only in the welcome): local replies come from the member in charge
    let role: RoleId = res.role ?? FALLBACK_ROLE;
    if (role === 'jarvis') role = res.command === 'start_recording' || res.command === 'stop_recording' ? recordingFor : res.speaker && res.speaker !== 'jarvis' ? res.speaker : FALLBACK_ROLE;
    // A lesson narrates itself, so the window that asked should not read the reply aloud too.
    const who = people()[role];
    const roleName = role === 'jarvis' ? 'Jarvis' : `${who} · ${roleById(role).name}`;
    // one shared history: what was said in the voice card or the box also shows in the main chat
    const win = BrowserWindow.fromWebContents(target);
    const via = win === voiceWindow ? 'voice' : win === boxWindow ? 'box' : 'chat';
    const meta = res.kind === 'brain' ? `${res.model} · ${res.tokens?.toLocaleString() ?? 0} tokens` : 'handled locally · 0 tokens';
    if (res.command === 'new_conversation') {
      // "new conversation": nothing to keep; the next message starts a fresh one
      history.startNew();
      send('history:changed', { newChat: true });
      return { ...res, role, roleName, person: who, roleColor: roleById(role).color, voice: roleVoice(role), conv: null };
    }
    const items = history.add([
      { who: 'user', text: String(text), via },
      { who: 'assistant', text: res.reply, via, roleName, color: roleById(role).color, meta, error: Boolean(res.isError) },
    ]);
    history.setSession(conv, role, res.sessionId);
    if (win !== mainWindow && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('history:add', items);
    send('history:changed', {});
    return { ...res, role, roleName, person: who, roleColor: roleById(role).color, voice: roleVoice(role), lessonShown: (lessons?.shown ?? 0) > before, conv };
  };
  ipcMain.handle('history:prepare', () => prepareConversation());
  ipcMain.handle('history:list', (_e, query?: string) => ({ items: history.list(typeof query === 'string' ? query.slice(0, 200) : ''), current: history.currentId }));
  ipcMain.handle('history:open', (_e, id: string) => {
    const conv = history.get(String(id));
    if (!conv) throw new Error('That conversation no longer exists.');
    return { conv, messages: history.messages(conv.id), current: history.currentId === conv.id };
  });
  ipcMain.handle('history:continue', (_e, id: string) => {
    const conv = history.continue(String(id));
    orchestrator?.restoreSessions(conv.sessions);
    return { conv, messages: history.messages(conv.id) };
  });
  ipcMain.handle('history:new', () => {
    history.startNew();
    orchestrator?.resetSessions();
    send('history:changed', { newChat: true });
    return true;
  });
  ipcMain.handle('history:remove', (_e, ids: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
    const wasCurrent = history.currentId !== null && list.includes(history.currentId);
    const n = history.remove(list);
    if (wasCurrent) orchestrator?.resetSessions();
    send('history:changed', {});
    return n;
  });
  ipcMain.handle('history:set', (_e, keep: boolean) => {
    store.setKeepHistory(Boolean(keep));
    if (!keep) history.clear();
    send('history:cleared');
    return Boolean(keep);
  });
  ipcMain.handle('history:clear', () => {
    history.clear();
    orchestrator?.resetSessions();
    send('history:cleared');
    return true;
  });
  ipcMain.handle('team:list', () => ({
    roles: ROLES.map((r) => ({
      id: r.id,
      name: r.name,
      person: people()[r.id],
      title: r.title,
      blurb: r.blurb,
      color: r.color,
      examples: r.examples,
      voice: roleVoice(r.id),
      apps: catalog
        .all()
        .filter((a) => a.id !== 'team' && canUse(r.id, a, store.snapshot().appRoles))
        .map((a) => a.name),
      notes: r.id === 'jarvis' ? null : roleMemory.notes(r.id),
      pending: r.id === 'jarvis' ? 0 : roleMemory.pendingCount(r.id),
      skills: SKILLS[r.id].map((k) => ({ id: k.id, when: k.when })),
      folder: `Team/${ROLE_FOLDER[r.id]}`,
      model: r.model === 'opus' ? 'Opus 5.5' : null,
    })),
    voices: VOICES,
  }));
  ipcMain.handle('team:setName', (_e, role: string, name: string) => {
    if (!isRole(role) || role === 'jarvis') throw new Error('unknown role');
    const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (clean && !PERSON_NAME.test(clean)) throw new Error('Use 2 to 20 letters (spaces, apostrophes and hyphens are fine).');
    const taken = Object.entries(people()).find(([id, n]) => id !== role && n.toLowerCase() === clean.toLowerCase());
    if (taken) throw new Error(`${clean} is already on the team.`);
    store.setRoleName(role, clean || null);
    voice.engine.vocabulary = teamVocabulary();
  // keep the speech model loaded, so talking to the team is quick from the first sentence
  setTimeout(() => {
    if (voice.engine.status().ready) void voice.engine.warmUp();
  }, 6000);
    return people()[role];
  });
  ipcMain.handle('team:setVoice', (_e, role: string, voice: string) => {
    if (!isRole(role) || !isVoice(voice)) throw new Error('unknown role or voice');
    if (role === 'jarvis') store.setTts(voice, undefined);
    else store.setRoleVoice(role, voice);
    return roleVoice(role);
  });
  ipcMain.handle('team:saveNotes', (_e, role: string, text: string) => {
    if (!isRole(role) || role === 'jarvis') throw new Error('unknown role');
    roleMemory.setNotes(role, String(text ?? ''));
    return roleMemory.notes(role);
  });
  ipcMain.handle('team:forget', (_e, role: string) => {
    if (!isRole(role) || role === 'jarvis') throw new Error('unknown role');
    roleMemory.clear(role);
    return '';
  });
  ipcMain.handle('team:refresh', async (_e, role: string) => {
    if (!isRole(role) || role === 'jarvis') throw new Error('unknown role');
    await roleMemory.fold(role);
    return roleMemory.notes(role);
  });
  ipcMain.on('confirm:answer', (_e, id: string, yes: boolean) => pendingConfirms.get(id)?.(yes === true));
  ipcMain.handle('hub:list', hubList);
  ipcMain.handle('hub:setEnabled', (_e, appId: string, on: boolean) => {
    store.setEnabled(appId, on);
    return hubList();
  });
  ipcMain.handle('hub:setMembers', (_e, appId: string, members: unknown) => {
    const a = catalog.find(appId);
    if (!a) throw new Error('unknown app');
    if (isShared(a.id)) throw new Error(`${a.name} is for everyone on the team.`);
    store.setAppRoles(a.id, members === null ? null : cleanMembers(members));
    return hubList();
  });
  ipcMain.handle('hub:setAbility', (_e, appId: string, ability: string, setting: AbilitySetting) => {
    const a = catalog.find(appId);
    if (!a) throw new Error('unknown app');
    store.setAbility(a, ability, setting); // throws on destructive → allowed (criterion 29)
    return hubList();
  });
  ipcMain.handle('accounts:list', accountList);
  ipcMain.handle('accounts:setup', async (_e, id: AccountId, clientId: string, clientSecret?: string) => {
    if (!(id in PROVIDERS)) throw new Error('unknown account');
    store.setOAuthClient(id, clientId || null);
    if (clientSecret !== undefined) await accounts.setClientSecret(id, clientSecret || null);
    return accountList();
  });
  ipcMain.handle('accounts:connect', async (_e, id: AccountId) => {
    await withSignIn((signal) => accounts.connect(id, signal));
    for (const [appId, acc] of Object.entries(APP_ACCOUNT)) if (acc === id) store.setEnabled(appId, true);
    return accountList();
  });
  ipcMain.handle('accounts:disconnect', async (_e, id: AccountId) => {
    await accounts.disconnect(id);
    for (const [appId, acc] of Object.entries(APP_ACCOUNT)) if (acc === id) store.setEnabled(appId, false);
    return accountList();
  });
  ipcMain.on('auth:cancel', () => signInAbort?.abort());
  ipcMain.handle('accounts:openConsole', (_e, id: AccountId) => openBrowser(PROVIDERS[id].consoleUrl));
  ipcMain.handle('accounts:openGuide', async (_e, id: AccountId) => {
    if (!(id in PROVIDERS)) return;
    const err = await shell.openPath(path.join(app.getAppPath(), 'docs', `connect-${id}.md`));
    if (err) throw new Error(`Could not open the guide: ${err}`);
  });
  ipcMain.handle('usage:summary', () => usage.summary());
  // a window started or stopped speaking (each window counts separately)
  ipcMain.on('media:speaking', (e, on: boolean) => {
    media?.hold(`speak:${e.sender.id}`, on === true, 180_000);
    if (on) media?.hold('reply', false); // the answer has started: the speaking hold takes over
  });
  ipcMain.handle('activity:list', () => activity.list());
  ipcMain.handle('activity:remove', (_e, ids: unknown) => activity.remove(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []));
  ipcMain.handle('activity:clear', () => activity.clear());
  ipcMain.handle('team:openFolder', async (_e, role: string) => {
    if (!isRole(role)) throw new Error('unknown role');
    const dir = roleFolder(app.getPath('userData'), role);
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
  });
  ipcMain.handle('settings:get', () => store.snapshot());
  ipcMain.handle('settings:set', (_e, patch: { modelOverride?: 'haiku' | 'sonnet' | null; voiceOutput?: boolean; pauseMedia?: boolean; ttsVoice?: string; ttsSpeed?: number; explainLevel?: ExplainLevel }) => {
    if (patch.modelOverride !== undefined) store.setModelOverride(patch.modelOverride);
    if (patch.voiceOutput !== undefined) store.setVoiceOutput(patch.voiceOutput);
    if (patch.pauseMedia !== undefined) {
      store.setPauseMedia(patch.pauseMedia === true);
      if (!patch.pauseMedia) void media?.releaseAll();
    }
    if (patch.explainLevel !== undefined) store.setExplainLevel(patch.explainLevel);
    if (patch.ttsVoice !== undefined || patch.ttsSpeed !== undefined) {
      const v = isVoice(patch.ttsVoice) ? patch.ttsVoice : undefined;
      const sp = typeof patch.ttsSpeed === 'number' && Number.isFinite(patch.ttsSpeed) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, patch.ttsSpeed)) : undefined;
      store.setTts(v, sp);
    }
    return store.snapshot();
  });
  ipcMain.on('box:toggle', toggleBox);
  ipcMain.handle('tts:status', () => {
    const snap = store.snapshot();
    return { ...kokoro.status(), voice: isVoice(snap.ttsVoice) ? snap.ttsVoice : DEFAULT_VOICE, speed: snap.ttsSpeed ?? 1, voices: VOICES };
  });
  ipcMain.handle('tts:install', async (e) => {
    await kokoro.install((label, fraction) => !e.sender.isDestroyed() && e.sender.send('tts:progress', { label, fraction }));
    kokoro.warmUp();
    return kokoro.status();
  });
  ipcMain.handle('tts:speak', (e, text: string, opts: { voice?: string }) => {
    if (!kokoro.status().installed) return null; // the window falls back to the OS voice
    const snap = store.snapshot();
    const fromWin = BrowserWindow.fromWebContents(e.sender);
    const own = fromWin && fromWin === lessonWindow ? roleVoice(lessonBy) : fromWin && fromWin === supWindow ? roleVoice('pm') : null;
    const v = isVoice(opts?.voice) ? opts.voice : (own ?? (isVoice(snap.ttsVoice) ? snap.ttsVoice : DEFAULT_VOICE));
    const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, snap.ttsSpeed ?? 1));
    const target = e.sender;
    // names are said the way the user taught us (only the sound changes, never the written text)
    const { id, done } = kokoro.speak(applyPronunciations(String(text), snap.pronunciations), v, speed, (c) => {
      if (!target.isDestroyed()) target.send('tts:chunk', { id: c.id, rate: c.rate, audio: c.audio });
    });
    void done.then((r) => !target.isDestroyed() && target.send('tts:done', { id, error: r.error, cancelled: r.cancelled }));
    return id;
  });
  ipcMain.on('tts:stop', (_e, id?: number) => kokoro.cancel(typeof id === 'number' ? id : undefined));
  ipcMain.on('voice:resize', (e, height: number) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    // Only the voice card sizes itself, and not while a popup has enlarged it.
    if (w && w === voiceWindow && !w.isDestroyed() && w.getBounds().width === VOICE_WIDTH) placeVoiceWindow(w, Number(height) || 160);
  });
  ipcMain.on('voice:hide', () => {
    voiceCardShown = false; // next spoken request starts hidden again
    voiceWindow?.hide();
  });
  ipcMain.handle('voice:cardHotkey', () => cardHotkey);
  ipcMain.handle('voice:setCardHotkey', (_e, accelerator: string | null) => {
    const wanted = accelerator?.trim() || DEFAULT_CARD_HOTKEY;
    if (!setCardHotkey(wanted)) {
      setCardHotkey(store.snapshot().voiceCardHotkey || DEFAULT_CARD_HOTKEY);
      throw new Error(`"${wanted}" is already used by another app or is not a valid shortcut.`);
    }
    store.setVoiceCardHotkey(accelerator?.trim() || null);
    return wanted;
  });
  ipcMain.on('main:show', () => void readyMainWindow(true));
  ipcMain.handle('voice:setHotkey', (_e, accelerator: string | null) => {
    const wanted = accelerator?.trim() || DEFAULT_PTT_HOTKEY;
    if (!voice.setHotkey(wanted)) {
      voice.setHotkey(store.snapshot().pttHotkey || DEFAULT_PTT_HOTKEY);
      throw new Error(`"${wanted}" is already used by another app or is not a valid shortcut.`);
    }
    store.setPttHotkey(accelerator?.trim() || null);
    return wanted;
  });
  ipcMain.on('lesson:close', () => lessonWindow?.close());
  ipcMain.on('sup:answer', (_e, id: string, a: { choose?: string[]; allow?: boolean; text?: string }) => {
    const reply = supervisor.answer(String(id), {
      choose: Array.isArray(a?.choose) ? a.choose.map(String).slice(0, 6) : undefined,
      allow: typeof a?.allow === 'boolean' ? a.allow : undefined,
      text: typeof a?.text === 'string' ? a.text.slice(0, 2000) : undefined,
    });
    void pushSup(reply, true, 5000);
  });
  ipcMain.on('sup:stop', () => void pushSup(supervisor.stop(), true, 8000));
  ipcMain.on('sup:hide', () => supWindow?.hide());
  ipcMain.on('sup:openCode', () => {
    const root = supervisor.view()?.root;
    if (root) void shell.openExternal(`vscode://file/${root.replace(/\\/g, '/')}`);
  });
  ipcMain.on('sup:openFile', (_e, rel: string) => {
    const root = supervisor.view()?.root;
    if (!root || typeof rel !== 'string') return;
    const file = path.resolve(root, rel);
    // only files inside the project folder
    if (file !== root && !file.startsWith(root + path.sep)) return;
    void shell.openExternal(`vscode://file/${file.replace(/\\/g, '/')}`);
  });
  ipcMain.on('sup:resize', (e, height: number) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w === supWindow && !w.isDestroyed()) placeSup(w, Number(height) || 200);
  });
  ipcMain.handle('sup:settings', (_e, patch: { autonomy?: 'careful' | 'balanced' | 'handsoff'; updateEvery?: number; speak?: boolean }) => {
    if (patch) store.setSupervisor({ autonomy: patch.autonomy, updateEvery: patch.updateEvery, speak: patch.speak });
    return { ...supSettings(), watchOwn: hooksInstalled(CLAUDE_SETTINGS()), claudeSettings: CLAUDE_SETTINGS() };
  });
  // the user's own Claude Code sessions: add / remove Jarvis's two hooks in their Claude Code settings
  ipcMain.handle('sup:watchOwn', (_e, on: boolean) => {
    if (on) installHooks(CLAUDE_SETTINGS(), hookCommand(process.execPath, HOOK_SCRIPT(), data('hook-endpoint.json')));
    else removeHooks(CLAUDE_SETTINGS());
    store.setSupervisor({ watchOwn: Boolean(on) });
    return hooksInstalled(CLAUDE_SETTINGS());
  });
  // PA: morning plan and reminders; the shared project board
  ipcMain.handle('pa:get', () => ({ planAt: store.snapshot().pa?.planAt ?? null, reminders: reminders.upcoming() }));
  ipcMain.handle('pa:setPlan', (_e, at: string | null) => {
    store.setPa({ planAt: at || null });
    return store.snapshot().pa?.planAt ?? null;
  });
  ipcMain.handle('reminders:cancel', (_e, id: string) => {
    reminders.cancel(String(id));
    return reminders.upcoming();
  });
  ipcMain.handle('board:list', () => board.all());
  ipcMain.handle('board:add', (_e, t: { title: string; project?: string; due?: string }) => {
    board.add({ title: String(t?.title ?? ''), project: t?.project, due: t?.due });
    return board.all();
  });
  ipcMain.handle('board:update', (_e, id: string, patch: { status?: string; due?: string | null; title?: string }) => {
    board.update(String(id), patch ?? {});
    return board.all();
  });
  ipcMain.handle('board:remove', (_e, id: string) => {
    board.remove(String(id));
    return board.all();
  });
  ipcMain.on('lesson:layout', async (_e, want: 'full' | 'side') => {
    const w = lessonWindow;
    if (!w || w.isDestroyed()) return;
    const display = screen.getDisplayMatching(w.getBounds());
    if (want === 'full') placeLesson(w, 'full', display);
    else {
      w.hide(); // look at the screen without our own window in the way
      const side = await emptySide(display);
      placeLesson(w, side === 'full' ? 'right' : side, display);
      w.show();
    }
  });
}

/**
 * No Jarvis window ever leaves its own pages: a link in a reply (or anything else) opens in the
 * user's browser instead, and only http(s) links are opened at all.
 */
app.on('web-contents-created', (_e, contents) => {
  const external = (url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  contents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return;
    e.preventDefault();
    external(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: 'deny' };
  });
});

app.whenReady().then(async () => {
  store = new SettingsStore(data('settings.json'));
  activity = new ActivityLog(data('activity.jsonl'));
  usage = new UsageLog(data('usage.jsonl'), data('baseline.json'));
  secrets = await createKeyringStore();
  accounts = new AccountManager({
    secrets,
    clientId: (id) => store.oauthClientId(id),
    openBrowser,
  });
  await accounts.init();
  ensureRoleFolders(app.getPath('userData'));
  seedCasebook(app.getPath('userData')); // profiles and reference files each member works from
  const screenExec = new ScreenExecutor(new ElectronScreenBackend(), screenUI, () => requestSeq);
  kokoro = new KokoroEngine(path.join(app.getPath('userData'), 'speech', 'kokoro'), path.join(__dirname, '..', 'speech', 'kokoro-worker.mjs'));
  setTimeout(() => kokoro.warmUp(), 4000); // load the voice in the background so the first reply speaks quickly
  // The user already chose the natural voice: if an update replaced its model, fetch the new one quietly.
  if (!kokoro.status().installed && kokoro.hasOlderModel()) {
    setTimeout(() => {
      send('notice', 'Updating the natural voice (one-time download, about 326 MB). This fixes speech that cut off. The standard voice is used until it finishes.');
      void kokoro
        .install()
        .then(() => {
          send('notice', 'The natural voice is updated.');
          kokoro.warmUp();
        })
        .catch((err) => send('notice', `The natural voice update failed: ${String(err).slice(0, 160)}. You can retry in Settings → Natural voice.`));
    }, 6000);
  }
  // pause music and videos while the user talks and while the team speaks; resume after
  const mediaBackend = systemMedia();
  media = new MediaHolds(mediaBackend, () => store.snapshot().pauseMedia !== false);
  mediaBackend.warmUp?.();
  stopMediaHelper = () => mediaBackend.dispose?.();
  voice = new VoiceController({
    dataDir: app.getPath('userData'),
    preloadPath: preloadPath(),
    rendererDir: path.join(__dirname, '..', 'renderer'),
    askRenderer: (channel, payload, timeoutMs) => askRenderer(channel, payload, timeoutMs, false),
    deliver: deliverSpeech,
    notify: (text) => send('notice', text),
    progress: () => undefined,
    stopSpeaking: stopAllSpeech,
    media: { hold: (key, on, maxMs) => media.hold(key, on, maxMs) },
  });
  makeSupervisor();
  voice.engine.vocabulary = teamVocabulary();
  history = new ChatHistory(data('history.jsonl'), data('conversations.json'), () => store.snapshot().keepHistory !== false);
  reminders = new ReminderStore(data('reminders.json'));
  board = new BoardStore(data('board.json'));
  setInterval(plannerTick, 15_000);
  setTimeout(plannerTick, 5_000);
  roleMemory = new RoleMemory(data('roles'), (prompt, system) => (coder ? coder.advise(prompt, system, data('brain-cwd')) : Promise.resolve(null)));
  const team = new TeamExecutor({
    consult: async (role, question) => {
      if (!brain) return { reply: 'Jarvis is not set up yet.', isError: true };
      const notes = memoryPrefix(role);
      const res = await brain.ask(`${notes ? `${notes}\n` : ''}${timePrefix()} (A teammate asks you.) ${question}`, null, modelFor(role, question, store.snapshot().modelOverride), { role, consult: true });
      return { reply: res.reply, isError: res.is_error, name: fullName(role, people()) };
    },
    onAsk: () => undefined,
  });
  const coding = new CodingExecutor({ supervisor, pickFolder: pickProject });
  lessons = new LessonExecutor({ show: showLesson, snip: (r) => snipScreen(screenExec.lastShot, r) });
  const documents = new DocumentsExecutor({
    pickFile: (reason) => pick('openFile', reason),
    pickFolder: (reason) => pick('openDirectory', reason),
    pdfPages,
  });
  const transcripts = new TranscriptExecutor(path.join(app.getPath('userData'), 'transcripts'), {
    start: async (role) => (await startRecordingFor(isRole(role) ? role : 'jarvis')).reply,
    // asked by a member mid-conversation: they read the transcript themselves, so no follow-up request
    stop: async () => (await voice.stopRecording()).reply,
  });
  const files = new FilesExecutor({
    jarvisDir: app.getPath('userData'),
    trash: (p) => shell.trashItem(p),
    onChange: () => send('team:filesChanged'),
  });
  catalog = new AppCatalog(store, secrets, accounts, {
    files,
    skills: new SkillsExecutor(app.getPath('userData')),
    web: new WebExecutor(),
    screen: screenExec,
    recorder: transcripts, lesson: lessons, documents, coding, team, reminders: new RemindersExecutor(reminders, () => send('planner:changed')), board: new BoardExecutor(board, () => send('planner:changed')) });
  void catalog.dropAddedApps().catch(() => undefined); // adding your own apps is not offered in this version
  core = new GatewayCore({
    apps: () => catalog.all(),
    settings: store,
    executors: (id) => catalog.executor(id),
    available: (a) => catalog.available(a),
    confirm,
    log: activity,
    onProgress: () => undefined,
  });
  control = await startControlServer(() => core, {
    approve: (runId, req) => supervisor.onPermission(runId, req),
    // each team member sees only its own apps; a consulted member cannot consult others (one hop)
    hook: (p) => {
      const folder = typeof p.cwd === 'string' ? path.basename(p.cwd) : 'your project';
      const first = (s: unknown) => (typeof s === 'string' ? (s.replace(/\s+/g, ' ').trim().match(/^.{0,220}?[.!?](\s|$)/)?.[0] ?? s.slice(0, 220)).trim() : '');
      const text =
        p.event === 'Stop'
          ? `Claude finished in ${folder}.${first(p.last) ? ` It says: ${first(p.last)}` : ''}`
          : p.event === 'Notification'
            ? `Your Claude session in ${folder} needs you${first(p.message) ? `: ${first(p.message)}` : '.'}`
            : '';
      if (!text) return;
      supUpdates.push({ kind: p.event === 'Stop' ? 'done' : 'progress', text, at: Date.now() });
      void pushSup(text, true, 15_000);
    },
    scope: (role, consult) => {
      if (!isRole(role)) return undefined;
      // read fresh on every list/call, so a change in the Tool Hub applies on the next request
      return (app) => (app.id === 'team' ? !consult : canUse(role, app, store.snapshot().appRoles));
    },
  });

  // where the Claude Code hook script finds Jarvis this time (the token only opens /hook)
  fs.writeFileSync(data('hook-endpoint.json'), JSON.stringify({ url: control.url, token: control.hookToken }), { mode: 0o600 });
  Menu.setApplicationMenu(null);
  nativeTheme.themeSource = 'dark'; // dark-tinted glass
  voice.setupSession();
  voice.registerIpc();
  registerIpc();
  createMainWindow();
  void ensureBrain().catch(() => undefined);
  globalShortcut.register(HOTKEY_BOX, toggleBox);
  const hotkey = store.snapshot().pttHotkey || DEFAULT_PTT_HOTKEY;
  if (!voice.setHotkey(hotkey)) {
    setTimeout(() => send('notice', `The push-to-talk shortcut ${hotkey} is used by another app. Pick another one in Settings → Voice.`), 3000);
  }
  const cardKey = store.snapshot().voiceCardHotkey || DEFAULT_CARD_HOTKEY;
  if (!setCardHotkey(cardKey)) {
    setTimeout(() => send('notice', `The voice card shortcut ${cardKey} is used by another app. Pick another one in Settings → Voice.`), 3500);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  void media?.releaseAll().finally(() => stopMediaHelper());
  voice?.dispose();
  kokoro?.dispose();
  globalShortcut.unregisterAll();
  void control?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
