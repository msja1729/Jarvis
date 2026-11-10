/**
 * Model by task (T9, criterion 16): quick look-ups → haiku;
 * drafting, explaining, screen look → sonnet; the Project Manager → opus. User override wins.
 */
import type { ModelChoice } from '../brain/brain.js';
import { roleById, RoleId } from '../roles/roles.js';

const LARGE = [
  /\b(draft|write|compose|reply|respond|rewrite|summari[sz]e|summary|explain|why|how does|how do|teach|lesson|learn|understand)\b/,
  /\b(screen|screenshot|draw|diagram|sketch)\b/,
  /\b(schedule|book|arrange|plan|organi[sz]e)\b/,
];

const SMALL = [
  /\b(read|list|show|check|what'?s on|what is on|any|unread|latest|recent|find|search|look up|when is|who)\b/,
];

export function pickModel(text: string, override: ModelChoice | null = null): ModelChoice {
  if (override) return override;
  const t = text.toLowerCase();
  if (LARGE.some((re) => re.test(t))) return 'sonnet';
  if (SMALL.some((re) => re.test(t))) return 'haiku';
  // Unknown requests default to the larger model to avoid poor answers.
  return 'sonnet';
}

/** The model for a team member's request: their own model if they have one (the Project Manager uses Opus), else by task. */
export function modelFor(role: RoleId, text: string, override: ModelChoice | null = null): ModelChoice {
  if (override) return override;
  return roleById(role).model ?? pickModel(text);
}
