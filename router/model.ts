/**
 * Model per team member: everyone answers with Sonnet; the Project Manager uses Opus.
 * The same for every request, so a conversation never switches models half way.
 */
import type { ModelChoice } from '../brain/brain.js';
import { roleById, RoleId } from '../roles/roles.js';

export const DEFAULT_MODEL: ModelChoice = 'sonnet';

/** The model for a team member's request: their own model if they have one (the Project Manager uses Opus), else Sonnet. */
export function modelFor(role: RoleId): ModelChoice {
  return roleById(role).model ?? DEFAULT_MODEL;
}
