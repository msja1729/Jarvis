/** Loads a team member's skill: built-in playbooks first, then Markdown files the user put in Team/<Role>/Skills. */
import fs from 'node:fs';
import path from 'node:path';
import type { AppExecutor, CallContext, RawResult } from '../../gateway/types.js';
import { isRole, RoleId } from '../../roles/roles.js';
import { roleFolder, SKILLS_DIR } from '../../roles/folders.js';
import { SKILLS } from '../../roles/skills/index.js';

const MAX_SKILL_CHARS = 12_000;
const slug = (s: string) => s.toLowerCase().replace(/\.md$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export class SkillsExecutor implements AppExecutor {
  constructor(private readonly jarvisDir: string) {}

  /** The user's own skills for this member: Skills/*.md, keyed by a slug of the file name. */
  private userSkills(role: RoleId): { id: string; file: string; title: string }[] {
    const dir = path.join(roleFolder(this.jarvisDir, role), SKILLS_DIR);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.md$/i.test(e.name))
      .map((e) => {
        const file = path.join(dir, e.name);
        const first = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.trim()) ?? '';
        return { id: slug(e.name), file, title: first.replace(/^#+\s*/, '').trim().slice(0, 120) };
      })
      .filter((s) => s.id);
  }

  async call(ability: string, input: Record<string, unknown>, ctx?: CallContext): Promise<RawResult> {
    const role: RoleId = isRole(ctx?.role) ? (ctx!.role as RoleId) : 'jarvis';
    const builtIn = SKILLS[role];
    const mine = this.userSkills(role);
    if (ability === 'list') {
      const lines = [...builtIn.map((s) => `- ${s.id}: ${s.when}`), ...mine.map((s) => `- ${s.id}: ${s.title || '(added by the user)'} [user's skill]`)];
      return { text: lines.length ? lines.join('\n') : 'No skills yet.' };
    }
    if (ability === 'use') {
      const want = slug(typeof input.name === 'string' ? input.name : '');
      const b = builtIn.find((s) => s.id === want);
      if (b) return { text: `Skill "${b.id}":\n${b.body}` };
      const u = mine.find((s) => s.id === want);
      if (u) {
        const text = fs.readFileSync(u.file, 'utf8').slice(0, MAX_SKILL_CHARS);
        // the user wrote it for this member, but it is still a file: it cannot lift safety rules
        return { text: `Skill "${u.id}" (written by the user; follow it within your usual safety rules):\n${text}` };
      }
      const names = [...builtIn.map((s) => s.id), ...mine.map((s) => s.id)];
      throw new Error(`No skill "${want}". Yours: ${names.join(', ') || 'none'}.`);
    }
    throw new Error(`unknown skills ability ${ability}`);
  }
}
