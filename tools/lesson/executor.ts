/**
 * Lessons: checks Claude's lesson and hands it to the lesson window, which
 * narrates it step by step. Returns as soon as the lesson is on screen, so Claude
 * does not wait for the narration to finish.
 */
import type { AppExecutor, RawResult } from '../../gateway/types.js';
import { Lesson, normalizeLesson } from './spec.js';

export interface LessonBridge {
  /** Opens (or adds to) the lesson window. Returns where it was placed. */
  show(lesson: Lesson, role?: string): Promise<'left' | 'right' | 'full'>;
  /** Cuts a part out of the last screenshot: the picture, and where the asked-for part sits in it (0-1). */
  snip?(rect: { x: number; y: number; w: number; h: number }): { image: string; hl: { x: number; y: number; w: number; h: number } } | null;
}

export class LessonExecutor implements AppExecutor {
  /** How many lessons have been shown; used to tell a request opened one. */
  shown = 0;

  constructor(private readonly bridge: LessonBridge) {}

  async call(ability: string, input: Record<string, unknown>, ctx?: { role: string }): Promise<RawResult> {
    if (ability !== 'show') throw new Error(`unknown lesson ability ${ability}`);
    const { lesson, warnings } = normalizeLesson(input);
    // Screen cut-outs come from Jarvis's own copy of the last screenshot, never from Claude.
    for (const st of lesson.steps) {
      st.show = st.show.filter((b) => {
        if (b.type !== 'snip' || !b.rect) return true;
        const cut = this.bridge.snip?.(b.rect) ?? null;
        if (!cut) {
          if (warnings.length < 8) warnings.push('snip: there is no screenshot from this request to cut from');
          return false;
        }
        b.image = cut.image;
        b.hl = cut.hl;
        return true;
      });
    }
    const where = await this.bridge.show(lesson, ctx?.role);
    this.shown++;
    const place = where === 'full' ? 'full screen' : `on the ${where} side of the screen`;
    const skipped = warnings.length ? ` Skipped: ${warnings.join('; ')}.` : '';
    return {
      text: `The lesson "${lesson.title}" (${lesson.steps.length} steps) is playing ${place} and narrates itself.${skipped} Reply with one short sentence only; do not repeat the lesson.`,
    };
  }
}
