/**
 * Background world map: a dotted map of the whole world drifting slowly sideways
 * in an endless loop, with softly pulsing city lights and travelling "connections".
 * The map is drawn once to an offscreen tile; each frame only slides that tile.
 */
import { LAND_ROWS, MAP_COLS, MAP_LAT_BOTTOM, MAP_LAT_TOP, MAP_ROWS } from './worldmap-data.js';

type LonLat = [number, number];

const CITIES: LonLat[] = [
  [-122.4, 37.8], // San Francisco
  [-74.0, 40.7], // New York
  [-46.6, -23.5], // São Paulo
  [-0.1, 51.5], // London
  [8.5, 47.4], // Zurich
  [3.4, 6.5], // Lagos
  [55.3, 25.2], // Dubai
  [72.8, 19.1], // Mumbai
  [77.6, 13.0], // Bengaluru
  [103.8, 1.35], // Singapore
  [139.7, 35.7], // Tokyo
  [151.2, -33.9], // Sydney
];
/** Pairs of CITIES indexes joined by a moving light. */
const LINKS: [number, number][] = [
  [1, 3],
  [3, 8],
  [8, 10],
  [0, 10],
  [4, 6],
  [2, 5],
  [9, 11],
];

const SECONDS_PER_LOOP = 180; // one full trip around the world
const FPS = 30;

function landBits(): boolean[][] {
  return LAND_ROWS.map((hex) => {
    const bits = BigInt(`0x${hex}`).toString(2).padStart(MAP_COLS, '0');
    return [...bits].map((b) => b === '1');
  });
}

export function startWorldMap(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const land = landBits();
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tile: HTMLCanvasElement | null = null;
  let tileW = 0;
  let tileH = 0;
  let top = 0;
  let dpr = 1;
  let start = performance.now();
  let last = 0;
  let drawnStill = false;

  const project = ([lon, lat]: LonLat) => ({
    x: ((lon + 180) / 360) * tileW,
    y: ((MAP_LAT_TOP - lat) / (MAP_LAT_TOP - MAP_LAT_BOTTOM)) * tileH,
  });

  function build() {
    dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // The whole world fits: as wide as the window, or as tall as most of it.
    const pitch = Math.max(3, Math.min(W / MAP_COLS, (H * 0.86) / MAP_ROWS));
    tileW = pitch * MAP_COLS;
    tileH = pitch * MAP_ROWS;
    top = (H - tileH) * 0.56;
    tile = document.createElement('canvas');
    tile.width = Math.round(tileW * dpr);
    tile.height = Math.round(tileH * dpr);
    const t = tile.getContext('2d')!;
    t.scale(dpr, dpr);
    const r = Math.max(0.7, pitch * 0.24);
    t.fillStyle = 'rgba(255,255,255,0.11)';
    for (let y = 0; y < MAP_ROWS; y++) {
      for (let x = 0; x < MAP_COLS; x++) {
        if (!land[y][x]) continue;
        t.beginPath();
        t.arc((x + 0.5) * pitch, (y + 0.5) * pitch, r, 0, Math.PI * 2);
        t.fill();
      }
    }
  }

  function drawCities(offsetX: number, time: number) {
    CITIES.forEach((c, i) => {
      const p = project(c);
      const pulse = 0.5 + 0.5 * Math.sin(time * 1.6 + i * 1.7);
      const x = offsetX + p.x;
      const y = top + p.y;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 10 + pulse * 8);
      g.addColorStop(0, `rgba(255,255,255,${0.22 + pulse * 0.22})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawLinks(offsetX: number, time: number) {
    LINKS.forEach(([a, b], i) => {
      const p = project(CITIES[a]);
      const q = project(CITIES[b]);
      const x1 = offsetX + p.x;
      const y1 = top + p.y;
      const x2 = offsetX + q.x;
      const y2 = top + q.y;
      const cx = (x1 + x2) / 2;
      const cy = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.22;
      ctx.strokeStyle = 'rgba(255,255,255,0.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.stroke();
      // a light travelling along the arc
      const k = ((time * 0.12 + i * 0.37) % 1 + 1) % 1;
      const mx = (1 - k) * (1 - k) * x1 + 2 * (1 - k) * k * cx + k * k * x2;
      const my = (1 - k) * (1 - k) * y1 + 2 * (1 - k) * k * cy + k * k * y2;
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 7);
      g.addColorStop(0, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mx, my, 7, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    if (document.hidden || !tile) return;
    if (still ? drawnStill : now - last < 1000 / FPS) return;
    last = now;
    const time = still ? 0 : (now - start) / 1000;
    const shift = still ? 0 : ((time / SECONDS_PER_LOOP) * tileW) % tileW;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let x = -shift; x < canvas.clientWidth; x += tileW) {
      ctx.drawImage(tile, x, top, tileW, tileH);
      drawLinks(x, time);
      drawCities(x, time);
    }
    drawnStill = true; // with reduced motion, one frame is enough
  }

  build();
  window.addEventListener('resize', () => {
    build();
    last = 0;
    drawnStill = false;
  });
  start = performance.now();
  requestAnimationFrame(frame);
}
