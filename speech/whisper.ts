/**
 * Local speech-to-text with whisper.cpp (T8: audio never goes to Claude).
 *
 * Windows: the official whisper.cpp release build is downloaded on first use and
 * checked against its published SHA-256. macOS: no official build is published,
 * so Jarvis uses `whisper-cli` from Homebrew (`brew install whisper-cpp`).
 * The model (ggml base.en) is downloaded from the whisper.cpp model repo and checked too.
 *
 * This module starts whisper-cli only. It never starts `claude` (criterion 7).
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WHISPER_WIN = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip',
  sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c',
  bytes: 8573270,
};

export const WHISPER_MODEL = {
  name: 'ggml-base.en.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
  bytes: 147964211,
};

export const MAC_HELP = 'On macOS, install the speech engine once in Terminal:  brew install whisper-cpp  (then click "Check again").';

export interface SpeechStatus {
  engine: boolean;
  model: boolean;
  ready: boolean;
  /** Shown when the engine cannot be downloaded automatically. */
  help?: string;
}

export type Progress = (label: string, fraction: number) => void;

export class WhisperEngine {
  private installing: Promise<void> | null = null;

  constructor(
    private readonly dir: string,
    private readonly opts: { platform?: NodeJS.Platform; fetchImpl?: typeof fetch; binaryOverride?: string; modelOverride?: string } = {},
  ) {}

  private get platform() {
    return this.opts.platform ?? process.platform;
  }

  get modelPath(): string {
    return this.opts.modelOverride ?? path.join(this.dir, 'models', WHISPER_MODEL.name);
  }

  /** whisper-cli location, or null if not installed. */
  binary(): string | null {
    if (this.opts.binaryOverride) return fs.existsSync(this.opts.binaryOverride) ? this.opts.binaryOverride : null;
    if (this.platform === 'win32') {
      const p = path.join(this.dir, 'whisper', 'Release', 'whisper-cli.exe');
      return fs.existsSync(p) ? p : null;
    }
    const candidates = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'];
    for (const d of (process.env.PATH ?? '').split(path.delimiter)) if (d) candidates.push(path.join(d, 'whisper-cli'));
    return candidates.find((c) => fs.existsSync(c)) ?? null;
  }

  status(): SpeechStatus {
    const engine = this.binary() !== null;
    const model = fs.existsSync(this.modelPath) && fs.statSync(this.modelPath).size === WHISPER_MODEL.bytes;
    return {
      engine,
      model,
      ready: engine && model,
      help: !engine && this.platform !== 'win32' ? MAC_HELP : undefined,
    };
  }

  /** Downloads whatever is missing. Safe to call repeatedly; concurrent calls share one install. */
  install(progress: Progress = () => undefined): Promise<void> {
    this.installing ??= this.doInstall(progress).finally(() => (this.installing = null));
    return this.installing;
  }

  private async doInstall(progress: Progress) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!this.binary()) {
      if (this.platform !== 'win32') throw new Error(MAC_HELP);
      const zip = path.join(this.dir, 'whisper-bin-x64.zip');
      await this.download(WHISPER_WIN.url, zip, WHISPER_WIN.sha256, (f) => progress('Downloading speech engine', f));
      progress('Unpacking speech engine', 1);
      await extractZip(zip, path.join(this.dir, 'whisper'));
      fs.rmSync(zip, { force: true });
    }
    if (!this.status().model) {
      fs.mkdirSync(path.dirname(this.modelPath), { recursive: true });
      await this.download(WHISPER_MODEL.url, this.modelPath, WHISPER_MODEL.sha256, (f) => progress('Downloading speech model', f));
    }
  }

  /** Streams to a temp file, checks SHA-256, then moves into place. */
  async download(url: string, dest: string, sha256: string, onProgress: (fraction: number) => void): Promise<void> {
    const res = await (this.opts.fetchImpl ?? fetch)(url);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const tmp = `${dest}.part`;
    const out = fs.createWriteStream(tmp);
    const hash = crypto.createHash('sha256');
    let got = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        got += value.length;
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        if (total) onProgress(got / total);
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    } catch (err) {
      out.destroy();
      fs.rmSync(tmp, { force: true });
      throw err;
    }
    const digest = hash.digest('hex');
    if (digest !== sha256) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`Download check failed for ${path.basename(dest)} (unexpected checksum). Nothing was installed.`);
    }
    fs.renameSync(tmp, dest);
  }

  /** Transcribes a 16 kHz mono WAV file to plain text. */
  async transcribe(wavPath: string): Promise<string> {
    const bin = this.binary();
    if (!bin || !this.status().model) throw new Error('The speech engine is not installed yet.');
    const outBase = path.join(os.tmpdir(), `jarvis-stt-${crypto.randomBytes(6).toString('hex')}`);
    const threads = Math.max(1, Math.min(8, os.cpus().length - 1));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, ['-m', this.modelPath, '-f', wavPath, '-l', 'en', '-nt', '-np', '-t', String(threads), '-otxt', '-of', outBase], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      let err = '';
      child.stderr.on('data', (d) => (err.length < 2000 ? (err += d) : undefined));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`whisper-cli failed (${code}): ${err.slice(-300)}`))));
    });
    const txt = `${outBase}.txt`;
    try {
      return cleanTranscript(fs.readFileSync(txt, 'utf8'));
    } finally {
      fs.rmSync(txt, { force: true });
    }
  }
}

/** Joins whisper's lines and drops its non-speech markers like [BLANK_AUDIO] or (music). */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE)[^\]]*\]/gi, ' ')
    .replace(/\((?:music|silence|background noise|inaudible|applause)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extracts a zip with fflate, refusing paths that escape the destination. */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const { unzipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
  const root = path.resolve(destDir);
  for (const [name, data] of Object.entries(files)) {
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`unsafe path in zip: ${name}`);
    if (name.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}
