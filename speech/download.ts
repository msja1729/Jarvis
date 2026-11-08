/** Streams a download to a temp file, checks its SHA-256, then moves it into place. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export async function downloadVerified(
  fetchImpl: typeof fetch,
  url: string,
  dest: string,
  sha256: string,
  onProgress: (fraction: number) => void = () => undefined,
): Promise<void> {
  const res = await fetchImpl(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
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
  if (hash.digest('hex') !== sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Download check failed for ${path.basename(dest)} (unexpected checksum). Nothing was installed.`);
  }
  fs.renameSync(tmp, dest);
}
