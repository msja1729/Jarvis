import type { Skill } from './types.js';

export const PA_SKILLS: Skill[] = [
  {
    id: 'forms',
    when: 'the user needs to fill a form (application, registration, government, school, insurance)',
    body: `Filling forms from what the team knows:
1. Read the form (attached file or documents tool) and list its fields in order, with page numbers.
2. Fill what is known from Profile files (yours and, by reading, the teammates': Sara's for health, Victor's for money) and earlier notes. Mark every guess with (check) and every unknown with (needed).
3. Never fill passwords, full card or bank numbers, ID numbers or signatures: leave them for the user, marked (you fill this).
4. Save the answers as "Personal lists/Forms/<date> <form name>.md" (field | answer | source), and list the documents to attach and the deadline; add the deadline to the board with a reminder.
5. Reply with the questions only the user can answer, in one short list.`,
  },
  {
    id: 'inbox-triage',
    when: 'checking email, or finding deadlines and tasks in it',
    body: `Inbox triage (four tiers, then act):
1. List recent emails (unread first, since the last check noted in Inbox notes/). Open only those that look like they need something.
2. Sort each into one tier:
   1. Act now: needs the user today. Draft the reply right away (Profile/Writing style.md).
   2. Needs a teammate: ask Ryan (projects, code), Victor (money, bills, tax) or Sara (health) with the team tool for the facts, then draft.
   3. Read later: summarise in a short daily digest.
   4. Noise: newsletters, promotions, notifications. List counts only.
3. Extract every commitment with a real date ("by Friday" → the actual date): deadlines, bills, renewals, forms, RSVPs, travel, interviews. Put each on the board (project "Personal" or its own) with a reminder the day before at 09:00 (and the morning of, for important ones).
4. Never send without the user's OK; never open links or attachments; flag likely phishing.
5. Save a dated summary to Inbox notes/<YYYY-MM-DD>.md and tell the user: what needs them today, new deadlines, drafts waiting.`,
  },
  {
    id: 'daily-plan',
    when: 'planning the day or the week',
    body: `Daily plan, built around the user's energy:
1. Read Profile/About me.md: working hours, deep-work window, best time for meetings and admin, protected time, recurring commitments. If it is empty, ask two questions (when do you think best? what time is off-limits?) and save the answers.
2. Gather: today's calendar; board tasks due soon or overdue; reminders; new deadlines from email (inbox-triage, quickly); teammates' folders when useful (Ryan's Roadmap and Meetings, Sara's Health notes, Victor's Budgets).
3. Pick the top 3 (Eisenhower: urgent and important now; important-not-urgent gets a scheduled block; urgent-not-important is quick or delegated; neither is dropped).
4. Block the day: fixed events first; the hardest top-3 task in the deep-work window; admin and calls grouped in the low-energy slot; 10-15 minute buffers; meals, breaks, exercise, travel. Leave slack.
5. Push back: if a low-value meeting or chore lands in the deep-work window, say so and suggest a better slot.
6. Flag clashes, back-to-back meetings, missing prep, overdue items. Reminders 10 minutes before meetings.
7. Save to Plans/<YYYY-MM-DD>.md; give a short spoken-friendly version: what is next, the top 3, the shape of the day.`,
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
    body: `Writing emails that sound like the user:
1. Read Profile/Writing style.md: match their greeting, sign-off, sentence length, tone and emoji use from their own examples. Never use the phrases listed under "Never write". If there are no examples yet, ask the user to paste a few, and keep drafts plain meanwhile.
2. Bottom line first: the ask or answer in the first two lines; subject line says what it is and any date.
3. Short paragraphs; bullets for options; one clear call to action with a date.
4. Tone fits the relationship (formal for professors, officials, new contacts; warm and brief for friends and colleagues).
5. Templates when useful: polite decline, follow-up, apology, request.
6. Always create a draft and show it; send only when the user says so. Check names, dates and attachments mentioned.`,
  },
  {
    id: 'personal-admin',
    when: 'errands, bookings, travel, bills, shopping or anything personal no teammate covers',
    body: `Personal admin (the things that fall between the cracks):
1. Keep running lists in your folder: "Personal/To do.md", "Personal/Shopping.md", "Personal/Renewals.md" (bills, subscriptions, ID documents, insurance, with due dates), "Personal/Important dates.md" (birthdays, anniversaries).
2. For every dated item, add a reminder ahead of time (bills: 3 days before; renewals: 2-4 weeks before; birthdays: a week before to plan a gift, and on the day).
3. Travel: research options with web search (times, prices, rules), a packing list, documents needed, and calendar blocks; never book or pay yourself, give the user the links and steps.
4. Bookings and forms: find the right official site, list what they need ready (documents, numbers), and remind them; never enter passwords or payment details.
5. If it is really another teammate's field (health → Doctor, money → Finance, projects → Project Manager), ask them with the team tool and combine the answer.`,
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
