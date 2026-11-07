/**
 * Model by task (T9, criterion 16): quick look-ups → haiku;
 * drafting, explaining, screen look, whiteboard → sonnet. User override wins.
 */
import type { ModelChoice } from '../brain/brain.js';

const LARGE = [
  /\b(draft|write|compose|reply|respond|rewrite|summari[sz]e|summary|explain|why|how does|teach)\b/,
  /\b(screen|screenshot|whiteboard|draw|diagram|sketch)\b/,
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
