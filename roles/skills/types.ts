/** A skill: an expert playbook a team member loads (skills → use) right before a task it fits. */
export interface Skill {
  /** Short id, e.g. "lab-report". */
  id: string;
  /** One line: when to use it (shown in the member's instructions). */
  when: string;
  /** The playbook itself: method, checks, output format. Loaded only when used. */
  body: string;
}
