/**
 * Ability settings: storage, defaults, and the rules that can never be broken.
 * Only the Tool Hub UI calls the setters. Nothing reachable from Claude can.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AbilityDef,
  AbilityGroup,
  AbilitySetting,
  AppDef,
  AppSettings,
  EXPLAIN_LEVELS,
  ExplainLevel,
  GROUP_DEFAULTS,
  JarvisSettings,
} from './types.js';
import { assertSettingAllowed } from '../security/destructive-lock.js';

export function groupOf(ability: AbilityDef): AbilityGroup {
  return ability.group ?? 'act';
}

export function defaultSetting(ability: AbilityDef): AbilitySetting {
  const group = groupOf(ability);
  const value = ability.defaultSetting ?? GROUP_DEFAULTS[group];
  return group === 'destructive' && value === 'allowed' ? 'ask' : value;
}

export function emptySettings(): JarvisSettings {
  return { apps: {}, customApps: [], modelOverride: null, voiceOutput: false, oauthClients: {} };
}

export class SettingsStore {
  private data: JarvisSettings;

  constructor(private readonly file: string | null) {
    this.data = emptySettings();
    if (file && fs.existsSync(file)) {
      try {
        this.data = { ...emptySettings(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      } catch {
        this.data = emptySettings();
      }
    }
  }

  snapshot(): JarvisSettings {
    return structuredClone(this.data);
  }

  isEnabled(app: AppDef): boolean {
    return this.data.apps[app.id]?.enabled ?? app.defaultEnabled === true;
  }

  /**
   * The setting the Gateway enforces. Disabled app → off.
   * A destructive ability is never "allowed", whatever the file says.
   */
  effective(app: AppDef, ability: AbilityDef): AbilitySetting {
    if (!this.isEnabled(app)) return 'off';
    const stored = this.data.apps[app.id]?.abilities?.[ability.name];
    const value = stored ?? defaultSetting(ability);
    if (groupOf(ability) === 'destructive' && value === 'allowed') return 'ask';
    return value;
  }

  setEnabled(appId: string, enabled: boolean): void {
    this.ensure(appId).enabled = enabled;
    this.save();
  }

  setAbility(app: AppDef, abilityName: string, setting: AbilitySetting): void {
    const ability = app.abilities.find((a) => a.name === abilityName);
    if (!ability) throw new Error(`Unknown ability ${abilityName} for ${app.id}`);
    assertSettingAllowed(groupOf(ability), setting);
    this.ensure(app.id).abilities[abilityName] = setting;
    this.save();
  }

  addCustomApp(app: AppDef): void {
    this.data.customApps = this.data.customApps.filter((a) => a.id !== app.id).concat(app);
    this.ensure(app.id).enabled = true;
    this.save();
  }

  removeCustomApp(appId: string): void {
    this.data.customApps = this.data.customApps.filter((a) => a.id !== appId);
    delete this.data.apps[appId];
    this.save();
  }

  setModelOverride(model: JarvisSettings['modelOverride']): void {
    this.data.modelOverride = model;
    this.save();
  }

  setOAuthClient(accountId: string, clientId: string | null): void {
    if (clientId) this.data.oauthClients[accountId] = { clientId: clientId.trim() };
    else delete this.data.oauthClients[accountId];
    this.save();
  }

  oauthClientId(accountId: string): string | null {
    return this.data.oauthClients[accountId]?.clientId ?? null;
  }

  setSupervisor(patch: NonNullable<JarvisSettings['supervisor']>): void {
    const cur = this.data.supervisor ?? {};
    const next = { ...cur };
    if (patch.autonomy && ['careful', 'balanced', 'handsoff'].includes(patch.autonomy)) next.autonomy = patch.autonomy;
    if (typeof patch.updateEvery === 'number' && [0, 3, 5, 10, 15].includes(patch.updateEvery)) next.updateEvery = patch.updateEvery;
    if (typeof patch.speak === 'boolean') next.speak = patch.speak;
    if (typeof patch.lastFolder === 'string') next.lastFolder = patch.lastFolder;
    if (typeof patch.watchOwn === 'boolean') next.watchOwn = patch.watchOwn;
    this.data.supervisor = next;
    this.save();
  }

  setPttHotkey(accelerator: string | null): void {
    this.data.pttHotkey = accelerator;
    this.save();
  }

  setVoiceCardHotkey(accelerator: string | null): void {
    this.data.voiceCardHotkey = accelerator;
    this.save();
  }

  setPa(patch: { planAt?: string | null; lastPlan?: string }): void {
    const next = { ...(this.data.pa ?? {}) };
    if (patch.planAt === null || (typeof patch.planAt === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.planAt))) next.planAt = patch.planAt;
    if (typeof patch.lastPlan === 'string') next.lastPlan = patch.lastPlan;
    this.data.pa = next;
    this.save();
  }

  setKeepHistory(on: boolean): void {
    this.data.keepHistory = on;
    this.save();
  }

  setRoleName(role: string, name: string | null): void {
    const next = { ...(this.data.roleNames ?? {}) };
    if (name) next[role] = name;
    else delete next[role];
    this.data.roleNames = next;
    this.save();
  }

  setRoleVoice(role: string, voice: string): void {
    this.data.roleVoices = { ...(this.data.roleVoices ?? {}), [role]: voice };
    this.save();
  }

  setTts(voice: string | undefined, speed: number | undefined): void {
    if (voice !== undefined) this.data.ttsVoice = voice;
    if (speed !== undefined) this.data.ttsSpeed = speed;
    this.save();
  }

  setExplainLevel(level: ExplainLevel): void {
    this.data.explainLevel = (EXPLAIN_LEVELS as readonly string[]).includes(level) ? level : 'auto';
    this.save();
  }

  setVoiceOutput(on: boolean): void {
    this.data.voiceOutput = on;
    this.save();
  }

  private ensure(appId: string): AppSettings {
    const existing = this.data.apps[appId];
    if (existing) return existing;
    const created: AppSettings = { enabled: true, abilities: {} };
    this.data.apps[appId] = created;
    return created;
  }

  private save(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
