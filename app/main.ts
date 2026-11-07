/** Electron main process. */
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ActivityLog } from '../gateway/activity-log.js';
import { GatewayCore } from '../gateway/core.js';
import { startControlServer, ControlServer } from '../gateway/control-server.js';
import { connectMcp, discoverApp } from '../gateway/mcp-proxy.js';
import { JarvisMcpAuth } from '../gateway/mcp-auth.js';
import { SUGGESTED_APPS } from '../gateway/suggested.js';
import { SettingsStore, defaultSetting, groupOf } from '../gateway/settings.js';
import type { AbilitySetting, ConfirmRequest } from '../gateway/types.js';
import { ClaudeCLIBrain } from '../brain/claude-cli.js';
import { SessionManager } from '../brain/session.js';
import { UsageLog } from '../brain/usage.js';
import { checkSetup, SetupStep } from '../brain/setup.js';
import { allowedSettings } from '../security/destructive-lock.js';
import { createKeyringStore, SecretStore, secretKeyForApp } from '../security/secrets.js';
import { AccountId, AccountManager, APP_ACCOUNT, PROVIDERS } from '../security/accounts.js';
import type { LocalCommand } from '../router/commands.js';
import { ScreenExecutor, ScreenUI } from '../tools/screen/executor.js';
import { ElectronScreenBackend } from '../tools/screen/electron-backend.js';
import { WhiteboardExecutor } from '../tools/whiteboard/executor.js';
import { jpegToPdf } from '../tools/whiteboard/pdf.js';
import type { Element } from '../tools/whiteboard/scene.js';
import { TranscriptExecutor } from '../tools/recorder/executor.js';
import { AppCatalog } from './apps.js';
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
let whiteboard: WhiteboardExecutor;
let voice: VoiceController;

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
    if (!w.isDestroyed()) w.setBounds(before);
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
    transparent: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  w.setContentProtection(true);
  w.setIgnoreMouseEvents(true);
  const html =
    `<body style="margin:0;font:14px system-ui,'Segoe UI',sans-serif">` +
    `<div style="margin:3px;padding:10px 14px;border-radius:20px;background:#1d2026;color:#fff;display:flex;gap:8px;align-items:center;box-shadow:0 2px 8px #0006">` +
    `<span style="width:10px;height:10px;border-radius:50%;background:#ff4d4d;display:inline-block"></span>${text}</div></body>`;
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
  if (target && !target.isDestroyed()) {
    target.send('voice:ask', text);
    return;
  }
  const w = await readyVoiceWindow();
  placeVoiceWindow(w, w.getBounds().height);
  w.showInactive();
  w.webContents.send('voice:ask', text);
}

const VOICE_WIDTH = 480;

function placeVoiceWindow(w: BrowserWindow, height: number) {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const h = Math.max(120, Math.min(Math.round(height), Math.round(area.height * 0.6)));
  w.setBounds({ x: Math.round(area.x + (area.width - VOICE_WIDTH) / 2), y: area.y + area.height - h - 12, width: VOICE_WIDTH, height: h });
}

async function readyVoiceWindow(): Promise<BrowserWindow> {
  if (!voiceWindow || voiceWindow.isDestroyed()) {
    voiceWindow = new BrowserWindow({
      width: VOICE_WIDTH,
      height: 180,
      frame: false,
      transparent: true,
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
    show,
    backgroundColor: '#05061a',
    // Keep audio capture running while the window is hidden (push-to-talk, recording).
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14161a' : '#f6f7f9',
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

async function runLocal(cmd: LocalCommand): Promise<string | { reply: string; followUp?: string }> {
  switch (cmd) {
    case 'open_whiteboard':
      send('ui:navigate', 'whiteboard');
      return 'Whiteboard opened.';
    case 'clear_whiteboard':
      whiteboard.reset();
      send('whiteboard:clear');
      return 'Whiteboard cleared.';
    case 'open_tool_hub':
      send('ui:navigate', 'hub');
      return 'Tool Hub opened.';
    case 'show_usage':
      send('ui:navigate', 'usage');
      return 'Here is your usage.';
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
      return voice.startRecording();
    case 'stop_recording':
      return voice.stopRecording();
  }
}

function buildBrain(command: string) {
  brain = new ClaudeCLIBrain({
    command,
    cwd: data('brain-cwd'),
    gateway: () =>
      control && {
        command: process.execPath,
        args: [path.join(__dirname, '..', 'gateway', 'shim.mjs')],
        env: { ELECTRON_RUN_AS_NODE: '1', JARVIS_CONTROL_URL: control.url, JARVIS_CONTROL_TOKEN: control.token },
      },
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
    runLocal,
    onProgress: (label) => send('progress', label),
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
    setupState = await checkSetup();
    if (setupState.step === 'ready') buildBrain(setupState.command);
    return { ...setupState, baseline: usage.baseline, envNotice };
  });
  ipcMain.handle('setup:baseline', async () => {
    if (!brain) return { ok: false, reply: 'Claude Code is not ready.' };
    const res = await brain.ask('Say hello in one short sentence.', null, 'haiku');
    if (!res.is_error) usage.setBaseline(res.tokens_used);
    usage.add({ request: '(setup test request)', model: res.model ?? 'haiku', tokens: res.tokens_used, usage: res.usage, isError: res.is_error });
    return { ok: !res.is_error, reply: res.reply, tokens: res.tokens_used, limitReached: res.limit_reached };
  });
  ipcMain.handle('ask', async (e, text: string) => {
    requestSender = e.sender;
    if (!orchestrator) return { kind: 'local', reply: 'Finish setup first.', isError: true };
    return orchestrator.handle(String(text));
  });
  ipcMain.on('confirm:answer', (_e, id: string, yes: boolean) => pendingConfirms.get(id)?.(yes === true));
  ipcMain.handle('hub:list', hubList);
  ipcMain.handle('hub:setEnabled', (_e, appId: string, on: boolean) => {
    store.setEnabled(appId, on);
    return hubList();
  });
  ipcMain.handle('hub:setAbility', (_e, appId: string, ability: string, setting: AbilitySetting) => {
    const a = catalog.find(appId);
    if (!a) throw new Error('unknown app');
    store.setAbility(a, ability, setting); // throws on destructive → allowed (criterion 29)
    return hubList();
  });
  ipcMain.handle('hub:suggested', () => {
    const added = new Set(catalog.all().map((a) => a.id));
    return SUGGESTED_APPS.map((a) => ({ ...a, added: added.has(a.id) }));
  });
  ipcMain.handle(
    'hub:addMcp',
    async (_e, input: { id?: string; name: string; url?: string; command?: string; args?: string[]; apiKey?: string }) => {
      const id = (input.id ?? input.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'app';
      if (catalog.find(id)?.kind === 'builtin') throw new Error('That name is taken by a built-in app.');
      await catalog.forget(id);
      if (input.apiKey) {
        await secrets.set(secretKeyForApp(id), input.apiKey);
        const def = await discoverApp(id, input.name, { url: input.url, command: input.command, args: input.args, auth: 'key' }, { secret: input.apiKey });
        store.addCustomApp(def);
        return hubList();
      }
      if (!input.url) {
        const def = await discoverApp(id, input.name, { command: input.command, args: input.args, auth: 'none' }, {});
        store.addCustomApp(def);
        return hubList();
      }
      // URL without a key: sign in through the browser if the app asks for it.
      const auth = await JarvisMcpAuth.load(id, input.name, secrets);
      const def = await withSignIn((signal) =>
        discoverApp(id, input.name, { url: input.url, auth: 'oauth' }, { auth, interactive: { openBrowser, signal } }),
      );
      if (!auth.hasTokens) {
        await auth.forget();
        def.mcp = { url: input.url, auth: 'none' };
      }
      store.addCustomApp(def);
      return hubList();
    },
  );
  ipcMain.handle('hub:signIn', async (_e, appId: string) => {
    const a = catalog.find(appId);
    if (!a?.mcp?.url || a.mcp.auth !== 'oauth') throw new Error('This app does not use browser sign-in.');
    await catalog.forget(appId);
    const auth = await JarvisMcpAuth.load(a.id, a.name, secrets);
    const client = await withSignIn((signal) => connectMcp(a.mcp!, { auth, interactive: { openBrowser, signal } }));
    await client.close();
    return hubList();
  });
  ipcMain.handle('hub:remove', async (_e, appId: string) => {
    const a = catalog.find(appId);
    await catalog.forget(appId);
    await secrets.delete(secretKeyForApp(appId));
    if (a) await (await JarvisMcpAuth.load(a.id, a.name, secrets)).forget();
    store.removeCustomApp(appId);
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
  ipcMain.handle('activity:list', () => activity.list());
  ipcMain.handle('settings:get', () => store.snapshot());
  ipcMain.handle('settings:set', (_e, patch: { modelOverride?: 'haiku' | 'sonnet' | null; voiceOutput?: boolean }) => {
    if (patch.modelOverride !== undefined) store.setModelOverride(patch.modelOverride);
    if (patch.voiceOutput !== undefined) store.setVoiceOutput(patch.voiceOutput);
    return store.snapshot();
  });
  ipcMain.on('box:toggle', toggleBox);
  ipcMain.on('voice:resize', (e, height: number) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    // Only the voice card sizes itself, and not while a popup has enlarged it.
    if (w && w === voiceWindow && !w.isDestroyed() && w.getBounds().width === VOICE_WIDTH) placeVoiceWindow(w, Number(height) || 160);
  });
  ipcMain.on('voice:hide', () => voiceWindow?.hide());
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
  ipcMain.on('wb:cleared', () => whiteboard.reset());
  ipcMain.handle('wb:export', async (_e, format: 'png' | 'pdf', dataUrl: string) => {
    const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(String(dataUrl));
    if (!m) throw new Error('bad image');
    const image = Buffer.from(m[2], 'base64');
    const options = {
      title: 'Save whiteboard',
      defaultPath: `whiteboard-${new Date().toISOString().slice(0, 10)}.${format}`,
      filters: [format === 'png' ? { name: 'PNG image', extensions: ['png'] } : { name: 'PDF document', extensions: ['pdf'] }],
    };
    const { canceled, filePath } = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return;
    fs.writeFileSync(filePath, format === 'png' ? image : jpegToPdf(image));
  });
}

app.whenReady().then(async () => {
  store = new SettingsStore(data('settings.json'));
  activity = new ActivityLog(data('activity.jsonl'));
  usage = new UsageLog(data('usage.jsonl'), data('baseline.json'));
  secrets = await createKeyringStore();
  accounts = new AccountManager({ secrets, clientId: (id) => store.oauthClientId(id), openBrowser });
  await accounts.init();
  whiteboard = new WhiteboardExecutor({
    draw: async (elements: Element[]) => {
      const w = await readyMainWindow(originIsMain());
      w.webContents.send('wb:draw', elements);
    },
    snapshot: async () => {
      const snap = await askRenderer<{ pngBase64: string; userStrokes: number }>('wb:snapshot', {}, 10_000, originIsMain());
      if (!snap) throw new Error('The whiteboard did not respond.');
      return snap;
    },
  });
  const screenExec = new ScreenExecutor(new ElectronScreenBackend(), screenUI, () => requestSeq);
  voice = new VoiceController({
    dataDir: app.getPath('userData'),
    preloadPath: preloadPath(),
    rendererDir: path.join(__dirname, '..', 'renderer'),
    askRenderer: (channel, payload, timeoutMs) => askRenderer(channel, payload, timeoutMs, false),
    deliver: deliverSpeech,
    notify: (text) => send('notice', text),
    progress: (label) => send('progress', label),
  });
  const transcripts = new TranscriptExecutor(path.join(app.getPath('userData'), 'transcripts'));
  catalog = new AppCatalog(store, secrets, accounts, { screen: screenExec, whiteboard, recorder: transcripts });
  core = new GatewayCore({
    apps: () => catalog.all(),
    settings: store,
    executors: (id) => catalog.executor(id),
    available: (a) => catalog.available(a),
    confirm,
    log: activity,
    onProgress: (label) => send('progress', `${label}…`),
  });
  control = await startControlServer(() => core);

  Menu.setApplicationMenu(null);
  voice.setupSession();
  voice.registerIpc();
  registerIpc();
  createMainWindow();
  globalShortcut.register(HOTKEY_BOX, toggleBox);
  const hotkey = store.snapshot().pttHotkey || DEFAULT_PTT_HOTKEY;
  if (!voice.setHotkey(hotkey)) {
    setTimeout(() => send('notice', `The push-to-talk shortcut ${hotkey} is used by another app. Pick another one in Settings → Voice.`), 3000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  voice?.dispose();
  globalShortcut.unregisterAll();
  void control?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
