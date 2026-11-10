/**
 * Which team members may use which app. The user decides per app in the Tool Hub
 * ("Who can use it"); until they do, each member has their usual apps (roles.ts).
 * - Jarvis, the front desk, can always use every app.
 * - Everyone always has their folder, their skills, the web and the team tool.
 * The Gateway enforces this; the Off / Ask me first / Allowed settings still apply on top.
 */
import { ROLE_IDS, RoleId, roleById, roleUsesApp, SHARED_APPS } from './roles.js';

/** The members the user can give an app to (not Jarvis, who has them all). */
export const SPECIALISTS = ROLE_IDS.filter((r) => r !== 'jarvis') as Exclude<RoleId, 'jarvis'>[];

/** The user's choices: app id → members. */
export type AppMembers = Record<string, string[]>;

interface AppLike {
  id: string;
  name: string;
  description?: string;
  kind: 'builtin' | 'mcp';
}

/** Apps every member always has; their "Who can use it" cannot be changed. */
export const isShared = (appId: string) => SHARED_APPS.includes(appId);

export function canUse(role: RoleId, app: AppLike, choices: AppMembers = {}): boolean {
  if (role === 'jarvis' || isShared(app.id)) return true;
  const chosen = choices[app.id];
  if (Array.isArray(chosen)) return chosen.includes(role);
  return roleUsesApp(roleById(role), app.id, app.kind === 'mcp');
}

/** The members (not Jarvis) who may use an app now. */
export const membersOf = (app: AppLike, choices: AppMembers = {}) => SPECIALISTS.filter((r) => canUse(r, app, choices));

/** Only real members, each once. */
export const cleanMembers = (list: unknown): RoleId[] =>
  Array.isArray(list) ? SPECIALISTS.filter((r) => list.includes(r)) : [];

const HINTS: [Exclude<RoleId, 'jarvis'>, RegExp][] = [
  ['pm', /\b(git|github|gitlab|bitbucket|code|coding|repo|issues?|jira|linear|asana|trello|clickup|sprint|projects?|deploy|vercel|netlify|sentry|figma|database|sql|supabase|docker|api)\b/],
  ['pa', /\b(e-?mail|mail|gmail|outlook|calendar|slack|teams|whatsapp|telegram|todo|to-do|tasks?|reminders?|notes?|notion|evernote|drive|dropbox|docs|contacts?|travel|flights?|zoom|meet|maps)\b/],
  ['educator', /\b(notion|wiki|wikipedia|docs|drive|course|courses|learn|learning|paper|papers|scholar|arxiv|books?|wolfram|anki|flashcards?|youtube|research)\b/],
  ['doctor', /\b(health|fitness|fit|medical|medicine|sleep|nutrition|diet|strava|garmin|oura|whoop|apple health|workouts?)\b/],
  ['finance', /\b(bank|banking|finance|financial|stripe|invoices?|accounting|budget|expenses?|crypto|stocks?|market|tax|payments?|sheets|excel|quickbooks|xero|zerodha)\b/],
];

/** A first guess at who should get a newly added app, from its name and description. */
export function guessMembers(app: { id: string; name: string; description?: string }): RoleId[] {
  const text = `${app.id} ${app.name} ${app.description ?? ''}`.toLowerCase().replace(/_/g, ' ');
  const hit = HINTS.filter(([, re]) => re.test(text)).map(([r]) => r);
  return hit.length ? SPECIALISTS.filter((r) => hit.includes(r)) : ['pa', 'pm'];
}
