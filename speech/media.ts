/**
 * Pauses music and videos while you talk to the team and while they speak, then resumes them.
 *
 * Windows: the system media controls (the same ones the media keys and the volume pop-up use),
 * through a small PowerShell helper that stays open so pausing takes milliseconds. It covers
 * Spotify, browsers playing YouTube, VLC and most media apps.
 * macOS: Spotify and Apple Music through AppleScript.
 *
 * Only what is actually playing is paused, and only what Jarvis paused is resumed.
 * This module starts powershell / osascript only. It never starts `claude` (criterion 7).
 */
import { ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface MediaBackend {
  /** Pauses everything that is playing (except apps matching `skip`); returns what it paused. */
  pause(skip?: RegExp): Promise<string[]>;
  /** Resumes what pause() returned. */
  resume(ids: string[]): Promise<void>;
  dispose?(): void;
}

/** Media apps that are Jarvis itself are never paused. */
const OWN = /jarvis|electron/i;

const WIN_HELPER = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $t.Wait(3000); $t.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line.StartsWith('pause')) {
    $skip = $line.Substring(5).Trim()
    $paused = @()
    foreach ($s in $mgr.GetSessions()) {
      $id = $s.SourceAppUserModelId
      if ($id -match 'jarvis|electron') { continue }
      if ($skip -and $id -match $skip) { continue }
      if ($s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { $null = Await ($s.TryPauseAsync()) ([bool]); $paused += $id }
    }
    [Console]::Out.WriteLine('paused ' + ($paused -join '|'))
  } elseif ($line -eq 'list') {
    $all = @()
    foreach ($s in $mgr.GetSessions()) { $all += ($s.SourceAppUserModelId + '=' + $s.GetPlaybackInfo().PlaybackStatus) }
    [Console]::Out.WriteLine('list ' + ($all -join '|'))
  } elseif ($line.StartsWith('resume ')) {
    $ids = $line.Substring(7).Split('|')
    foreach ($s in $mgr.GetSessions()) {
      if ($ids -contains $s.SourceAppUserModelId -and $s.GetPlaybackInfo().PlaybackStatus -ne 'Playing') { $null = Await ($s.TryPlayAsync()) ([bool]) }
    }
    [Console]::Out.WriteLine('resumed')
  }
  [Console]::Out.Flush()
}
`;

/** Windows: one PowerShell process kept open, talking over stdin/stdout. */
export class WindowsMedia implements MediaBackend {
  private proc: ChildProcess | null = null;
  private waiting: ((line: string) => void)[] = [];
  private ready: Promise<boolean> | null = null;

  private start(): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = new Promise<boolean>((resolve) => {
      const encoded = Buffer.from(WIN_HELPER, 'utf16le').toString('base64');
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
      this.proc = proc;
      const lines = createInterface({ input: proc.stdout! });
      let started = false;
      const timer = setTimeout(() => !started && resolve(false), 15_000);
      lines.on('line', (l) => {
        if (!started && l.trim() === 'ready') {
          started = true;
          clearTimeout(timer);
          resolve(true);
          return;
        }
        this.waiting.shift()?.(l.trim());
      });
      const gone = () => {
        clearTimeout(timer);
        if (!started) resolve(false);
        this.proc = null;
        this.ready = null;
        for (const w of this.waiting.splice(0)) w('');
      };
      proc.on('exit', gone);
      proc.on('error', gone);
    });
    return this.ready;
  }

  private async send(cmd: string): Promise<string> {
    if (!(await this.start()) || !this.proc?.stdin) return '';
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(''), 5000);
      this.waiting.push((l) => {
        clearTimeout(timer);
        resolve(l);
      });
      this.proc!.stdin!.write(`${cmd}\n`);
    });
  }

  /** Starts the helper ahead of time, so the first pause is instant. */
  warmUp(): void {
    void this.start();
  }

  /** What media is open and whether it plays (read-only; for checks and diagnostics). */
  async list(): Promise<string[]> {
    const r = await this.send('list');
    return r.startsWith('list ') ? r.slice(5).split('|').filter(Boolean) : [];
  }

  async pause(skip?: RegExp): Promise<string[]> {
    const r = await this.send(skip ? `pause ${skip.source}` : 'pause');
    return r.startsWith('paused ') ? r.slice(7).split('|').filter((x) => x && !OWN.test(x)) : [];
  }

  async resume(ids: string[]): Promise<void> {
    if (ids.length) await this.send(`resume ${ids.join('|')}`);
  }

  dispose(): void {
    try {
      this.proc?.stdin?.end();
      this.proc?.kill();
    } catch {
      /* already gone */
    }
    this.proc = null;
  }
}

/** macOS: Spotify and Apple Music via AppleScript. */
export class MacMedia implements MediaBackend {
  private run(script: string): Promise<string> {
    return new Promise((resolve) => {
      const p = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => resolve(out.trim()));
      p.on('error', () => resolve(''));
    });
  }

  async pause(skip?: RegExp): Promise<string[]> {
    const paused: string[] = [];
    for (const app of ['Spotify', 'Music']) {
      if (skip?.test(app)) continue;
      const r = await this.run(`if application "${app}" is running then tell application "${app}" to if player state is playing then
  pause
  return "yes"
end if`);
      if (r === 'yes') paused.push(app);
    }
    return paused;
  }

  async resume(ids: string[]): Promise<void> {
    for (const app of ids) if (app === 'Spotify' || app === 'Music') await this.run(`tell application "${app}" to play`);
  }
}

/**
 * Who needs quiet right now ("listening", "reply", "speak:3"…). The first one pauses the media;
 * when the last one is gone (after a short grace, so the gap between you finishing and the team
 * answering does not let the music jump back in) the media resumes. Each hold has a time limit,
 * so the music always comes back even if something goes wrong.
 */
export class MediaHolds {
  private holds = new Map<string, ReturnType<typeof setTimeout>>();
  private paused: string[] = [];
  private pausing: Promise<void> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly backend: MediaBackend,
    private readonly enabled: () => boolean = () => true,
    private readonly graceMs = 800,
  ) {}

  get active(): string[] {
    return [...this.holds.keys()];
  }

  hold(key: string, on: boolean, maxMs = 120_000): void {
    if (on) {
      if (!this.enabled()) return;
      clearTimeout(this.holds.get(key));
      this.holds.set(key, setTimeout(() => this.hold(key, false), maxMs));
      if (this.resumeTimer) {
        clearTimeout(this.resumeTimer);
        this.resumeTimer = null;
      }
      if (this.holds.size === 1 && !this.paused.length && !this.pausing) {
        this.pausing = this.backend
          .pause()
          .then((ids) => {
            this.paused = ids;
          })
          .catch(() => undefined)
          .finally(() => {
            this.pausing = null;
            if (!this.holds.size) this.scheduleResume();
          });
      }
      return;
    }
    if (!this.holds.has(key)) return;
    clearTimeout(this.holds.get(key));
    this.holds.delete(key);
    if (!this.holds.size) this.scheduleResume();
  }

  private scheduleResume() {
    if (this.resumeTimer || this.pausing) return;
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (this.holds.size) return;
      if (!this.paused.length) return;
      const ids = this.paused;
      this.paused = [];
      void this.backend.resume(ids).catch(() => undefined);
    }, this.graceMs);
  }

  /** Lets everything go and resumes now (e.g. when Jarvis quits). */
  async releaseAll(): Promise<void> {
    for (const t of this.holds.values()) clearTimeout(t);
    this.holds.clear();
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    await this.pausing;
    const ids = this.paused;
    this.paused = [];
    if (ids.length) await this.backend.resume(ids).catch(() => undefined);
  }
}

/** The media controls for this computer, or a do-nothing stand-in elsewhere. */
export function systemMedia(platform: NodeJS.Platform = process.platform): MediaBackend & { warmUp?(): void } {
  if (platform === 'win32') return new WindowsMedia();
  if (platform === 'darwin') return new MacMedia();
  return { pause: async () => [], resume: async () => undefined };
}
