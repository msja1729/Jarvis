/** Floating "REC" / "Listening" badge. Text comes from the main process. */
interface IndicatorState {
  mode: 'rec' | 'ptt' | 'listen';
  state: 'recording' | 'listening' | 'transcribing' | 'message';
  label: string;
  sub?: string;
  seconds?: number;
  level?: number;
  action?: string | null;
}

const api = (window as unknown as {
  jarvis: { onIndicator(cb: (s: IndicatorState) => void): void; indicatorAction(mode: string): void };
}).jarvis;

const $ = (id: string) => document.getElementById(id)!;
let mode = new URLSearchParams(location.search).get('mode') ?? 'rec';

function clock(sec: number) {
  const s = Math.floor(sec);
  const p = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}

api.onIndicator((s) => {
  mode = s.mode;
  $('dot').className = `dot ${s.state === 'listening' ? 'listen' : s.state === 'transcribing' ? 'busy' : s.state === 'message' ? 'off' : ''}`;
  $('label').textContent = s.label;
  $('time').textContent = s.seconds !== undefined ? clock(s.seconds) : '';
  $('sub').textContent = s.sub ?? '';
  $('sub').classList.toggle('hidden', s.state === 'listening');
  $('meter').classList.toggle('hidden', s.state !== 'listening');
  ($('level') as HTMLElement).style.width = `${Math.min(100, Math.round((s.level ?? 0) * 900))}%`;
  $('action').textContent = s.action ?? '';
  $('action').classList.toggle('hidden', !s.action);
});

$('action').addEventListener('click', () => api.indicatorAction(mode));

export {};
