/**
 * First-run welcome, in the main window:
 *   title card → your name → connect Claude → tools & microphone → voices → meet the team.
 * The last part is a little show: Maya (the PA) says hello, then each team member introduces
 * themselves in their own natural voice while their orb glows with what they say.
 */
import { speakAndWait, speechLevel, stopSpeaking, wordsSpoken } from '../../speech/tts.js';
import { startIntro, T as INTRO } from './intro.js';
import { startWorldMap } from './worldmap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const jb = () => (window as any).jarvis;

type Step = 'title' | 'name' | 'claude' | 'tools' | 'voices' | 'meet';
interface Card { id: string; person: string; name: string; title: string; color: string; skills: string[]; model: string | null }
interface Tool { id: string; name: string; description: string; enabled: boolean }
interface State {
  onboarded: boolean;
  userName: string;
  platform: string;
  claude: 'install' | 'login' | 'ready';
  voice: { installed: boolean; downloadBytes?: number };
  speech: { ready: boolean; engine?: boolean; model?: boolean; downloadBytes?: number; device?: string };
  mic: string;
  tools: Tool[];
  cards: Card[];
}

const STEPS: Step[] = ['name', 'claude', 'tools', 'voices'];
const JARVIS_COLOR = '#dfe6ee';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k in n) (n as any)[k] = v;
    else n.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const icon = (d: string) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = d;
  return s;
};
const TOOL_ICON: Record<string, string> = {
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  lesson: '<path d="M3 6l9-3 9 3-9 3z"/><path d="M7 8v5c0 1.7 2.2 3 5 3s5-1.3 5-3V8"/>',
  documents: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  recorder: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  reminders: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
  coding: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
};

/* ---------- animated backdrop: drifting stars that lean toward the speaker's colour ---------- */
class Backdrop {
  private ctx: CanvasRenderingContext2D;
  private stars: { x: number; y: number; z: number; tw: number }[] = [];
  private raf = 0;
  tint = JARVIS_COLOR;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 160; i++) this.stars.push({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8, tw: Math.random() * 6.28 });
    const loop = (t: number) => {
      this.draw(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  private draw(t: number) {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== c.clientWidth * dpr || c.height !== c.clientHeight * dpr) {
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
    }
    const g = this.ctx;
    g.clearRect(0, 0, c.width, c.height);
    for (const s of this.stars) {
      s.y -= 0.00006 * s.z;
      if (s.y < 0) s.y = 1;
      const a = 0.18 + 0.4 * s.z * (0.6 + 0.4 * Math.sin(t / 900 + s.tw));
      g.fillStyle = s.z > 0.85 ? this.tint : `rgba(255,255,255,${a})`;
      g.globalAlpha = s.z > 0.85 ? a : 1;
      g.beginPath();
      g.arc(s.x * c.width, s.y * c.height, s.z * 1.4 * dpr, 0, 6.29);
      g.fill();
      g.globalAlpha = 1;
    }
  }
  stop() {
    cancelAnimationFrame(this.raf);
  }
}

/* ---------- the speaking orb: a glowing sphere whose rings follow the voice ---------- */
class Orb {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private level = 0;
  private color = [223, 230, 238];
  private target = [223, 230, 238];
  /** Speaking with the OS voice (no level available): breathe instead. */
  fake = false;
  speaking = false;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const loop = (t: number) => {
      this.draw(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  setColor(hex: string) {
    const n = parseInt(hex.slice(1), 16);
    this.target = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  private draw(t: number) {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const size = c.clientWidth * dpr;
    if (c.width !== size || c.height !== size) {
      c.width = size;
      c.height = size;
    }
    for (let i = 0; i < 3; i++) this.color[i] += (this.target[i] - this.color[i]) * 0.06;
    const real = speechLevel();
    const want = real > 0 ? real : this.speaking && this.fake ? 0.25 + 0.2 * Math.sin(t / 140) * Math.sin(t / 370) : 0;
    this.level += (want - this.level) * 0.25;
    const [r, gg, b] = this.color.map(Math.round);
    const g = this.ctx;
    const cx = size / 2;
    const base = size * 0.2;
    g.clearRect(0, 0, size, size);
    // halo
    const halo = g.createRadialGradient(cx, cx, base * 0.6, cx, cx, size / 2);
    halo.addColorStop(0, `rgba(${r},${gg},${b},${0.22 + this.level * 0.35})`);
    halo.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = halo;
    g.fillRect(0, 0, size, size);
    // rings that ripple with the voice
    for (let i = 0; i < 3; i++) {
      const wob = Math.sin(t / (600 + i * 170) + i) * 0.04;
      const rad = base * (1.28 + i * 0.26 + this.level * (0.35 + i * 0.12) + wob);
      g.strokeStyle = `rgba(${r},${gg},${b},${0.32 - i * 0.08 + this.level * 0.25})`;
      g.lineWidth = (1.6 - i * 0.3) * dpr;
      g.beginPath();
      const start = t / (1400 + i * 500) + i * 2;
      g.arc(cx, cx, rad, start, start + Math.PI * (1.25 + 0.3 * i));
      g.stroke();
    }
    // the sphere
    const s = base * (1 + this.level * 0.12);
    const body = g.createRadialGradient(cx - s * 0.35, cx - s * 0.4, s * 0.05, cx, cx, s);
    body.addColorStop(0, 'rgba(255,255,255,0.98)');
    body.addColorStop(0.35, `rgba(${Math.min(255, r + 60)},${Math.min(255, gg + 60)},${Math.min(255, b + 60)},0.95)`);
    body.addColorStop(1, `rgba(${r},${gg},${b},0.85)`);
    g.shadowColor = `rgba(${r},${gg},${b},0.9)`;
    g.shadowBlur = (24 + this.level * 40) * dpr;
    g.fillStyle = body;
    g.beginPath();
    g.arc(cx, cx, s, 0, 6.29);
    g.fill();
    g.shadowBlur = 0;
  }
  stop() {
    cancelAnimationFrame(this.raf);
  }
}

/* ---------- the title card: particles gather into the Jarvis ring, then the name appears ---------- */
function titleLogo(canvas: HTMLCanvasElement): { stop(): void; skip(): void } {
  const g = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const N = 220;
  const pts = Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2;
    return { a, sx: Math.random(), sy: Math.random(), d: Math.random() * 0.6, j: (Math.random() - 0.5) * 0.06 };
  });
  let t0 = performance.now();
  let raf = 0;
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const loop = (now: number) => {
    const size = canvas.clientWidth * dpr;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const t = (now - t0) / 1000;
    const cx = size / 2;
    const R = size * 0.34;
    g.clearRect(0, 0, size, size);
    // particles fly in and gather on the ring, then melt into one smooth, continuous circle
    const solid = ease((t - 1.35) / 0.7);
    if (solid < 1) {
      for (const p of pts) {
        const k = ease((t - p.d * 0.8) / 1.6);
        const wobble = p.j * (1 - k); // they line up exactly as they arrive
        const tx = cx + Math.cos(p.a + t * 0.25) * R * (1 + wobble);
        const ty = cx + Math.sin(p.a + t * 0.25) * R * (1 + wobble);
        const x = p.sx * size + (tx - p.sx * size) * k;
        const y = p.sy * size + (ty - p.sy * size) * k;
        g.fillStyle = `rgba(255,255,255,${0.85 * (0.3 + 0.7 * k) * (1 - solid)})`;
        g.beginPath();
        g.arc(x, y, (1.1 + k * 0.6) * dpr, 0, 6.29);
        g.fill();
      }
    }
    if (solid > 0) {
      g.save();
      g.lineWidth = 2 * dpr;
      g.shadowColor = `rgba(200,215,255,${0.75 * solid})`;
      g.shadowBlur = 14 * dpr;
      g.strokeStyle = `rgba(255,255,255,${0.92 * solid})`;
      g.beginPath();
      g.arc(cx, cx, R, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    // Jarvis's logo inside it: rings that draw themselves in, then keep turning, each at its own speed and way
    const spinRing = (rad: number, from: number, len: number, width: number, alpha: number, appear: number) => {
      const k = ease((t - appear) / 0.9);
      if (k <= 0) return;
      g.save();
      g.lineWidth = width * dpr;
      g.lineCap = 'round';
      g.shadowColor = `rgba(200,215,255,${0.6 * k})`;
      g.shadowBlur = 8 * dpr;
      g.strokeStyle = `rgba(255,255,255,${alpha * k})`;
      g.beginPath();
      g.arc(cx, cx, rad, from, from + len * k);
      g.stroke();
      g.restore();
    };
    // the app's own mark: an open ring with a quarter missing, turning slowly
    spinRing(R * 0.8, t * 0.55, Math.PI * 1.5, 1.8, 0.85, 1.45);
    // a fine dotted ring turning the other way
    const dotted = ease((t - 1.65) / 0.9);
    if (dotted > 0) {
      const n = 60;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - t * 0.32;
        g.fillStyle = `rgba(225,232,255,${(0.35 + 0.35 * (i % 3 === 0 ? 1 : 0)) * dotted})`;
        g.beginPath();
        g.arc(cx + Math.cos(a) * R * 0.66, cx + Math.sin(a) * R * 0.66, (i % 3 === 0 ? 1.5 : 0.9) * dpr, 0, 6.29);
        g.fill();
      }
    }
    // two short arcs, quicker, close to the core
    spinRing(R * 0.53, t * 0.95 + 0.6, Math.PI * 0.42, 1.4, 0.7, 1.85);
    spinRing(R * 0.53, t * 0.95 + 0.6 + Math.PI, Math.PI * 0.42, 1.4, 0.7, 1.85);
    // the core blooms once the ring has formed
    const bloom = ease((t - 1.7) / 1.2);
    if (bloom > 0) {
      const r = R * 0.3 * bloom * (1 + 0.04 * Math.sin(t * 2.2));
      const glow = g.createRadialGradient(cx, cx, 0, cx, cx, r * 3.2);
      glow.addColorStop(0, `rgba(210,225,255,${0.5 * bloom})`);
      glow.addColorStop(1, 'rgba(210,225,255,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, size, size);
      const core = g.createRadialGradient(cx - r * 0.3, cx - r * 0.35, r * 0.05, cx, cx, r);
      core.addColorStop(0, '#ffffff');
      core.addColorStop(1, 'rgba(170,190,230,0.9)');
      g.fillStyle = core;
      g.beginPath();
      g.arc(cx, cx, r, 0, 6.29);
      g.fill();
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return {
    stop: () => cancelAnimationFrame(raf),
    skip: () => {
      if (performance.now() - t0 < 3000) t0 = performance.now() - 3000;
    },
  };
}

export class Onboarding {
  private root: HTMLElement;
  private stage: HTMLElement;
  private dots: HTMLElement;
  private backdrop: Backdrop;
  /** The drifting world map behind every page (the opening unrolls into it). */
  private mapCanvas: HTMLCanvasElement;
  private sky: HTMLCanvasElement;
  private stopMap: (() => void) | null = null;
  private stopIntro: (() => void) | null = null;
  private st!: State;
  private cleanups: (() => void)[] = [];
  private poll = 0;
  /** Changes when the user skips or leaves a scene, so running animations stop. */
  private run = 0;
  private muted = false;

  constructor(private readonly onDone: () => void) {
    this.root = document.getElementById('onboard')!;
    this.root.replaceChildren();
    const bg = h('canvas', { className: 'ob-bg' });
    this.mapCanvas = h('canvas', { className: 'ob-map' });
    this.sky = h('canvas', { className: 'ob-sky' });
    this.stage = h('div', { className: 'ob-stage' });
    this.dots = h('div', { className: 'ob-dots' });
    this.root.append(bg, this.mapCanvas, this.sky, this.stage, this.dots);
    this.backdrop = new Backdrop(bg);
  }

  /** Start at the beginning, or only at one step (e.g. Claude needs signing in again). */
  async start(from: Step = 'title', only = false) {
    this.st = await jb().onboardState();
    this.root.classList.remove('hidden', 'leaving');
    document.body.classList.add('onboarding');
    this.only = only;
    this.current = null;
    if (from !== 'title') this.showMap(false); // straight to a later page: the map is already there
    void this.go(from);
  }
  private only = false;

  private next(from: Step) {
    if (this.only) return this.close();
    const order: Step[] = ['title', ...STEPS, 'meet'];
    return this.go(order[order.indexOf(from) + 1]);
  }

  /** The scene being shown or on its way in; a second click while it changes is ignored. */
  private current: Step | null = null;

  private async go(step: Step) {
    if (this.current === step && step !== 'meet') return;
    this.current = step;
    this.run++;
    const run = this.run;
    for (const c of this.cleanups.splice(0)) c();
    window.clearInterval(this.poll);
    stopSpeaking();
    const i = STEPS.indexOf(step);
    this.dots.replaceChildren(...(i >= 0 && !this.only ? STEPS.map((_, k) => h('i', { className: k < i ? 'done' : k === i ? 'on' : '' })) : []));
    const old = this.stage.firstElementChild as HTMLElement | null;
    if (old) {
      old.classList.add('out');
      await wait(240);
      if (run !== this.run) return; // another step was chosen meanwhile
    }
    this.stage.dataset.step = step; // a page can be wider (the tools page lays its cards out four across)
    const scene = this[step]();
    scene.classList.add('ob-scene', `ob-${step}`);
    this.stage.replaceChildren(scene);
    // two frames: the scene is laid out first, so its entrance always animates; then the window may be shown
    requestAnimationFrame(() => requestAnimationFrame(() => scene.classList.add('in')));
    // the welcome is in place: the window may be shown (its first frame is this page, nothing else)
    setTimeout(() => jb().welcomePainted?.(), 0);
  }

  /** The drifting map appears (it fades in over the opening's last frame, so the hand-over is invisible). */
  private showMap(fade = true) {
    if (!this.stopMap) this.stopMap = startWorldMap(this.mapCanvas);
    this.mapCanvas.classList.toggle('quick', !fade);
    this.mapCanvas.classList.add('on');
  }

  private close() {
    this.current = null;
    this.run++;
    for (const c of this.cleanups.splice(0)) c();
    window.clearInterval(this.poll);
    stopSpeaking();
    this.root.classList.add('leaving');
    setTimeout(() => {
      this.root.classList.add('hidden');
      document.body.classList.remove('onboarding');
      this.backdrop.stop();
      this.stopIntro?.();
      this.stopMap?.();
      this.stopMap = null;
    }, 700);
    this.onDone();
  }

  /* ---------- 1. title card: the opening ---------- */
  private title(): HTMLElement {
    const logo = h('canvas', { className: 'ob-logo' });
    const letters = (cls: string) => h('h1', { className: cls, 'aria-hidden': cls.includes('shine') ? 'true' : 'false' }, ...'JARVIS'.split('').map((ch, k) => h('span', { style: `--k:${k}` }, ch)));
    const word = h('div', { className: 'ob-wordwrap' }, letters('ob-word'), letters('ob-word shine'));
    const cta = h('button', { className: 'ob-cta', type: 'button', onclick: () => this.next('title') }, 'Let’s set you up', h('span', { className: 'ob-arrow' }, '→'));
    const scene = h('section', {}, logo, word, h('p', { className: 'ob-tag' }, 'Your own team of AI experts, right on your desktop.'), h('div', { className: 'ob-cta-wrap' }, cta), h('p', { className: 'ob-skip' }, 'Click anywhere to skip'));

    let ball: { stop(): void; skip(): void } | null = null;
    const startBall = () => {
      if (ball) return;
      ball = titleLogo(logo);
      this.cleanups.push(() => ball?.stop());
    };
    // the team as the opening's constellation (Maya, Ryan, Sara, Victor)
    const nodes = this.st.cards.filter((c) => c.id !== 'jarvis').map((c) => ({ label: `${c.person} · ${c.title}`, color: c.color }));
    const intro = startIntro(
      this.sky,
      nodes,
      () => {
        const r = logo.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
      },
      { ball: startBall, map: () => this.showMap(true), start: () => scene.classList.add('go') },
    );
    this.stopIntro = intro.stop;
    // a click or a key during the opening jumps to its end
    const skip = (e: Event) => {
      if (scene.classList.contains('skip') || (e.target as HTMLElement).closest?.('.ob-cta')) return;
      scene.classList.add('skip', 'go');
      intro.skip();
      startBall();
      ball?.skip();
    };
    this.root.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    this.cleanups.push(() => {
      this.root.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    });
    // once it has played, the hint goes
    const done = window.setTimeout(() => scene.classList.add('played'), (INTRO.mapDone + 0.6) * 1000);
    this.cleanups.push(() => window.clearTimeout(done));
    return scene;
  }

  /* ---------- 2. name ---------- */
  private name(): HTMLElement {
    const input = h('input', { className: 'ob-name-input', placeholder: 'Type your name', maxLength: 30, value: this.st.userName, autocomplete: 'given-name', spellcheck: false });
    const err = h('p', { className: 'ob-err' });
    const hello = h('p', { className: 'ob-hello' });
    const cont = h('button', { className: 'ob-cta', type: 'button' }, 'Continue', h('span', { className: 'ob-arrow' }, '→'));
    // a warm hello that follows what you type
    const greet = () => {
      const v = input.value.trim().split(/\s+/)[0] ?? '';
      hello.classList.toggle('show', v.length > 0);
      if (v) hello.replaceChildren('Nice to meet you, ', h('b', {}, v), '.');
      field.classList.toggle('filled', input.value.trim().length > 0);
    };
    const go = async () => {
      try {
        await jb().onboardSetName(input.value);
        this.st.userName = input.value.trim();
        void this.next('name');
      } catch (e) {
        err.textContent = String(e).replace(/^Error.*?: /, '');
      }
    };
    cont.addEventListener('click', () => void go());
    input.addEventListener('input', () => {
      err.textContent = '';
      greet();
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && void go());
    const field = h('label', { className: 'ob-field' }, h('span', { className: 'ob-field-glow' }), input);
    const orb = h('canvas', { className: 'ob-mini-orb' });
    const o = new Orb(orb);
    this.cleanups.push(() => o.stop());
    setTimeout(() => {
      input.focus();
      greet();
    }, 450);
    return h(
      'section',
      {},
      orb,
      h('p', { className: 'ob-kicker' }, 'Step 1 of 4'),
      h('h2', {}, 'What should we call you?'),
      h('p', { className: 'ob-sub' }, 'Your team will use it when they talk to you. You can change it any time.'),
      field,
      hello,
      err,
      h('div', { className: 'ob-row' }, h('button', { className: 'ob-ghost', type: 'button', onclick: () => void this.next('name') }, 'Skip'), cont),
    );
  }

  /* ---------- 3. connect Claude ---------- */
  private claude(): HTMLElement {
    const rowInstall = this.checkRow('Claude Code installed', 'Jarvis thinks with Claude Code, on your own Claude plan.');
    const rowLogin = this.checkRow('Signed in to your Claude plan', 'You sign in in your browser. Jarvis never sees or keeps your login.');
    const action = h('button', { className: 'ob-cta', type: 'button' });
    const help = h('p', { className: 'ob-help' });
    const cont = h('button', { className: 'ob-cta', type: 'button', disabled: true, onclick: () => void this.next('claude') }, 'Continue', h('span', { className: 'ob-arrow' }, '→'));
    const run = this.run;
    const refresh = async () => {
      const s = await jb().setupCheck();
      if (run !== this.run) return;
      this.st.claude = s.step;
      rowInstall.set(s.step === 'install' ? 'todo' : 'ok');
      rowLogin.set(s.step === 'ready' ? 'ok' : s.step === 'login' ? 'todo' : 'wait');
      action.classList.toggle('hidden', s.step === 'ready');
      help.classList.toggle('ok', s.step === 'ready');
      cont.disabled = s.step !== 'ready';
      if (s.step === 'install') {
        action.replaceChildren('Install Claude Code');
        action.onclick = () => void jb().onboardInstallClaude();
        help.textContent = 'A terminal window opens and installs it (about a minute). Come back here when it says it is done; this page checks by itself.';
      } else if (s.step === 'login') {
        action.replaceChildren('Sign in to Claude');
        action.onclick = () => void jb().onboardLoginClaude();
        help.textContent = 'A terminal window opens; finish signing in in your browser (Claude Pro or Max). This page notices when you are done.';
      } else {
        help.textContent = 'All set. Jarvis is connected to your Claude plan.';
        void jb().onboardPrepareIntros(); // Claude writes the team's introductions meanwhile
      }
    };
    void refresh();
    this.poll = window.setInterval(() => void refresh(), 3000);
    return h(
      'section',
      {},
      h('p', { className: 'ob-kicker' }, 'Step 2 of 4'),
      h('h2', {}, 'Connect your Claude'),
      h('p', { className: 'ob-sub' }, 'Your team runs on Claude Code with your Claude Pro or Max plan. No API keys, no extra bills.'),
      h('div', { className: 'ob-card ob-checks' }, rowInstall.el, rowLogin.el),
      help,
      h('div', { className: 'ob-row' }, action, cont),
    );
  }

  private checkRow(title: string, sub: string) {
    const mark = h('span', { className: 'ob-mark wait' });
    const el = h('div', { className: 'ob-check' }, mark, h('div', {}, h('b', {}, title), h('span', { className: 'ob-sub small' }, sub)));
    return { el, set: (s: 'ok' | 'todo' | 'wait') => (mark.className = `ob-mark ${s}`) };
  }

  /* ---------- 4. tools and the microphone ---------- */
  private tools(): HTMLElement {
    const grid = h('div', { className: 'ob-toolgrid' });
    for (const t of this.st.tools) {
      const sw = h('input', { type: 'checkbox', className: 'switch', checked: t.enabled });
      sw.addEventListener('change', () => void jb().hubSetEnabled(t.id, sw.checked));
      grid.append(h('label', { className: 'ob-tool' }, h('span', { className: 'ob-tool-ico' }, icon(TOOL_ICON[t.id] ?? TOOL_ICON.web)), h('span', { className: 'ob-tool-txt' }, h('b', {}, t.name), h('span', {}, shortDesc(t))), sw));
    }
    // the microphone needs nothing here; only if the system blocks it, say so (with the way to fix it)
    const micBlocked =
      this.st.mic === 'denied'
        ? h('div', { className: 'ob-card ob-mic' }, h('span', { className: 'ob-tool-ico' }, icon(TOOL_ICON.recorder)), h('span', { className: 'ob-tool-txt' }, h('b', {}, 'Microphone access is blocked'), h('span', {}, 'Allow it in your system settings so you can talk to your team.')), h('button', { className: 'ob-ghost', type: 'button', onclick: () => void jb().onboardMicSettings() }, 'Open settings'))
        : null;
    return h(
      'section',
      {},
      h('p', { className: 'ob-kicker' }, 'Step 3 of 4'),
      h('h2', {}, 'Pick your team’s tools'),
      h('p', { className: 'ob-sub' }, 'Turn on what you want them to use. Anything that acts for you still asks you first; you can change all of this in the Tool Hub.'),
      micBlocked,
      grid,
      h('p', { className: 'ob-note' }, 'Email, calendar and other apps (Gmail, Google Calendar, Microsoft 365, Notion, Spotify…) come from your Claude account: connect them any time in the Tool Hub.'),
      h('div', { className: 'ob-row' }, h('button', { className: 'ob-cta', type: 'button', onclick: () => void this.next('tools') }, 'Continue', h('span', { className: 'ob-arrow' }, '→'))),
    );
  }

  /* ---------- 5. voices ---------- */
  private voices(): HTMLElement {
    const voiceBar = this.bar('Natural voices', 'Real, human-sounding voices for your whole team (about 326 MB, once).', this.st.voice.installed);
    const earMb = Math.round((this.st.speech.downloadBytes ?? 0) / 1e6);
    const earSub = `So your team understands you, even when you talk fast or casually${this.st.speech.device === 'gpu' ? ', using your graphics card' : ''}${earMb ? ` (about ${earMb.toLocaleString()} MB, once)` : ''}.`;
    const earBar = this.bar('Speech recognition', earSub, this.st.speech.ready);
    const get = h('button', { className: 'ob-cta', type: 'button' }, 'Download both');
    const skip = h('button', { className: 'ob-ghost', type: 'button', onclick: () => void this.next('voices') }, 'Skip for now');
    const meet = h('button', { className: 'ob-cta ob-meetbtn', type: 'button', onclick: () => void this.next('voices') }, 'Meet your team', h('span', { className: 'ob-arrow' }, '→'));
    const allDone = () => this.st.voice.installed && this.st.speech.ready;
    const sync = () => {
      get.classList.toggle('hidden', allDone());
      skip.classList.toggle('hidden', allDone());
      meet.classList.toggle('hidden', !allDone());
    };
    const run = this.run;
    jb().onTtsProgress((p: { label: string; fraction: number }) => run === this.run && voiceBar.progress(p.fraction, p.label));
    jb().onSpeechProgress((p: { label?: string; fraction?: number }) => run === this.run && earBar.progress(p.fraction ?? 0, p.label ?? ''));
    get.addEventListener('click', async () => {
      get.disabled = true;
      skip.replaceChildren('Continue without waiting');
      const jobs: Promise<unknown>[] = [];
      if (!this.st.voice.installed)
        jobs.push(
          jb()
            .ttsInstall()
            .then(() => {
              this.st.voice.installed = true;
              voiceBar.done();
            })
            .catch((e: unknown) => voiceBar.fail(String(e))),
        );
      if (!this.st.speech.ready)
        jobs.push(
          jb()
            .speechInstall()
            .then(() => {
              this.st.speech.ready = true;
              earBar.done();
            })
            .catch((e: unknown) => earBar.fail(String(e))),
        );
      await Promise.all(jobs);
      get.disabled = false;
      if (run === this.run) sync();
    });
    sync();
    return h(
      'section',
      {},
      h('p', { className: 'ob-kicker' }, 'Step 4 of 4'),
      h('h2', {}, 'Give your team their voices'),
      h('p', { className: 'ob-sub' }, 'Everything runs on this computer: what you say and what they say never leaves it for speech.'),
      h('div', { className: 'ob-card' }, voiceBar.el, earBar.el),
      this.st.userName ? sayMyName(this.st.userName) : null,
      h('div', { className: 'ob-row' }, skip, get, meet),
    );
  }

  private bar(title: string, sub: string, done: boolean) {
    const fill = h('i');
    const pct = h('span', { className: 'ob-pct' }, done ? 'Ready' : '');
    const el = h('div', { className: `ob-dl${done ? ' ok' : ''}` }, h('div', { className: 'ob-dl-top' }, h('b', {}, title), pct), h('span', { className: 'ob-sub small' }, sub), h('span', { className: 'ob-track' }, fill));
    if (done) fill.style.transform = 'scaleX(1)';
    return {
      el,
      progress: (f: number, label: string) => {
        fill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, f))})`;
        pct.textContent = f > 0 && f < 1 ? `${Math.round(f * 100)}%` : label.slice(0, 40);
      },
      done: () => {
        fill.style.transform = 'scaleX(1)';
        pct.textContent = 'Ready';
        el.classList.add('ok');
      },
      fail: (msg: string) => {
        pct.textContent = 'Failed';
        el.classList.add('bad');
        el.title = msg;
      },
    };
  }

  /* ---------- 6. meet the team ---------- */
  private meet(): HTMLElement {
    const run = this.run;
    const orbCanvas = h('canvas', { className: 'ob-orb' });
    const orb = new Orb(orbCanvas);
    this.cleanups.push(() => orb.stop());
    const who = h('div', { className: 'ob-who' });
    const chips = h('div', { className: 'ob-chips' });
    const caption = h('p', { className: 'ob-caption' });
    const roster = h('div', { className: 'ob-roster' });
    const end = h('div', { className: 'ob-row ob-end hidden' });
    const muteBtn = h('button', { className: 'ob-ghost small', type: 'button' }, this.muted ? 'Sound on' : 'Mute');
    muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      muteBtn.replaceChildren(this.muted ? 'Sound on' : 'Mute');
      if (this.muted) stopSpeaking();
    });
    const top = h('div', { className: 'ob-top' }, muteBtn, h('button', { className: 'ob-ghost small', type: 'button', onclick: () => this.finish() }, 'Skip intro'));
    const scene = h('section', {}, top, h('div', { className: 'ob-spot' }, orbCanvas, who), chips, caption, roster, end);

    const setWho = (name: string, title: string, color: string) => {
      who.classList.remove('show');
      setTimeout(() => {
        who.replaceChildren(h('b', {}, name), h('span', {}, title));
        who.style.setProperty('--c', color);
        who.classList.add('show');
      }, 220);
      orb.setColor(color);
      this.backdrop.tint = color;
      scene.style.setProperty('--c', color);
    };

    /** Shows the words as they are being said, then waits for the voice to finish. */
    const say = async (text: string, voice: string) => {
      if (run !== this.run) return;
      const words = text.split(/\s+/);
      caption.replaceChildren(...words.map((w) => h('span', {}, `${w} `)));
      caption.classList.add('show');
      const spans = [...caption.children] as HTMLElement[];
      let shown = 0;
      const reveal = (n: number) => {
        for (; shown < Math.min(n, spans.length); shown++) spans[shown].classList.add('on');
      };
      // each word appears as it is said: the voice reports how far it has got (the natural voice by the
      // audio actually playing, the OS voice word by word); muted, the words come at a speaking pace
      const started = performance.now();
      let synced = false;
      let pace = 0;
      const timer = window.setInterval(() => {
        const said = wordsSpoken();
        if (said !== null) {
          synced = true;
          if (said > 0) reveal(Math.floor(said) + 1);
          return;
        }
        if (synced) return; // between two pieces of the voice: keep what has been said
        const noTiming = this.muted || (!this.st.voice.installed && performance.now() - started > 2500);
        if (!noTiming) return;
        pace ||= performance.now();
        reveal(Math.floor(((performance.now() - pace) / 1000) * 2.6) + 1);
      }, 40);
      if (this.muted) await wait(words.length * 370 + 600);
      else {
        orb.speaking = true;
        orb.fake = !this.st.voice.installed;
        await speakAndWait(text, { voice }, words.length * 900 + 4000);
        orb.speaking = false;
      }
      window.clearInterval(timer);
      reveal(spans.length);
      await wait(350);
    };

    void (async () => {
      caption.replaceChildren(h('span', { className: 'on ob-thinking' }, 'Getting everyone together…'));
      const { intros, cards, voices } = await jb().onboardIntros();
      if (run !== this.run) return;
      // Maya, the PA, hosts the welcome
      const host = (cards as Card[]).find((c) => c.id === 'pa') ?? (cards as Card[])[0];
      setWho(host.person, `${host.name} · ${host.title}`, host.color);
      await wait(500);
      await say(intros.hello, voices.pa);
      if (run !== this.run) return;
      // the roster arrives
      setWho('Your team', 'Four experts, on your computer', JARVIS_COLOR);
      caption.classList.remove('show');
      const slots = new Map<string, HTMLElement>();
      (cards as Card[]).forEach((c, k) => {
        const slot = h('div', { className: 'ob-member', style: { animationDelay: `${k * 0.12}s` } }, h('i', {}), h('b', {}, c.person), h('span', {}, c.name));
        slot.style.setProperty('--c', c.color);
        slots.set(c.id, slot);
        roster.append(slot);
      });
      roster.classList.add('show');
      await wait(1300);
      for (const c of cards as Card[]) {
        if (run !== this.run) return;
        const slot = slots.get(c.id)!;
        roster.querySelectorAll('.ob-member').forEach((m) => m.classList.toggle('dim', m !== slot && !m.classList.contains('done')));
        slot.classList.add('live');
        setWho(c.person, `${c.name} · ${c.title}${c.model ? ` · ${c.model}` : ''}`, c.color);
        chips.replaceChildren(...c.skills.map((s, k) => h('span', { style: { animationDelay: `${0.25 + k * 0.08}s` } }, s)));
        chips.style.setProperty('--c', c.color);
        chips.classList.remove('show');
        void chips.offsetWidth;
        chips.classList.add('show');
        await say(intros.members[c.id], voices[c.id]);
        slot.classList.remove('live');
        slot.classList.add('done');
      }
      if (run !== this.run) return;
      chips.classList.remove('show');
      roster.querySelectorAll('.ob-member').forEach((m) => m.classList.remove('dim'));
      roster.classList.add('all');
      setWho(host.person, 'and your team', host.color);
      scene.classList.add('ob-finale');
      await say(intros.outro, voices.pa);
      if (run !== this.run) return;
      end.replaceChildren(
        h('button', { className: 'ob-ghost', type: 'button', onclick: () => void this.go('meet') }, 'Replay'),
        h('button', { className: 'ob-cta', type: 'button', onclick: () => this.finish() }, 'Start chatting', h('span', { className: 'ob-arrow' }, '→')),
      );
      end.classList.remove('hidden');
    })();
    return scene;
  }

  private finish() {
    void jb().onboardFinish();
    this.close();
  }
}

/**
 * "How should we say your name?": a spelling the English voice reads the right way.
 * Claude suggests one; the user can play it, change it and play it again.
 * Exported so Settings can show the same control.
 */
export function sayMyName(name: string, opts: { compact?: boolean } = {}): HTMLElement {
  const field = h('input', { className: 'ob-sayas', placeholder: 'e.g. Pree-yaan-kaa', maxLength: 60, autocomplete: 'off', spellcheck: false });
  const note = h('span', { className: 'ob-sub small' }, 'Type how it sounds, syllable by syllable, then press “Hear it”.');
  const play = h('button', { className: 'ob-ghost small', type: 'button' }, '▶  Hear it');
  const save = async () => {
    const v = field.value.trim();
    try {
      await jb().nameSetSayAs(v);
      note.textContent = v ? `Saved. Your team will say “${v}”.` : `Saved. Your team will read “${name}” as written.`;
    } catch (e) {
      note.textContent = String(e).replace(/^Error.*?: /, '');
    }
  };
  play.addEventListener('click', async () => {
    await save();
    play.disabled = true;
    await speakAndWait(`Hi ${field.value.trim() || name}! Nice to meet you.`, {}, 15_000);
    play.disabled = false;
  });
  field.addEventListener('change', () => void save());
  field.addEventListener('keydown', (e) => e.key === 'Enter' && play.click());
  void jb()
    .nameGet()
    .then((r: { sayAs: string }) => {
      if (r.sayAs) {
        field.value = r.sayAs;
        note.textContent = 'Press “Hear it” to check. Not quite right? Change the spelling and listen again.';
      }
    });
  return h(
    'div',
    { className: `ob-card ob-name-say${opts.compact ? ' compact' : ''}` },
    h('div', { className: 'ob-dl-top' }, h('b', {}, `How should we say “${name}”?`)),
    h('div', { className: 'ob-say-row' }, field, play),
    note,
  );
}

function shortDesc(t: Tool): string {
  const own: Record<string, string> = {
    web: 'Look things up on trusted sites, find videos.',
    lesson: 'Diagrams, animations and visual maths.',
    documents: 'Read PDFs, files and codebases you pick.',
    recorder: 'Record meetings; get the notes and your tasks.',
    screen: 'Look at your screen, only when you ask.',
    reminders: 'Reminders, said out loud on time.',
    board: 'A shared board of tasks and deadlines.',
    coding: 'Let Ryan run Claude Code on your projects.',
  };
  return own[t.id] ?? t.description;
}
