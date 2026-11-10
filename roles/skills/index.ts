/** Built-in expert skills for each team member. Jarvis (front desk) hands expert work to them. */
import type { RoleId } from '../roles.js';
import type { Skill } from './types.js';
import { DOCTOR_SKILLS } from './doctor.js';
import { EDUCATOR_SKILLS } from './educator.js';
import { FINANCE_SKILLS } from './finance.js';
import { PA_SKILLS } from './pa.js';
import { PM_SKILLS } from './pm.js';

export type { Skill } from './types.js';

export const SKILLS: Record<RoleId, Skill[]> = {
  jarvis: [],
  pa: PA_SKILLS,
  educator: EDUCATOR_SKILLS,
  pm: PM_SKILLS,
  doctor: DOCTOR_SKILLS,
  finance: FINANCE_SKILLS,
};

/** The lines that go in a member's instructions: "- id: when to use it". */
export function skillIndex(role: RoleId): string {
  const list = SKILLS[role];
  if (!list.length) return '';
  return `Skills: your expert playbooks. Before a task that matches one, load it with skills use (name) and follow it:
${list.map((s) => `- ${s.id}: ${s.when}`).join('\n')}
The user may add more in your folder's Skills folder (skills list shows them).`;
}
