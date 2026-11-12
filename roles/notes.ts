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
  doctor: 'Write notes of this medical appointment: what the doctor found or suspects, tests ordered, medicines (name, dose, when, how long), instructions, warning signs to watch, and the follow-up date. Then set the reminders yourself: each medicine as a daily series (reminders add_series: its times, from today, for its number of days; say the dose and "after food" etc.), the follow-up visit the day before at 18:00 and two hours before, and any test to book. Add every medicine to your Profile (current medicines, with the end date). If a dose, time or length was unclear in the recording, do not guess: list it as a question for me. Point out anything I should ask about.',
  finance: 'Write notes of this conversation: figures discussed, options compared, decisions, risks, and every money task or deadline for me. Ask Maya (PA) to add the deadlines as reminders.',
};

/** The request sent to that member when the recording stops. Starts with their name so it reaches them. */
export function notesRequest(role: RoleId, name: string): string {
  const r = noteTaker(role);
  return `${name}, the recording I asked you to take has just ended. Read the latest transcript (all parts), and if the screen was recorded look at its screen pictures (view_screens: slides, whiteboard, anything shown) and write down everything important they showed: the pictures and video are deleted after your notes. ${WHAT[r]} Save the notes in your folder "${ROLE_FOLDER[r]}" (${r === 'doctor' ? 'Health notes' : 'Meetings'}/<date> <title>.md), then tell me briefly what matters most and what I need to do.`;
}
