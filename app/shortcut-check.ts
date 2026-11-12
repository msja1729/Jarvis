/**
 * Whether a shortcut is safe to take over for the whole computer. A global shortcut is taken away from
 * every other app, so a plain letter (every "a" typed would start listening) or an everyday shortcut
 * (Ctrl+Tab, Ctrl+C…) would break normal typing. Returns why not, or null if it is fine.
 */
const EVERYDAY = new Set([
  'Control+Tab', 'Control+Shift+Tab', 'Alt+Tab', 'Alt+Shift+Tab', 'Alt+F4', 'Control+F4',
  'Control+C', 'Control+V', 'Control+X', 'Control+Z', 'Control+Y', 'Control+A', 'Control+S', 'Control+F', 'Control+P',
  'Control+N', 'Control+T', 'Control+W', 'Control+R', 'Control+O', 'Control+L', 'Control+Shift+T', 'Control+Shift+N',
  'Control+Alt+Delete', 'Super+L', 'Super+D', 'Super+E', 'Super+R', 'Super+Tab',
]);
const MODIFIERS = ['Control', 'Alt', 'Shift', 'Super'];

export function shortcutProblem(accelerator: string): string | null {
  const parts = accelerator.split('+').map((p) => p.trim()).filter(Boolean);
  const mods = parts.filter((p) => MODIFIERS.includes(p));
  const keys = parts.filter((p) => !MODIFIERS.includes(p));
  if (keys.length !== 1) return 'A shortcut needs exactly one key besides Ctrl, Alt, Shift or the Windows key.';
  const key = keys[0];
  const fKey = /^F([1-9]|1\d|2[0-4])$/.test(key);
  if (!fKey && !mods.some((m) => m !== 'Shift')) {
    return `"${parts.join('+')}" would stop that key working in every app. Add Ctrl, Alt or the Windows key (or use an F-key).`;
  }
  const norm = [...MODIFIERS.filter((m) => mods.includes(m)), key].join('+');
  if (EVERYDAY.has(norm)) return `"${norm}" is an everyday shortcut in other apps (it would stop working there). Pick another one, like Ctrl+Alt+Space.`;
  return null;
}
