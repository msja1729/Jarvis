/**
 * Who takes notes when a recording ends, and how. A plain "record this meeting" goes to the
 * Project Manager (meeting minutes); a member asked by name writes notes in their own field.
 */
import { RoleId } from './roles.js';
import { ROLE_FOLDER } from './folders.js';

/** The member who takes notes for a recording someone asked for. Jarvis hands it to the Project Manager. */
export const noteTaker = (asked: RoleId): RoleId => (asked === 'jarvis' ? 'pm' : asked);

const WHAT: Record<RoleId, string> = {
  jarvis: '',
  pm: 'Use your meeting-minutes skill: key points, decisions, action items with owners and due dates, and open questions. Put every task given to me on the board with its due date and a reminder the day before.',
  pa: 'Write meeting notes: key points, decisions, and every task, deadline or appointment that involves me. Put my tasks on the board with due dates and add reminders.',
  educator: 'Write study notes of this lecture or class: main ideas in order, definitions, formulas, worked examples, things the teacher stressed (likely exam points), homework or deadlines, and 3 questions to test myself. Ask Maya (PA) to add any homework or exam dates as reminders.',
  doctor: 'Write notes of this medical appointment: what the doctor found or suspects, tests ordered, medicines (name, dose, how long), instructions, warning signs to watch, and the follow-up date. Ask Maya (PA) to add follow-ups and medicine reminders. Point out anything I should ask about.',
  finance: 'Write notes of this conversation: figures discussed, options compared, decisions, risks, and every money task or deadline for me. Ask Maya (PA) to add the deadlines as reminders.',
};

/** The request sent to that member when the recording stops. Starts with their name so it reaches them. */
export function notesRequest(role: RoleId, name: string): string {
  const r = noteTaker(role);
  return `${name}, the recording I asked you to take has just ended. Read the latest transcript (all parts). ${WHAT[r]} Save the notes in your folder "${ROLE_FOLDER[r]}" (${r === 'educator' ? 'Lessons' : r === 'doctor' ? 'Health notes' : 'Meetings'}/<date> <title>.md), then tell me briefly what matters most and what I need to do.`;
}
