/** Destructive abilities can be "ask" or "off", never "allowed" (SPEC 6.3, criterion 29). */
import type { AbilityGroup, AbilitySetting } from '../gateway/types.js';

export class DestructiveLockError extends Error {
  constructor() {
    super('Destructive abilities (delete, archive, payments) can only be "Ask me first" or "Off".');
    this.name = 'DestructiveLockError';
  }
}

export function allowedSettings(group: AbilityGroup): AbilitySetting[] {
  return group === 'destructive' ? ['ask', 'off'] : ['allowed', 'ask', 'off'];
}

export function assertSettingAllowed(group: AbilityGroup, setting: AbilitySetting): void {
  if (!allowedSettings(group).includes(setting)) throw new DestructiveLockError();
}
