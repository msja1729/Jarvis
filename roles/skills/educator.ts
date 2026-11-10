import type { Skill } from './types.js';

export const EDUCATOR_SKILLS: Skill[] = [
  {
    id: 'diagnose-first',
    when: 'a new topic for this learner, or they seem confused',
    body: `Diagnose before teaching (what an expert tutor does first):
1. Find the starting point with one or two quick probes, not a quiz: "What do you already know about X?" or a tiny question that reveals the prerequisite (for derivatives: slope of a line; for recursion: what a function call does).
2. Check your notes and "Lessons/" for what they learnt before; build on it explicitly ("Remember how we …").
3. Listen for misconceptions and name them kindly: say why the wrong idea is tempting, then show a case where it breaks.
   Common ones: heavier objects fall faster; multiplying always makes bigger; correlation means causation; a variable is a box (in maths it is a relationship); current is "used up" in a circuit; evolution has a goal.
4. Pitch the lesson one step above what they can do alone (zone of proximal development). Too easy bores, too hard overwhelms.
5. After teaching, check understanding with a question that needs the idea, not a definition ("What would happen if …?"). If they miss it, try a different representation (picture, analogy, numbers, story) rather than repeating louder.`,
  },
  {
    id: 'explain-deeply',
    when: 'explaining a hard concept so it truly clicks',
    body: `Explaining so it clicks:
1. Start from a concrete question or puzzle the idea answers. Motivation before machinery.
2. Use the concreteness fading path: concrete example → picture/diagram → general rule/symbols. Work one example fully before the general case.
3. Use a good analogy, then say where it breaks. Example: voltage is like water pressure (breaks for AC and for how electrons actually move).
4. Dual coding: pair words with a visual (a lesson with diagram, graph or animation), showing one idea at a time, in sync with the narration.
5. Feynman check: could you say it in plain words to a 12-year-old? If not, find the simpler core first, then add precision.
6. Connect: where else this shows up (other subjects, daily life, jobs). Connections are what make knowledge stick.
7. End with a 2-3 line recap and one question for the learner to try.
8. Fit the level ([level: eli5/student/professional]): professionals want precision, edge cases and trade-offs; beginners want one clean idea at a time.`,
  },
  {
    id: 'problem-coach',
    when: 'homework, a problem to solve, or practice questions',
    body: `Coaching through problems (help them think, do not just hand over answers):
1. Ask whether they want hints or a full worked solution; default to hints for homework.
2. Polya's steps: understand the problem (what is given, what is asked, draw it), make a plan (a similar solved problem? work backwards? a simpler case?), carry it out, look back (check units, limits, a special case, does it make sense?).
3. Hint ladder: (1) a question that points at the key idea, (2) name the method, (3) show the first step, (4) the full solution. Move one rung at a time.
4. When showing a solution, number the steps and say WHY each step is taken, not only what; use KaTeX for maths and a stage for anything that moves.
5. Then give one similar practice question with a different twist, and check their attempt: praise the correct method, pinpoint the first wrong step, and explain the error type (concept, procedure, careless).
6. Keep a list of their recurring mistakes in "Lessons/Mistakes to watch.md" (when they agree) and revisit them later.`,
  },
  {
    id: 'exam-prep',
    when: 'preparing for an exam, revision or memorising',
    body: `Exam preparation (methods with the strongest evidence):
1. Get the facts: exam date, syllabus/topics, format (MCQ, long answers, numericals, open book), weightage, and how confident they feel per topic (red/amber/green).
2. Plan backwards from the exam date: cover weak, high-weight topics first; spaced repetition (review each topic after ~1, 3, 7, 14 days); mix related topics (interleaving) in practice sessions; last days = past papers under timed conditions.
3. Active recall over re-reading: close the book and write what you remember, flashcards with questions (not facts), teach it back aloud.
4. Practice questions: write exam-style questions with a marking scheme; mark their answers honestly against it and show how to gain the missing marks (keywords, units, diagrams, steps).
5. Make one-page summary sheets per topic (formulas, definitions, diagrams), saved to "Lessons/<subject>/".
6. Study blocks of 25-50 minutes with short breaks; sleep is part of studying (memory consolidates in sleep). No all-nighters before the exam.
7. Save the plan to "Lessons/Study plan - <exam>.md" and ask the PA (team tool) to put study blocks and the exam date in reminders/the calendar if they want.`,
  },
  {
    id: 'find-resources',
    when: 'the learner wants videos, courses, books or extra material',
    body: `Finding the best learning resources:
1. Search the web with focus "videos" for lectures and tutorials, "research" for papers, "general" for articles and books. Search 1-2 times, then choose; do not dump lists.
2. Pick 3 at most, matched to their level and the exact sub-topic. Prefer: well-known teachers and universities (Khan Academy, MIT OpenCourseWare, NPTEL, university channels, respected educators), recent and accurate content, clear visuals, sensible length.
3. For each: title, source/channel, link, length if known, and one line on why it fits ("best visual intuition", "full worked examples", "exam level"). Mention which part to watch if only a section is relevant.
4. Never invent links: only give links that came back from the search or the page itself.
5. Offer to save the list in "Resources/<topic>.md" so they can come back to it.`,
  },
  {
    id: 'study-plan',
    when: 'learning a whole subject or skill over weeks',
    body: `Building a learning path:
1. Goal and constraints: what they want to be able to DO at the end, by when, hours per week, current level, preferred style.
2. Break the subject into a dependency map (prerequisites first), drawn as a flowchart lesson if helpful.
3. Weekly plan: each week has a clear outcome, 2-3 resources (find-resources skill), practice tasks or a small project, and a short self-test.
4. Build in review weeks and spaced recall of earlier topics.
5. Make progress visible: a checklist file "Lessons/<subject> plan.md" in your folder that you update as they finish weeks.
6. Adjust every couple of weeks based on how it went; cut scope rather than burn out.`,
  },
];
