/**
 * Whiteboard tools (SPEC 6.7, criterion 24). The renderer does the drawing;
 * this executor validates Claude's steps and asks the renderer for snapshots.
 */
import type { AppExecutor, RawResult } from '../../gateway/types.js';
import { checkAttachment } from '../../gateway/image-guard.js';
import { applyToScene, describeScene, Element, normalizeSteps, Shape } from './scene.js';

export interface WhiteboardBridge {
  /** Show the whiteboard and animate these elements onto it. */
  draw(elements: Element[]): Promise<void>;
  /** PNG of the whole board (1200x700, already within the 1280 px limit). */
  snapshot(): Promise<{ pngBase64: string; userStrokes: number; userErases?: number }>;
}

export class WhiteboardExecutor implements AppExecutor {
  private scene: Element[] = [];
  private known = new Map<string, Shape>();

  constructor(private readonly bridge: WhiteboardBridge) {}

  /** Called by the "clear whiteboard" local command and the Clear button. */
  reset(): void {
    this.scene = [];
    this.known.clear();
  }

  async call(ability: string, input: Record<string, unknown>): Promise<RawResult> {
    if (ability === 'draw') {
      const { elements, warnings } = normalizeSteps(input.steps, this.known);
      if (elements.length === 0) throw new Error(`Nothing to draw. ${warnings.join('; ')}`.trim());
      for (const e of elements) this.scene = applyToScene(this.scene, e);
      await this.bridge.draw(elements);
      const note = warnings.length ? ` Skipped: ${warnings.join('; ')}.` : '';
      const erased = elements.filter((e) => e.kind === 'erase' || e.kind === 'eraseArea').length;
      const drew = elements.length - erased;
      const what = [drew ? `drew ${drew} item(s)` : '', erased ? `erased ${erased} time(s)` : ''].filter(Boolean).join(' and ');
      return { text: `${what[0].toUpperCase()}${what.slice(1)} on the whiteboard.${note}` };
    }
    if (ability === 'look') {
      const snap = await this.bridge.snapshot();
      const image = { data: snap.pngBase64, mimeType: 'image/png' };
      const problem = checkAttachment(image);
      if (problem) throw new Error(problem);
      const erases = snap.userErases ? ` and used the eraser ${snap.userErases} time(s)` : '';
      const user = snap.userStrokes > 0 ? `The user drew ${snap.userStrokes} pen stroke(s)${erases}.` : 'The user has not drawn anything.';
      return { text: `${describeScene(this.scene)} ${user}`, images: [image] };
    }
    throw new Error(`unknown whiteboard ability ${ability}`);
  }
}
