/**
 * The welcome's opening: stars stream in and settle into a globe of dots (the same world map the app
 * shows behind everything), the team lights up around it as a small constellation of glowing nodes,
 * flows into the middle where the Jarvis ball forms, and the globe slowly unrolls into the flat,
 * drifting world map, which then stays behind every page of the setup.
 */
import { landCells, mapLayout, MAP_DOT_ALPHA } from './worldmap.js';

export interface IntroNode { label: string; color: string }

/** Seconds from the start. */
export const T = {
  formEnd: 1.9, // the globe is formed
  nodes: 1.5, // the first team node lights up (each one 0.32 s after the last)
  gather: 3.7, // the team flows into the middle; the ball starts forming
  unwrap: 4.2, // the globe starts unrolling into the map
  mapDone: 7.0, // the map is flat: the drifting background takes over
};

const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const easeIn = (x: number) => Math.pow(clamp(x), 3);
const easeInOut = (x: number) => {
  const v = clamp(x);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};
function clamp(x: number) {
  return Math.min(1, Math.max(0, x));
}
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * @param anchor where the globe sits (the middle of the Jarvis ball), in window pixels.
 * @param hooks ball: the team has gathered, start the ball; map: the map is flat, show the drifting one.
 */
export function startIntro(canvas: HTMLCanvasElement, nodes: IntroNode[], anchor: () => { x: number; y: number; r: number }, hooks: { ball(): void; map(): void; start?(): void }) {
  const g = canvas.getContext('2d')!;
  const cells = landCells();
  const dots = cells.map((c) => {
    const lon = (c.lon * Math.PI) / 180;
    const lat = (c.lat * Math.PI) / 180;
    const ang = Math.random() * Math.PI * 2;
    return {
      col: c.col,
      row: c.row,
      // on the globe (before turning)
      sx: Math.cos(lat) * Math.sin(lon),
      sy: -Math.sin(lat),
      sz: Math.cos(lat) * Math.cos(lon),
      // where it streams in from, far outside, and when
      fa: ang,
      fd: 0.45 + Math.random() * 1.1,
      delay: Math.random() * 0.6,
      // the unrolling starts at the middle of the map and spreads to the edges
      wave: Math.abs(c.col - 90) / 90,
      tw: Math.random() * 6.28,
    };
  });
  const sats = nodes.map(() => Array.from({ length: 3 }, () => ({ a: Math.random() * 6.28, r: 10 + Math.random() * 12, s: (0.4 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1) })));
  let t0 = 0; // the clock starts with the first frame actually drawn (a hidden window draws none)
  let raf = 0;
  let ballFired = false;
  let mapFired = false;
  let fade = 1; // fades the globe's dots out once the drifting map has taken over
  let stopped = false;

  /** The globe's turn: it comes to rest facing longitude 0 (the middle of the flat map) as it unrolls. */
  const spin = (t: number) => -0.42 * (T.unwrap - Math.min(t, T.unwrap));
  const TILT = 0.32;

  const frame = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    if (!t0) {
      t0 = now;
      hooks.start?.();
    }
    const t = (now - t0) / 1000;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const a = anchor();
    const R = Math.min(W, H) * 0.27;
    const L = mapLayout(W, H);
    const th = spin(t);
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const ct = Math.cos(TILT);
    const st = Math.sin(TILT);
    const far = Math.max(W, H);

    // a soft glow behind the globe while it is whole
    const whole = 1 - easeInOut((t - T.unwrap) / 1.6);
    if (whole > 0) {
      const glow = g.createRadialGradient(a.x, a.y, R * 0.2, a.x, a.y, R * 1.35);
      glow.addColorStop(0, `rgba(150,175,230,${0.1 * whole * easeIn((t - 0.9) / (T.formEnd - 0.9))})`);
      glow.addColorStop(1, 'rgba(150,175,230,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
    }

    // ---- the dots: streaming in → a turning globe → unrolled into the map ----
    for (const d of dots) {
      // on the turning, tilted globe
      const x1 = d.sx * cos + d.sz * sin;
      const z1 = -d.sx * sin + d.sz * cos;
      const y2 = d.sy * ct - z1 * st;
      const z2 = d.sy * st + z1 * ct;
      const gx = a.x + x1 * R;
      const gy = a.y + y2 * R;
      const front = (z2 + 1) / 2; // 0 at the back, 1 at the front
      // streaming in
      const k = ease((t - d.delay) / (T.formEnd - 0.75));
      let x = gx;
      let y = gy;
      if (k < 1) {
        const fx = a.x + Math.cos(d.fa) * far * d.fd;
        const fy = a.y + Math.sin(d.fa) * far * d.fd;
        x = fx + (gx - fx) * k;
        y = fy + (gy - fy) * k;
      }
      // unrolling into the flat map (the middle first, then out to the edges)
      const u = easeInOut((t - T.unwrap - d.wave * 0.7) / 2.0);
      const mx = (d.col + 0.5) * L.pitch;
      const my = L.top + (d.row + 0.5) * L.pitch;
      if (u > 0) {
        x += (mx - x) * u;
        y += (my - y) * u;
      }
      const shimmer = 0.85 + 0.15 * Math.sin(t * 2.2 + d.tw);
      const onGlobe = (0.12 + 0.78 * front * front) * shimmer * (0.25 + 0.75 * k);
      const alpha = (onGlobe + (MAP_DOT_ALPHA - onGlobe) * u) * fade;
      if (alpha < 0.01) continue;
      const size = (0.7 + 0.9 * front) * (1 - u) + L.dot * u;
      if (k < 0.98) {
        // a short streak while flying in, like stars rushing past
        const len = (1 - k) * 26;
        const dx = x - a.x;
        const dy = y - a.y;
        const n = Math.hypot(dx, dy) || 1;
        g.strokeStyle = `rgba(225,232,255,${alpha})`;
        g.lineWidth = size;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (dx / n) * len, y + (dy / n) * len);
        g.stroke();
      } else {
        g.fillStyle = front > 0.82 && u < 0.5 ? `rgba(236,240,255,${alpha})` : `rgba(255,255,255,${alpha})`;
        g.beginPath();
        g.arc(x, y, size, 0, 6.29);
        g.fill();
      }
    }

    // ---- the team: glowing nodes with their names, joined by thin lines, then flowing into the middle ----
    const gatherK = easeIn((t - T.gather) / (T.unwrap - T.gather + 0.15));
    if (gatherK < 1) {
      const pos = nodes.map((_, i) => {
        const ang = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2 + 0.55;
        const dist = R * (1.5 + 0.12 * Math.sin(i * 2.1)) * (1 - gatherK);
        const bob = Math.sin(t * 0.9 + i) * 4 * (1 - gatherK);
        return { x: a.x + Math.cos(ang) * dist * 1.25, y: a.y + Math.sin(ang) * dist * 0.95 + bob };
      });
      nodes.forEach((n, i) => {
        const on = ease((t - T.nodes - i * 0.32) / 0.7);
        if (on <= 0) return;
        const [r, gg, b] = rgb(n.color);
        const p = pos[i];
        const vis = on * (1 - gatherK);
        // a line to the globe, drawn as the node appears
        const line = ease((t - T.nodes - i * 0.32) / 0.9);
        const ex = a.x + (p.x - a.x) * 0.28;
        const ey = a.y + (p.y - a.y) * 0.28;
        g.strokeStyle = `rgba(${r},${gg},${b},${0.28 * vis})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x + (ex - p.x) * line, p.y + (ey - p.y) * line);
        g.stroke();
        // and a fainter one to the next teammate
        const q = pos[(i + 1) % nodes.length];
        const on2 = ease((t - T.nodes - (i + 1) * 0.32) / 0.7);
        if (on2 > 0 && nodes.length > 2) {
          g.strokeStyle = `rgba(255,255,255,${0.07 * Math.min(vis, on2)})`;
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(q.x, q.y);
          g.stroke();
        }
        // small dots circling it
        for (const s of sats[i]) {
          const sa = s.a + t * s.s;
          g.fillStyle = `rgba(${r},${gg},${b},${0.55 * vis})`;
          g.beginPath();
          g.arc(p.x + Math.cos(sa) * s.r, p.y + Math.sin(sa) * s.r * 0.7, 1.3, 0, 6.29);
          g.fill();
        }
        // the node: a halo, a ring and a bright core
        const pulse = 1 + 0.08 * Math.sin(t * 2.4 + i);
        const halo = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 30 * pulse);
        halo.addColorStop(0, `rgba(${r},${gg},${b},${0.55 * vis})`);
        halo.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        g.fillStyle = halo;
        g.beginPath();
        g.arc(p.x, p.y, 30 * pulse, 0, 6.29);
        g.fill();
        g.strokeStyle = `rgba(${r},${gg},${b},${0.6 * vis})`;
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(p.x, p.y, 9 * pulse * (0.6 + 0.4 * on), 0, 6.29);
        g.stroke();
        g.fillStyle = `rgba(255,255,255,${0.95 * vis})`;
        g.beginPath();
        g.arc(p.x, p.y, 3.6, 0, 6.29);
        g.fill();
        // the name, in a small glass pill under it
        const lv = vis * ease((t - T.nodes - i * 0.32 - 0.2) / 0.5);
        if (lv > 0.01) {
          g.font = '500 11px "Cascadia Mono", Consolas, ui-monospace, monospace';
          const w = g.measureText(n.label).width + 16;
          const lx = p.x - w / 2;
          const ly = p.y + 18;
          g.fillStyle = `rgba(28,30,36,${0.78 * lv})`;
          g.strokeStyle = `rgba(255,255,255,${0.12 * lv})`;
          g.beginPath();
          g.roundRect(lx, ly, w, 20, 6);
          g.fill();
          g.stroke();
          g.fillStyle = `rgba(235,238,245,${0.92 * lv})`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(n.label, p.x, ly + 10.5);
        }
      });
    }
    // the moment they meet in the middle: a soft flash where the ball is born
    const flash = Math.max(0, 1 - Math.abs(t - T.unwrap) / 0.45);
    if (flash > 0) {
      const fl = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, R * 0.9);
      fl.addColorStop(0, `rgba(225,235,255,${0.45 * flash})`);
      fl.addColorStop(1, 'rgba(225,235,255,0)');
      g.fillStyle = fl;
      g.fillRect(0, 0, W, H);
    }

    if (!ballFired && t >= T.gather) {
      ballFired = true;
      hooks.ball();
    }
    if (!mapFired && t >= T.mapDone) {
      mapFired = true;
      hooks.map();
    }
    // the drifting map has taken over: let the globe's dots go
    if (mapFired) {
      fade = Math.max(0, 1 - (t - T.mapDone) / 0.8);
      if (fade === 0) stop();
    }
  };
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
  };
  raf = requestAnimationFrame(frame);
  return {
    /** Jump to the end (a click or a key during the opening). */
    skip() {
      if (stopped) return;
      const now = performance.now();
      if (!t0 || (now - t0) / 1000 < T.mapDone) t0 = now - T.mapDone * 1000;
    },
    stop,
  };
}
