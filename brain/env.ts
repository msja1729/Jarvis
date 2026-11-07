/**
 * Environment for the `claude` process (SPEC 4.3 step 3, criterion 3).
 * API-key variables are removed so requests are billed to the Pro plan, not the API.
 */
export const BLOCKED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;

export interface SanitizedEnv {
  env: Record<string, string>;
  /** Names that were present and removed, so the UI can tell the user. */
  removed: string[];
}

export function sanitizeEnv(source: NodeJS.ProcessEnv, extra: Record<string, string> = {}): SanitizedEnv {
  const env: Record<string, string> = {};
  const removed: string[] = [];
  const blocked = new Set<string>(BLOCKED_ENV.map((k) => k.toUpperCase()));
  for (const [k, v] of Object.entries({ ...source, ...extra })) {
    if (v === undefined) continue;
    // Windows env names are case-insensitive.
    if (blocked.has(k.toUpperCase())) {
      removed.push(k);
      continue;
    }
    env[k] = v;
  }
  return { env, removed };
}
