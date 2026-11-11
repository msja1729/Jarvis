/**
 * Every team member has a folder of their own inside the Jarvis folder:
 *   <Jarvis folder>/Team/<Role>/...
 * They keep their work there (notes, plans, meeting minutes, research) and may make
 * sub-folders. Teammates can read each other's folders, but only write in their own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RoleId, ROLES, roleById } from './roles.js';

/** Folder names stay the same when the user renames someone (Sara → Priya), so files never move. */
export const ROLE_FOLDER: Record<RoleId, string> = {
  jarvis: 'Jarvis',
  pa: 'PA',
  pm: 'Project Manager',
  doctor: 'Doctor',
  finance: 'Finance',
};

/** Where the user can drop their own skills for a team member (Markdown files). */
export const SKILLS_DIR = 'Skills';

const STARTER: Partial<Record<RoleId, string[]>> = {
  pa: ['Plans', 'Inbox notes'],
  pm: ['Projects', 'Meetings'],
  doctor: ['Health notes'],
  finance: ['Budgets'],
};

export const teamRoot = (jarvisDir: string) => path.join(jarvisDir, 'Team');
export const roleFolder = (jarvisDir: string, role: RoleId) => path.join(teamRoot(jarvisDir), ROLE_FOLDER[role]);

function readme(role: RoleId): string {
  const r = roleById(role);
  return `# ${r.name}'s folder

This is where ${role === 'jarvis' ? 'Jarvis' : `your ${r.title.toLowerCase()}`} keeps their work: notes, plans,
research and anything they write for you. You can open, edit or add files here yourself.

- Teammates can read this folder (to look things up), but only ${r.name} writes in it.
- Put your own skills in the "${SKILLS_DIR}" folder as Markdown (.md) files: a title line,
  then the steps or rules you want followed. ${r.name} will see them next time.
`;
}

/** Creates the team folders (once) with a short README and starter sub-folders. Never touches existing files. */
export function ensureRoleFolders(jarvisDir: string): void {
  for (const r of ROLES) {
    const dir = roleFolder(jarvisDir, r.id);
    fs.mkdirSync(path.join(dir, SKILLS_DIR), { recursive: true });
    for (const sub of STARTER[r.id] ?? []) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    const file = path.join(dir, 'README.md');
    if (!fs.existsSync(file)) fs.writeFileSync(file, readme(r.id));
  }
}
