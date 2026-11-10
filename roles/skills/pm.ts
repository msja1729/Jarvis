import type { Skill } from './types.js';

export const PM_SKILLS: Skill[] = [
  {
    id: 'meeting-minutes',
    when: 'after a recorded meeting, or the user asks for meeting notes',
    body: `Meeting minutes from a transcript:
1. Read the whole transcript (recorder tool, every part). Speech-to-text has errors: fix obvious mis-hearings from context; mark anything unclear with (?) rather than guessing.
2. Write the minutes:
   # <Meeting title> — <date>
   **Attendees** (as far as the transcript shows)
   **Summary**: 3-5 sentences, what the meeting was for and the outcome.
   **Key points**: by topic, short bullets.
   **Decisions**: each decision in one line, with who decided if known.
   **Action items**: table of Task | Owner | Due | Notes. Mark the USER's own tasks clearly (the user is "me/I" in their own speech or addressed by name).
   **Open questions / risks**
   **Next meeting** if mentioned.
3. Save to "Meetings/<YYYY-MM-DD> <title>.md" in your folder.
4. For every task given to the user: add it to the project board (project = the meeting's project, due date as YYYY-MM-DD when one was said; turn "by Friday" into a real date using today's date), and add a reminder the day before each due date (09:00) through the reminders tool.
5. Reply briefly: the gist, the decisions, and the user's tasks with due dates, then say where the full minutes are saved.`,
  },
  {
    id: 'project-brief',
    when: 'starting a new project or feature, or the user has a vague idea',
    body: `Project brief (one page, before any building):
1. Ask only the questions that matter (max 5): who is it for, what problem, what does success look like, deadline, constraints (tech, budget, must-use tools), what is out of scope.
2. Write the brief:
   - Problem and users (who, pain, current workaround)
   - Goals (measurable) and non-goals
   - Requirements: must / should / could (MoSCoW)
   - User stories with acceptance criteria ("Given … when … then …")
   - Approach and key technical choices with one-line reasons
   - Milestones with dates; risks and assumptions; open questions
3. Save it to "Projects/<project>/Brief.md" and put the milestones on the project board.
4. Get the user's OK on scope before starting coding work.`,
  },
  {
    id: 'plan-breakdown',
    when: 'planning work, estimating, or breaking a big task into steps',
    body: `Planning and breakdown:
1. Work breakdown: split the goal into deliverables, then into tasks of half a day to two days each, each with a clear "done" check. Vertical slices (something working end-to-end early) beat building layer by layer.
2. Order by dependencies and risk: do the riskiest unknowns first (spikes), find the critical path.
3. Estimate with three points (optimistic, likely, pessimistic; expected ≈ (O + 4L + P) / 6) and add a buffer of 20-30% for unknowns. Say the confidence.
4. Milestones every 1-2 weeks with something demo-able.
5. Put tasks on the project board (project name, status todo, due dates) and save the plan in "Projects/<project>/Plan.md".
6. Re-plan when reality differs: say what slips, why, and the options (cut scope, move date, add help).`,
  },
  {
    id: 'coding-brief',
    when: 'before starting a coding task with Claude Code',
    body: `Writing a strong coding brief for Claude Code:
1. Goal: what the user should be able to do when it is finished, in one or two sentences.
2. Context: the project folder, relevant files or modules (look first with the documents tool and cite paths), the stack, and existing conventions to follow.
3. Requirements and constraints: behaviour, edge cases, things that must not change, libraries allowed or not, performance or security needs.
4. Definition of done: tests to add or update and that must pass, how to verify by hand, no new warnings, docs updated if needed.
5. Ask for small, reviewable steps and a short summary of changes at the end.
6. Risky actions (deleting files, migrations, force-push, deploying, installing new packages) must be raised as questions, not done silently.
7. Afterwards: review the summary and test results, update the board, and tell the user what changed and what they should check.`,
  },
  {
    id: 'status-report',
    when: 'the user asks how a project is going, or for a weekly update',
    body: `Status report:
1. Gather facts: board (done / doing / todo, overdue items), coding status, recent meeting minutes in "Meetings/", the plan in "Projects/".
2. Overall status RAG: Green (on track), Amber (at risk, recoverable), Red (off track, needs a decision). One line why.
3. Done since last update; in progress; next; blocked (with what unblocks it).
4. Risks: likelihood × impact, with mitigation and owner. Keep a running "Projects/<project>/Risks.md".
5. Decisions needed from the user, each with options and your recommendation.
6. Keep it short enough to read in a minute; numbers over adjectives.`,
  },
  {
    id: 'code-review',
    when: 'reviewing code, a pull request or changes Claude Code made',
    body: `Code review checklist (most important first):
1. Correctness: does it do what was asked? Edge cases (empty, null, very large, unicode, time zones, concurrency), error handling, off-by-one.
2. Security: input validation, injection (SQL, shell, HTML), secrets in code or logs, authentication/authorisation checks, unsafe file paths, dependencies with known issues.
3. Tests: do they cover the new behaviour and failure cases? Do they actually fail without the change?
4. Design: simple and consistent with the codebase; no duplication; clear names; small functions; no dead code.
5. Performance where it matters (loops over large data, repeated I/O, N+1 queries).
6. Readability and docs for anything non-obvious.
Report findings ranked by severity, each with file:line, why it matters and a concrete fix. Say clearly when it is good to merge.`,
  },
];
