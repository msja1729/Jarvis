import type { Skill } from './types.js';

export const PM_SKILLS: Skill[] = [
  {
    id: 'meeting-minutes',
    when: 'after a recorded meeting, or the user asks for meeting notes',
    body: `Meeting minutes from a transcript:
1. Read the whole transcript (recorder tool, every part). Fix obvious mis-hearings from context; mark unclear parts with (?) rather than guessing.
   If it marks "(screen picture N)", the screen was recorded: look at the pictures (recorder view_screens, 4 at a time) and use what was shown (slide titles, figures, diagrams, what was written on the board) in the minutes, at the point it was shown. Say which picture a fact came from when it matters.
2. Write the minutes: title and date; attendees; summary (3-5 sentences); key points by topic; decisions (one line each, who decided); action items as a table (Task | Owner | Due | Notes) with the USER's own tasks marked clearly; open questions and risks; next meeting.
3. Save to Meetings/<YYYY-MM-DD> <title>.md.
4. For every task given to the user: add it to the board (project, due date as YYYY-MM-DD, turning "by Friday" into a real date) and a reminder the day before at 09:00.
5. Update the project's Projects/<project>/Status.md (what changed, decisions) and Profile/Roadmap.md (new deadlines, decisions made).
6. Reply briefly: the gist, the decisions, and the user's tasks with dates; say where the minutes are saved.`,
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
    when: 'before starting any coding task with Claude Code',
    body: `Spec gate, then a strong coding brief:
1. Read Profile/Roadmap.md and the project's Projects/<project>/ files. Look at the code first (documents tool) and cite the paths that matter.
2. Write Projects/<project>/SPEC.md from Reference/Spec template.md: goal, scope (MoSCoW), context, design, edge cases, breaking changes and risks, test plan, definition of done, open questions.
3. Show the user a short summary of the spec and ask for OK or changes. Do not start the coding task before they agree.
4. Then start the coding task with a brief built from the spec: goal, files and conventions (Reference/Coding standards.md), requirements and constraints, the tests that must pass, Reference/Definition of done.md, and: ask before risky actions (deleting files, migrations, force-push, deploying, new dependencies).
5. Ask Claude Code for small, reviewable steps and a summary of changes at the end.
6. Afterwards: check the summary and tests against the spec's definition of done, update the board, the project's Status.md and the Roadmap, and tell the user what changed and what to check.`,
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
  {
    id: 'scope-guard',
    when: 'a new idea, feature request or change of plans arrives',
    body: `Scope guard (protect focus and deadlines):
1. Read Profile/Roadmap.md and the board (what is in progress, what is due soon).
2. Restate the idea in one sentence and ask what problem it solves and for whom, if unclear.
3. Score it quickly with RICE (Reach, Impact, Confidence, Effort) or place it in MoSCoW for the current milestone.
4. Show the trade-off plainly: what it would push back, by how long, and the risk to current deadlines.
5. Recommend one: do now (and what gets dropped), schedule for Next, or park in Later with the reason. Push back on scope creep; it is fine to say "not now".
6. Record the decision in the Roadmap ("Decisions made", dated) and on the board.`,
  },
];
