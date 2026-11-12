/**
 * The Jarvis team: specialist roles, each with its own expertise, apps, voice,
 * conversation and memory. Jarvis (general) is the front desk and can use every app.
 * A role only gets its own apps, so each request carries fewer tool descriptions.
 */
export interface RoleDef {
  id: RoleId;
  /** The role, e.g. "Doctor". */
  name: string;
  /** A human name the user can call them by (they can rename them on the Team page). */
  person: string;
  /** Short title shown under the name. */
  title: string;
  /** One line for the Team page. */
  blurb: string;
  /** Accent colour (from the validated palette). */
  color: string;
  /** App ids whose tools this role may use; '*' = every app. Custom (user-added) apps go to roles with 'custom'. */
  apps: string[] | '*';
  /** Natural voice used until the user picks one. */
  defaultVoice: string;
  /** Words people use to call this role by name. */
  names: string[];
  /** Topic words that send a question to this role when the user has not said who. */
  topics: RegExp;
  /** Weaker clues (count half), e.g. "explain" could be about anything. */
  weak?: RegExp;
  /** Example questions for the chat's empty state. */
  examples: string[];
  /** Always use this model for this member (the user's model override in Settings still wins). */
  model?: 'opus';
}

/** Every member has these: their own folder, their skills, and the web. */
export const SHARED_APPS = ['files', 'skills', 'web', 'team'];

export const ROLE_IDS = ['jarvis', 'pa', 'pm', 'doctor', 'finance'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const ROLES: RoleDef[] = [
  {
    id: 'jarvis',
    person: 'Jarvis',
    name: 'Jarvis',
    title: 'Front desk',
    blurb: 'The front desk: passes everything you ask to the right expert. Speaks only to welcome you and introduce the team.',
    color: '#9a9a96',
    apps: '*',
    defaultVoice: 'bm_george',
    names: ['jarvis'],
    topics: /$^/,
    examples: ['What can my team do?'],
  },
  {
    id: 'pa',
    person: 'Maya',
    name: 'PA',
    title: 'Personal assistant',
    blurb: 'Your schedule, email, deadlines, daily plan and every personal task the others don’t cover.',
    color: '#3987e5',
    apps: ['gmail', 'gcal', 'outlook', 'outlookcal', 'recorder', 'documents', 'reminders', 'board', ...SHARED_APPS],
    defaultVoice: 'bf_emma',
    names: ['pa', 'assistant', 'secretary'],
    topics: /\b(schedule|calendar|meeting|meetings|appointment|remind|reminder|agenda|plan my (day|week)|my day|email|emails|e-?mail|inbox|mail|reply to|invite|free (time|slot)|busy|tomorrow's|today's)\b/i,
    examples: ['What does my day look like?', 'Read my latest emails'],
  },
  {
    id: 'pm',
    person: 'Ryan',
    name: 'Project Manager',
    title: 'Projects and coding',
    blurb: 'Runs coding work with Claude Code on Opus 5.5, takes meeting minutes, tracks progress and deadlines.',
    color: '#199e70',
    apps: ['coding', 'documents', 'gcal', 'outlookcal', 'screen', 'board', 'reminders', 'recorder', 'custom', ...SHARED_APPS],
    defaultVoice: 'am_michael',
    names: ['pm', 'project manager', 'manager', 'lead'],
    topics: /\b(project|projects|code|coding|codebase|repo|repository|bug|feature|build|deploy|deadline|milestone|sprint|task list|refactor|pull request|github|claude code)\b/i,
    examples: ['Add a login page to my project', 'Record this meeting and take notes'],
    model: 'opus',
  },
  {
    id: 'doctor',
    person: 'Sara',
    name: 'Doctor',
    title: 'Health and nutrition',
    blurb: 'Health questions, food, sleep and exercise; explains your reports. Not a replacement for a real doctor.',
    color: '#d55181',
    apps: ['documents', 'lesson', 'screen', 'reminders', ...SHARED_APPS],
    defaultVoice: 'af_heart',
    names: ['doctor', 'doc', 'physician'],
    topics: /\b(health|healthy|doctor|symptom|symptoms|pain|headache|fever|cold|cough|sick|ill|medicine|medication|diet|eat|eating|food|meal|nutrition|calorie|calories|protein|vitamin|sleep|exercise|workout|weight|blood|report|cholesterol|sugar|bp|blood pressure)\b/i,
    examples: ['What should I eat for dinner?', 'Explain my blood test report'],
  },
  {
    id: 'finance',
    person: 'Victor',
    name: 'Finance',
    title: 'Money and business',
    blurb: 'Budgets, spending, investing basics and business analysis. Information, not regulated advice.',
    color: '#c98500',
    apps: ['documents', 'lesson', 'screen', ...SHARED_APPS],
    defaultVoice: 'am_fenrir',
    names: ['finance', 'accountant', 'cfo', 'banker', 'business'],
    topics: /\b(money|budget|budgets|spend|spending|expense|expenses|save|saving|savings|invest|investing|investment|stock|stocks|shares|mutual fund|sip|loan|emi|interest|tax|taxes|salary|income|profit|revenue|pricing|business plan|startup|invoice|finance|financial)\b/i,
    examples: ['Help me make a monthly budget', 'Is this business idea profitable?'],
  },
];

export const roleById = (id: string | null | undefined): RoleDef => ROLES.find((r) => r.id === id) ?? ROLES[0];
export const isRole = (id: unknown): id is RoleId => typeof id === 'string' && (ROLE_IDS as readonly string[]).includes(id);

/** Can this role use the app? Custom (user-added) apps belong to roles that list 'custom'. */
export function roleUsesApp(role: RoleDef, appId: string, isCustom: boolean): boolean {
  if (role.apps === '*') return true;
  return role.apps.includes(appId) || (isCustom && role.apps.includes('custom'));
}

/** Names people may give a team member: letters, spaces, apostrophes and hyphens, 2-20 characters. */
export const PERSON_NAME = /^[\p{L}][\p{L} '.-]{1,19}$/u;

/** The person names in use: the user's choices, else the defaults. */
export function peopleNames(custom: Partial<Record<string, string>> = {}): Record<RoleId, string> {
  const out = {} as Record<RoleId, string>;
  for (const r of ROLES) out[r.id] = r.id === 'jarvis' ? 'Jarvis' : (custom[r.id] && PERSON_NAME.test(custom[r.id]!) ? custom[r.id]!.trim() : r.person);
  return out;
}

/** "Sara (Doctor)". */
export const fullName = (role: RoleId, people: Record<RoleId, string>) => (role === 'jarvis' ? 'Jarvis' : `${people[role]} (${roleById(role).name})`);
