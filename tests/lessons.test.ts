/** Lessons: narrated, animated explanations (diagrams, graphs, scenes) beside the user's screen. */
import { describe, expect, it } from 'vitest';
import { compile } from '../tools/lesson/expr.js';
import { normalizeLesson } from '../tools/lesson/spec.js';
import { chooseSide, bgraToGray } from '../tools/lesson/placement.js';
import { LESSON_APP } from '../tools/lesson/definition.js';
import { LessonExecutor } from '../tools/lesson/executor.js';
import { defaultSetting } from '../gateway/settings.js';
import { BUILTIN_APPS } from '../app/apps.js';
import { JARVIS_SYSTEM_PROMPT, wordCount } from '../brain/system-prompt.js';
import { modelFor } from '../router/model.js';

describe('graph expressions', () => {
  it('understand normal maths, including implicit multiplication and powers', () => {
    expect(compile('2x^2 + 3x - 1')(2, 0)).toBe(13);
    expect(compile('y = sin(x - t)')(Math.PI / 2, 0)).toBeCloseTo(1);
    expect(compile('-x^2')(3, 0)).toBe(-9); // minus applies after the power
    expect(compile('2^-1')(0, 0)).toBe(0.5);
    expect(compile('3(x+1)')(1, 0)).toBe(6);
    expect(compile('e^(ln(5))')(0, 0)).toBeCloseTo(5);
    expect(compile('max(x, 2) + abs(-3) + pi')(1, 0)).toBeCloseTo(5 + Math.PI);
    expect(compile('xt')(2, 3)).toBe(6);
  });

  it('refuse anything that is not maths, so nothing from Claude runs as code', () => {
    for (const bad of ['alert(1)', 'x; process.exit()', 'constructor', 'x => x', '"x"', 'this', '', 'sin(x', 'x +']) {
      expect(() => compile(bad), bad).toThrow();
    }
    expect(() => compile('x'.repeat(300))).toThrow(/too long/);
  });
});

describe('lesson checking', () => {
  it('keeps good steps and visuals, drops broken ones with a reason', () => {
    const { lesson, warnings } = normalizeLesson({
      title: 'How a heart pumps',
      steps: [
        { say: 'Think of your heart as two pumps side by side.', show: [{ type: 'heading', text: 'The heart' }, { type: 'diagram', code: 'flowchart LR\n A[Body] --> B[Right side] --> C[Lungs]' }] },
        { say: 'Here is the pressure over one beat.', show: [{ type: 'plot', fns: [{ expr: 'sin(x - t)' }, { expr: 'import(x)' }], x: [0, 6.28], t: [0, 6.28] }] },
        { say: 'Blood moves like this.', show: [{ type: 'scene', id: 's', shapes: [{ shape: 'circle', id: 'cell', x: 50, y: 50, r: 10, color: 'red' }, { shape: 'path', d: 'M0 0 L10 10' }, { shape: 'path', d: '<script>' }] }, { type: 'animate', target: 's', changes: [{ id: 'cell', x: 700 }], repeat: 'loop' }] },
        { say: '', show: [] }, // empty: dropped
        { say: 'Compare them.', show: [{ type: 'table', rows: [['Side', 'Goes to'], ['Right', 'Lungs']] }, { type: 'video', src: 'x' }] },
      ],
    });
    expect(lesson.steps).toHaveLength(4);
    expect(lesson.placement).toBe('auto');
    expect(lesson.steps[1].show[0].fns).toEqual([{ expr: 'sin(x - t)', label: undefined }]);
    expect(lesson.steps[2].show[0].shapes).toHaveLength(2); // the "<script>" path was refused
    expect(lesson.steps[2].show[1].repeat).toBe('loop');
    expect(warnings.join(' ')).toMatch(/import\(x\)/);
    expect(warnings.join(' ')).toMatch(/video/);
  });

  it('follows the four parts: problem, intuition, solution, recap', () => {
    const { lesson } = normalizeLesson({
      title: 'Why the sky is blue',
      steps: [
        { say: 'Why is the sky blue and not white?' }, // no part: starts with the problem
        { say: 'Think of sunlight as a crowd of colours.', part: 'intuition' },
        { say: 'Blue bounces around the most.' }, // no part: continues the intuition
        { say: 'Here is the maths of scattering.', part: 'solution' },
        { say: 'So, to sum up.', part: 'recap' },
        { say: 'Odd part name.', part: 'appendix' }, // unknown: continues the recap
      ],
    });
    expect(lesson.steps.map((s) => s.part)).toEqual(['problem', 'intuition', 'intuition', 'solution', 'recap', 'recap']);
    expect(LESSON_APP.abilities[0].inputSchema.properties).toBeDefined();
    expect(JSON.stringify(LESSON_APP.abilities[0].inputSchema)).toMatch(/problem.*intuition.*solution.*recap/);
    expect(JARVIS_SYSTEM_PROMPT).toMatch(/problem.*intuition.*solution.*recap/s);
  });

  it('short explanations can skip the four parts', () => {
    const { lesson } = normalizeLesson({ title: 'Seasons', steps: [{ say: 'Earth is tilted.' }, { say: 'So sunlight hits us at different angles.' }] });
    expect(lesson.steps.map((s) => s.part)).toEqual([undefined, undefined]);
    expect(JARVIS_SYSTEM_PROMPT).toMatch(/Simple fact or quick question: just answer/);
  });

  it('rejects a lesson with nothing to show', () => {
    expect(() => normalizeLesson({ title: 'x', steps: [] })).toThrow(/no usable steps/);
  });

  it('caps very long lessons', () => {
    const steps = Array.from({ length: 80 }, (_, i) => ({ say: `Step ${i}.` }));
    expect(normalizeLesson({ title: 'long', steps }).lesson.steps.length).toBe(30);
  });
});

/** A fake screen: 100x60 grey picture, with "content" (stripes = text lines) in some columns. */
function screenWith(busy: (x: number) => boolean): Uint8Array {
  const w = 100;
  const h = 60;
  const g = new Uint8Array(w * h).fill(30);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (busy(x) && y % 3 === 0) g[y * w + x] = 220;
  return g;
}

describe('finding an empty side of the screen', () => {
  it('opens on the empty right side when the content is on the left', () => {
    expect(chooseSide(screenWith((x) => x < 50), 100, 60).choice).toBe('right');
  });
  it('opens on the empty left side when the content is on the right', () => {
    expect(chooseSide(screenWith((x) => x > 50), 100, 60).choice).toBe('left');
  });
  it('goes full screen when the whole screen is busy', () => {
    expect(chooseSide(screenWith(() => true), 100, 60).choice).toBe('full');
  });
  it('prefers the right on an empty screen', () => {
    expect(chooseSide(screenWith(() => false), 100, 60).choice).toBe('right');
  });
  it('converts a screen picture to grey', () => {
    expect([...bgraToGray(Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1)]).toEqual([0, 255]);
  });
});

describe('the Lessons app', () => {
  it('is a default feature: on out of the box, no popup needed', () => {
    expect(BUILTIN_APPS.some((a) => a.id === 'lesson')).toBe(true);
    expect(LESSON_APP.defaultEnabled).toBe(true);
    expect(defaultSetting(LESSON_APP.abilities[0])).toBe('allowed');
  });

  it('returns at once (the lesson narrates itself) and tells Claude to keep the reply short', async () => {
    let got: unknown = null;
    const exec = new LessonExecutor({ show: async (l) => ((got = l), 'right') });
    const r = await exec.call('show', { title: 'Fractions', steps: [{ say: 'A fraction is a part of a whole.' }] });
    expect(got).not.toBeNull();
    expect(exec.shown).toBe(1);
    expect(r.text).toMatch(/right side/);
    expect(r.text).toMatch(/one short sentence/);
  });

  it('Claude is told to teach with lessons, and explanations use the stronger model', () => {
    expect(JARVIS_SYSTEM_PROMPT).toMatch(/lesson tool/);
    expect(wordCount(JARVIS_SYSTEM_PROMPT)).toBeLessThan(500);
    expect(modelFor('doctor')).toBe('sonnet');
  });
});

describe('visual maths stages', () => {
  it('expressions can use slider parameters, including multi-letter names', () => {
    expect(compile('a*x^2 + k', ['a', 'k'])(2, 0, { a: 3, k: 1 })).toBe(13);
    expect(compile('ax', ['a'])(2, 0, { a: 5 })).toBe(10); // a·x
    expect(compile('cos(theta)', ['theta'])(0, 0, { theta: Math.PI })).toBeCloseTo(-1);
    expect(() => compile('b*x', ['a'])).toThrow(/unknown name/); // undeclared names are refused
    expect(compile('constructor + 1', ['constructor'])(0, 0, {})).toBe(1); // reads only slider values, never built-in properties
  });

  it('keeps a valid stage: sliders, draggable point, tangent, matrix and parameter animations', () => {
    const { lesson, warnings } = normalizeLesson({
      title: 'What a derivative is',
      steps: [
        {
          say: 'Watch the tangent line as the point slides along the curve.',
          show: [
            {
              type: 'stage',
              id: 'plane',
              x: [-4, 4],
              y: [-1, 9],
              params: [{ name: 'a', min: -3, max: 3, value: -2, label: 'a' }, { name: 'bad name!' }],
              objects: [
                { id: 'f', kind: 'function', expr: 'x^2', color: 'blue', tex: 'f(x)=x^2' },
                { id: 'p', kind: 'point', at: ['a', 'a^2'], drag: { x: 'a' } },
                { id: 'tan', kind: 'tangent', of: 'f', a: 'a', color: 'yellow' },
                { id: 'oops', kind: 'tangent', of: 'nothing', a: 1 },
                { id: 'g', kind: 'function', expr: 'evil()' },
              ],
              actions: [{ do: 'create', ids: ['f'] }, { do: 'create', ids: ['p', 'tan'] }, { do: 'set', param: 'a', to: 2, seconds: 3 }, { do: 'explode' }],
            },
          ],
        },
        { say: 'Now bend the whole plane.', show: [{ type: 'play', target: 'plane', actions: [{ do: 'matrix', m: [[1, 1], [0, 1]] }] }] },
        { say: 'Expand it.', show: [{ type: 'math', tex: ['(x+1)^2', 'x^2+2x+1'] }] },
      ],
    });
    const stage = lesson.steps[0].show[0].stage!;
    expect(stage.params.map((p) => p.name)).toEqual(['a']);
    expect(stage.objects.map((o) => o.id)).toEqual(['f', 'p', 'tan']);
    expect(stage.objects[1].drag).toEqual({ x: 'a', y: undefined });
    expect(stage.actions.map((a) => a.do)).toEqual(['create', 'create', 'set']);
    expect(lesson.steps[1].show[0].actions![0].m).toEqual([[1, 1], [0, 1]]);
    expect(lesson.steps[2].show[0].texSteps).toEqual(['(x+1)^2', 'x^2+2x+1']);
    const w = warnings.join(' | ');
    expect(w).toMatch(/must be the id of a function/);
    expect(w).toMatch(/evil/);
    expect(w).toMatch(/explode/);
  });
});
