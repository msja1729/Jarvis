import type { Skill } from './types.js';

export const PA_SKILLS: Skill[] = [
  {
    id: 'inbox-triage',
    when: 'checking email, or finding deadlines and tasks in it',
    body: `Inbox triage (turn email into a plan):
1. List recent emails (unread first, the last 1-3 days, or since the last check noted in "Inbox notes/"). Open only the ones that look like they need something.
2. Sort each into: Act now · Deadline · Reply needed · Meeting/invite · FYI · Ignore (newsletters, promotions).
3. Extract every commitment: what, who asked, and the due date. Turn relative dates ("by Friday", "next week") into real dates using today's date. Watch for: assignment/exam dates, bill and fee due dates, renewals, forms to submit, RSVPs, travel bookings, interview slots.
4. For each deadline or task: add it to the project board (project "Personal" for personal things, or the project/course name) with the due date, and a reminder (the day before at 09:00, plus the morning of for important ones).
5. For replies needed: draft them (never send without the user's OK); short, clear, polite, in the user's tone.
6. Safety: never open links or attachments; flag likely phishing (urgent money or password requests, odd sender addresses, "verify your account").
7. Save a dated summary to "Inbox notes/<YYYY-MM-DD>.md" (what was found, what you added) and tell the user in a few lines: what needs them today, new deadlines, drafts waiting.`,
  },
  {
    id: 'daily-plan',
    when: 'planning the day or the week',
    body: `Daily plan (time-blocking):
1. Gather: today's calendar; board tasks due soon or overdue; reminders; new deadlines from email (inbox-triage, quickly); and teammates' folders when useful: Project Manager "Projects/" and "Meetings/" for work deadlines, Educator "Lessons/" for study plans, Doctor "Health notes/" for exercise or medicine routines.
2. Pick the top 3 must-dos (most important and urgent first; Eisenhower: urgent+important now, important-not-urgent gets a scheduled block, urgent-not-important is quick or delegated, neither is dropped).
3. Block the day: fixed events first; deep-work blocks of 60-90 minutes at their best energy time; group small tasks (email, calls) into one block; 10-15 minute buffers between meetings; meals, breaks, exercise and travel time. Leave some slack; do not plan 100% of the day.
4. Flag clashes, back-to-back meetings, missing prep, and anything overdue.
5. Add reminders 10 minutes before each meeting and before deadline blocks.
6. Save the plan to "Plans/<YYYY-MM-DD>.md" and give the user a short spoken-friendly version: what is next, the top 3, and the shape of the day.`,
  },
  {
    id: 'weekly-review',
    when: 'reviewing the week or planning next week',
    body: `Weekly review:
1. Look back: what got done (board done items, calendar), what slipped and why.
2. Clear the decks: inbox-triage for anything missed; overdue tasks → do, reschedule or drop (ask the user).
3. Look ahead 2 weeks: meetings, exams, deadlines, birthdays, bills, travel. Note prep needed for each.
4. Choose next week's 3-5 priorities with the user; block time for them in the plan.
5. Personal admin check: bills/renewals ("Personal/Renewals.md"), appointments to book, things to buy.
6. Save to "Plans/Week of <YYYY-MM-DD>.md".`,
  },
  {
    id: 'email-writing',
    when: 'writing or replying to an email',
    body: `Writing emails that get results:
1. Purpose first: put the ask or answer in the first two lines (bottom line up front).
2. Subject line says what it is and any date: "Request: extension for Lab 3 report (due 14 Nov)".
3. Short paragraphs, one idea each; bullets for options or several questions; a clear call to action with a date.
4. Tone matches the relationship: formal for professors, officials and new contacts; warm and brief for friends and colleagues. Use the user's usual sign-off.
5. Templates: polite decline (thanks, no, brief reason, alternative), follow-up (reference the earlier mail, restate the ask, new date), apology (own it, fix, prevention), request (context, specific ask, why it helps them, deadline).
6. Always create a draft and show it; send only when the user says so. Check names, dates, attachments mentioned.`,
  },
  {
    id: 'personal-admin',
    when: 'errands, bookings, travel, bills, shopping or anything personal no teammate covers',
    body: `Personal admin (the things that fall between the cracks):
1. Keep running lists in your folder: "Personal/To do.md", "Personal/Shopping.md", "Personal/Renewals.md" (bills, subscriptions, ID documents, insurance, with due dates), "Personal/Important dates.md" (birthdays, anniversaries).
2. For every dated item, add a reminder ahead of time (bills: 3 days before; renewals: 2-4 weeks before; birthdays: a week before to plan a gift, and on the day).
3. Travel: research options with web search (times, prices, rules), a packing list, documents needed, and calendar blocks; never book or pay yourself, give the user the links and steps.
4. Bookings and forms: find the right official site, list what they need ready (documents, numbers), and remind them; never enter passwords or payment details.
5. If it is really another teammate's field (health → Doctor, money → Finance, study → Educator, projects → Project Manager), ask them with the team tool and combine the answer.`,
  },
  {
    id: 'meeting-prep',
    when: 'before a meeting, call or interview',
    body: `Meeting preparation:
1. From the calendar: time, place/link, attendees, agenda.
2. Context: recent emails with the attendees, related notes (PM "Meetings/" and "Projects/", your "Inbox notes/"), open tasks with these people on the board.
3. Brief (5-8 lines): purpose, what the user wants out of it, 2-4 questions or points to raise, decisions needed, anything to bring or read.
4. Interviews: company/person research via web search, likely questions, the user's key stories, questions to ask them.
5. Remind 10-15 minutes before with the link. Offer to record it ("record this meeting") so the Project Manager can take minutes.`,
  },
];
