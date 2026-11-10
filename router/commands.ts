/** Local Command Router (T1, criterion 8): these never start a `claude` run. */

export type LocalCommand =
  | 'start_recording'
  | 'stop_recording'
  | 'new_conversation'
  | 'open_tool_hub'
  | 'mute_voice'
  | 'unmute_voice';

const EVENT = '(?:meeting|call|lecture|class|appointment|session|interview)';
/** "… and take notes", "… and note down the tasks given to me". */
const NOTES = `(?: and (?:take|write|make|keep|note)(?: down)?(?: the| some| all| my)?(?: (?:important|key|main))? (?:notes|minutes|points|action items|tasks)(?: (?:given|assigned) to me)?)?`;
const PATTERNS: [LocalCommand, RegExp][] = [
  [
    'start_recording',
    new RegExp(
      `^(?:(?:(?:start|begin) (?:the |a )?(?:${EVENT} )?recording|record (?:this|the|my) ${EVENT})${NOTES}|(?:take|write|make|keep) (?:down )?(?:the |some )?(?:(?:important|key|main) )?(?:notes|minutes|points) (?:of|for|in|during) this ${EVENT})$`,
    ),
  ],
  ['stop_recording', new RegExp(`^((stop|end|finish) (the )?(${EVENT} )?recording|stop recording (this|the) ${EVENT}|the ${EVENT} (is over|has ended|ended))$`)],
  ['new_conversation', /^(new|start (a )?new|reset( the)?) (conversation|chat)$/],
  ['open_tool_hub', /^(open|show) (the )?tool ?hub$/],
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
