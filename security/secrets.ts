/**
 * App credentials live only in the OS secure store (SPEC 7, criterion 32):
 * macOS Keychain / Windows Credential Manager via @napi-rs/keyring.
 * Nothing in this module ever writes a credential to a file.
 *
 * Windows limits one credential to 1,280 UTF-16 chars, and OAuth tokens
 * (Microsoft especially) are often longer, so long values are split into chunks.
 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Raw single-entry storage with a per-entry size limit. */
export interface RawSecretBackend {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export const SERVICE = 'dev.jarvis.desktop';
export const CHUNK_SIZE = 1000;
const CHUNK_MARK = 'jarvis-chunks:';
const MAX_CHUNKS = 64;

/** Splits long values across entries "key", "key#1", "key#2", … */
export class ChunkedSecretStore implements SecretStore {
  constructor(
    private readonly raw: RawSecretBackend,
    private readonly chunk = CHUNK_SIZE,
  ) {}

  async get(key: string): Promise<string | null> {
    const head = this.raw.get(key);
    if (head === null || !head.startsWith(CHUNK_MARK)) return head;
    const n = Number(head.slice(CHUNK_MARK.length));
    const parts: string[] = [];
    for (let i = 1; i <= n; i++) {
      const p = this.raw.get(`${key}#${i}`);
      if (p === null) return null; // partial write: treat as missing
      parts.push(p);
    }
    return parts.join('');
  }

  async set(key: string, value: string): Promise<void> {
    await this.delete(key);
    if (value.length <= this.chunk && !value.startsWith(CHUNK_MARK)) {
      this.raw.set(key, value);
      return;
    }
    const n = Math.ceil(value.length / this.chunk);
    if (n > MAX_CHUNKS) throw new Error('secret too large');
    for (let i = 1; i <= n; i++) this.raw.set(`${key}#${i}`, value.slice((i - 1) * this.chunk, i * this.chunk));
    this.raw.set(key, `${CHUNK_MARK}${n}`);
  }

  async delete(key: string): Promise<void> {
    const head = this.raw.get(key);
    if (head?.startsWith(CHUNK_MARK)) {
      const n = Number(head.slice(CHUNK_MARK.length));
      for (let i = 1; i <= n; i++) this.raw.delete(`${key}#${i}`);
    }
    this.raw.delete(key);
  }
}

/** OS keychain backend. Loaded lazily so tests never touch the real keychain. */
export async function keyringBackend(service = SERVICE): Promise<RawSecretBackend> {
  const { Entry } = await import('@napi-rs/keyring');
  return {
    get: (key) => {
      try {
        return new Entry(service, key).getPassword() ?? null;
      } catch {
        return null;
      }
    },
    set: (key, value) => new Entry(service, key).setPassword(value),
    delete: (key) => {
      try {
        new Entry(service, key).deletePassword();
      } catch {
        /* already gone */
      }
    },
  };
}

export async function createKeyringStore(service = SERVICE): Promise<SecretStore> {
  return new ChunkedSecretStore(await keyringBackend(service));
}

/** In-memory backend with the same size limit as Windows; for tests. */
export function memoryBackend(limit = 1280): RawSecretBackend & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: (k) => map.get(k) ?? null,
    set: (k, v) => {
      if (v.length > limit) throw new Error(`value longer than platform limit of ${limit}`);
      map.set(k, v);
    },
    delete: (k) => void map.delete(k),
  };
}

export class MemorySecretStore extends ChunkedSecretStore {
  constructor() {
    super(memoryBackend());
  }
}

export function secretKeyForApp(appId: string): string {
  return `app:${appId}`;
}
