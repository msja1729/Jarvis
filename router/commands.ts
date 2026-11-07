/** Local Command Router (T1, criterion 8): these never start a `claude` run. */

export type LocalCommand =
  | 'start_recording'
  | 'stop_recording'
  | 'open_whiteboard'
  | 'clear_whiteboard'
  | 'new_conversation'
  | 'open_tool_hub'
  | 'show_usage'
  | 'mute_voice'
  | 'unmute_voice';

const PATTERNS: [LocalCommand, RegExp][] = [
  ['start_recording', /^((start|begin) (the |a )?(meeting )?recording|record (this|the|my) (meeting|call))$/],
  ['stop_recording', /^((stop|end|finish) (the )?(meeting )?recording|stop recording (this|the) (meeting|call))$/],
  ['open_whiteboard', /^(open|show) (the )?whiteboard$/],
  ['clear_whiteboard', /^(clear|erase|wipe) (the )?whiteboard$/],
  ['new_conversation', /^(new|start (a )?new|reset( the)?) (conversation|chat)$/],
  ['open_tool_hub', /^(open|show) (the )?tool ?hub$/],
  ['show_usage', /^(show|open) (my |the )?(token )?usage$/],
  ['mute_voice', /^mute( (the )?voice)?$/],
  ['unmute_voice', /^unmute( (the )?voice)?$/],
];

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/^(hey |ok |okay )?jarvis[,:]?\s*/, '')
    .replace(/\b(please|now)\b/g, '')
    .replace(/[.!?,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact-intent matching only: anything with extra content goes to Claude. */
export function matchLocalCommand(text: string): LocalCommand | null {
  const t = normalize(text);
  for (const [cmd, re] of PATTERNS) if (re.test(t)) return cmd;
  return null;
}
