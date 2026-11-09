import type { AppDef } from '../../gateway/types.js';
import { BLOCK_TYPES, CHART_KINDS, COLOR_NAMES, LIMITS, NOTE_TONES, PARTS, PLACEMENTS, SHAPES } from './spec.js';

const num = { type: 'number' };
const range = { type: 'array', items: num, minItems: 2, maxItems: 2 };

export const LESSON_APP: AppDef = {
  id: 'lesson',
  name: 'Lessons',
  description: 'Jarvis teaches you anything with a narrated, step-by-step lesson: diagrams, flowcharts, graphs, animations, equations and notes, beside what you are watching or full screen.',
  kind: 'builtin',
  defaultEnabled: true,
  abilities: [
    {
      name: 'show',
      title: 'Show a lesson',
      description:
        'Teach with a narrated lesson in its own window: each step\'s "say" is spoken (plain friendly sentences, no symbols) while its visuals appear. ' +
        'Visuals: diagram (Mermaid) for processes and architecture, plot for functions (animate t), chart for data, scene+animate for motion, math, table, code. ' +
        'When explaining a screen, PDF or code, cite it: quote the exact words or code with source ("p. 4", "src/db.ts:12-30"), and snip the part of the screenshot you mean. ' +
        'For maths, teach visually: open with a concrete question and a picture, build intuition on a stage before any formula, let the formula emerge, ' +
        'give each quantity one colour in pictures and equations (\\blue{x}, \\orange{...}), move things continuously (play: set a parameter, apply a matrix, zoom), ' +
        'transform equations step by step (math tex as a list), and leave sliders or draggable points so the student can explore.',
      group: 'write',
      // Only opens Jarvis's own lesson window, so no confirmation is needed.
      defaultSetting: 'allowed',
      progress: 'Preparing your lesson',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          placement: { type: 'string', enum: [...PLACEMENTS], description: 'auto: an empty side of the screen, else full screen' },
          append: { type: 'boolean', description: 'add these steps to the open lesson (follow-up questions)' },
          steps: {
            type: 'array',
            maxItems: LIMITS.steps,
            items: {
              type: 'object',
              properties: {
                say: { type: 'string', description: 'spoken narration: 1-3 warm, natural sentences; no symbols or markdown' },
                clear: { type: 'boolean', description: 'start a fresh page' },
                part: { type: 'string', enum: [...PARTS], description: 'for problems and deep topics only: go problem, intuition, solution, recap in order' },
                focus: { type: 'string', description: 'id of a visual to highlight' },
                show: {
                  type: 'array',
                  maxItems: LIMITS.blocksPerStep,
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', enum: [...BLOCK_TYPES] },
                      id: { type: 'string' },
                      title: { type: 'string' },
                      text: { type: 'string', description: 'heading/text/note/quote; **bold**, $inline LaTeX$. quote: exact words from the source' },
                      source: { type: 'string', description: 'where it is from, e.g. "p. 3", "src/auth.ts:40-58", "your screen"; shown and listed under References' },
                      lang: { type: 'string', description: 'code: language' },
                      line: { type: 'number', description: 'code: first line number' },
                      marks: { type: 'array', items: num, description: 'code: line numbers to highlight' },
                      tone: { type: 'string', enum: [...NOTE_TONES] },
                      items: { type: 'array', items: { type: 'string' }, description: 'bullets' },
                      tex: { description: 'math: display LaTeX, or a list of LaTeX steps that transform one into the next' },
                      code: { type: 'string', description: 'diagram: Mermaid (flowchart TD/LR, sequenceDiagram, stateDiagram-v2, mindmap, timeline, classDiagram, erDiagram); code: the exact code' },
                      chart: { type: 'string', enum: [...CHART_KINDS] },
                      labels: { type: 'array', items: { type: 'string' }, description: 'chart x categories' },
                      series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: num }, points: { type: 'array', items: range } } } },
                      xLabel: { type: 'string' },
                      yLabel: { type: 'string' },
                      fns: {
                        type: 'array',
                        items: { type: 'object', properties: { expr: { type: 'string' }, label: { type: 'string' } } },
                        description: 'plot: y=f(x,t) like "sin(x-t)", "x^2-2x"; + - * / ^ sin cos tan sqrt exp ln log abs pi e',
                      },
                      x: { description: 'plot/stage: x range [min,max]; snip: left px' },
                      y: { description: 'plot/stage: y range [min,max]; snip: top px' },
                      t: { ...range, description: 'plot: animate t over this range, looping' },
                      points: { type: 'array', items: { type: 'object', properties: { x: num, y: num, label: { type: 'string' } } }, description: 'plot: marked points' },
                      w: num,
                      h: num,
                      // snip uses x, y, w, h: a rectangle in the last screenshot's pixels
                      shapes: {
                        type: 'array',
                        description: `scene (default 800x450): ${SHAPES.join('|')} with id,x,y,w,h,r,x2,y2,d,text,size,color,fill,opacity,rotate`,
                        items: { type: 'object' },
                      },
                      target: { type: 'string', description: 'animate: scene id; play: stage id' },
                      params: {
                        type: 'array',
                        description: 'stage: sliders, [{name, min, max, value, step, label (LaTeX)}]; usable in expressions',
                        items: { type: 'object' },
                      },
                      basis: { type: 'boolean', description: 'stage: show basis vectors i-hat, j-hat' },
                      grid: { type: 'boolean' },
                      objects: {
                        type: 'array',
                        description:
                          'stage objects, each {id, kind, color, tex (label)}: function {expr in x and params}; parametric {xt, yt, range}; vector {to, from}; point {at, drag:{x:param,y:param}}; ' +
                          'line|segment {from, to}; tangent {of: function id, a}; area {of, a, b}; riemann {of, a, b, n}; circle {center, r}; polygon {points, fill}; label {at, tex}. ' +
                          'Coordinates are numbers or expressions of params, e.g. at:["a","a^2"]',
                        items: { type: 'object' },
                      },
                      actions: {
                        type: 'array',
                        description:
                          'stage/play actions in order: {do:create, ids}, {do:set, param, to, seconds}, {do:matrix, m:[[a,b],[c,d]]}, {do:highlight|fade|show, ids}, {do:zoom, x:[..], y:[..]}, {do:wait, seconds}',
                        items: { type: 'object' },
                      },
                      changes: { type: 'array', items: { type: 'object' }, description: 'animate: [{id, x,y,w,h,r,x2,y2,opacity,rotate,color,fill,text}] new values' },
                      seconds: num,
                      repeat: { type: 'string', enum: ['none', 'loop', 'bounce'] },
                      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'table: first row is the header' },
                    },
                    required: ['type'],
                  },
                },
              },
              required: ['say'],
            },
          },
        },
        required: ['title', 'steps'],
        description: `colors: ${COLOR_NAMES.join(', ')}`,
      },
    },
  ],
};
