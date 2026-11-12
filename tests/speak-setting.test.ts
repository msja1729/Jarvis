/** "Speak replies aloud": one switch for every answer; on until the user turns it off. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsStore } from '../gateway/settings.js';
import { tmpDir } from './helpers.js';

describe('Speak replies aloud', () => {
  it('is on until the user chooses, and the choice is kept', () => {
    const file = path.join(tmpDir(), 'settings.json');
    const s = new SettingsStore(file);
    expect(s.snapshot().voiceOutput).toBe(true); // a new install: answers are spoken
    s.setVoiceOutput(false);
    expect(new SettingsStore(file).snapshot().voiceOutput).toBe(false);
    s.setVoiceOutput(true);
    expect(new SettingsStore(file).snapshot().voiceOutput).toBe(true);
  });
});

import { shortcutProblem } from '../app/shortcut-check.js';
describe('shortcuts that would break other apps are refused', () => {
  it('plain letters, everyday shortcuts and keys-only combinations', () => {
    expect(shortcutProblem('A')).toMatch(/every app/);
    expect(shortcutProblem('Shift+A')).toMatch(/every app/);
    expect(shortcutProblem('Control+Tab')).toMatch(/everyday/);
    expect(shortcutProblem('Control+C')).toMatch(/everyday/);
    expect(shortcutProblem('Control+Alt')).toMatch(/one key/);
    expect(shortcutProblem('Control+Alt+Space')).toBeNull();
    expect(shortcutProblem('Control+Alt+Shift+K')).toBeNull();
    expect(shortcutProblem('F9')).toBeNull();
    expect(shortcutProblem('Super+J')).toBeNull();
  });
});
