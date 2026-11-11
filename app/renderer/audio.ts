/**
 * Capture in the renderer.
 *  - Push-to-talk: the microphone.
 *  - Meetings: the microphone and the computer's own sound (Windows loopback), and, unless turned off,
 *    the screen: a video file of the screen with all the sound, plus a picture each time the screen
 *    changes and then holds still (a new slide, writing on a board), so the team can see what was shown.
 * For transcription, sound is resampled to 16 kHz mono and sent to the main process as Int16 PCM.
 * Nothing is sent to Claude from here.
 */
import { floatTo16, rms, SAMPLE_RATE } from '../../speech/pcm.js';
import { ScreenChanges } from './screen-changes.js';

export type CaptureKind = 'meeting' | 'ptt';

export interface MeetingSinks {
  /** A piece of the video file (in order). */
  video(chunk: Uint8Array, mimeType: string): void;
  /** A picture of the screen after it changed (JPEG). */
  frame(jpeg: Uint8Array): void;
}

interface Active {
  ctx: AudioContext;
  streams: MediaStream[];
  node: AudioWorkletNode;
  systemAudio: boolean;
  mixCtx?: AudioContext;
  recorder?: MediaRecorder;
  recorderDone?: Promise<void>;
  watcher?: ScreenChanges;
}

let active: Active | null = null;

/** The best video format this computer can record: MP4 (H.264) plays everywhere; WebM otherwise. */
export function pickVideoType(supported: (t: string) => boolean): string | null {
  const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return types.find((t) => supported(t)) ?? null;
}

export async function startCapture(
  kind: CaptureKind,
  onChunk: (pcm: Uint8Array, level: number) => void,
  meeting?: { screen: boolean; sinks: MeetingSinks },
): Promise<{ systemAudio: boolean; screen: boolean }> {
  await stopCapture();
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const streams = [mic];
  let systemAudio = false;
  let display: MediaStream | null = null;
  if (kind === 'meeting') {
    try {
      // The main process answers this with the screen and its loopback audio (no picker).
      // full HD (slides and small text stay readable); never more, to keep files reasonable
      display = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 15, max: 30 } },
      });
      if (!meeting?.screen) display.getVideoTracks().forEach((t) => t.stop());
      streams.push(display); // stopped with the rest at the end
      systemAudio = display.getAudioTracks().length > 0;
    } catch {
      systemAudio = false; // microphone only
    }
  }

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await ctx.audioWorklet.addModule('pcm-worklet.js');
  const node = new AudioWorkletNode(ctx, 'pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
  for (const s of streams) if (s.getAudioTracks().length) ctx.createMediaStreamSource(s).connect(node);
  // Keep the graph running without playing anything back.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  node.port.onmessage = (ev: MessageEvent<Float32Array>) => onChunk(floatTo16(ev.data), rms(ev.data));
  active = { ctx, streams, node, systemAudio };

  const videoTrack = display?.getVideoTracks()[0];
  let screen = false;
  if (kind === 'meeting' && meeting?.screen && videoTrack && videoTrack.readyState === 'live') {
    screen = startScreen(videoTrack, mic, display!, meeting.sinks);
  }
  return { systemAudio, screen };
}

/** The video file (screen + mic + computer sound, full quality) and the pictures of what was shown. */
function startScreen(videoTrack: MediaStreamTrack, mic: MediaStream, display: MediaStream, sinks: MeetingSinks): boolean {
  const a = active!;
  const type = pickVideoType((t) => MediaRecorder.isTypeSupported(t));
  if (!type) return false;
  // mix the microphone and the computer's sound at full quality for the video
  const mixCtx = new AudioContext({ sampleRate: 48_000 });
  const dest = mixCtx.createMediaStreamDestination();
  mixCtx.createMediaStreamSource(mic).connect(dest);
  if (display.getAudioTracks().length) mixCtx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
  const recorder = new MediaRecorder(new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]), {
    mimeType: type,
    videoBitsPerSecond: 1_800_000, // sharp enough to read slides; about 14 MB a minute
    audioBitsPerSecond: 128_000,
  });
  // chunks are written in order: each waits for the one before it
  let chain = Promise.resolve();
  recorder.ondataavailable = (ev) => {
    if (!ev.data.size) return;
    const blob = ev.data;
    chain = chain.then(async () => sinks.video(new Uint8Array(await blob.arrayBuffer()), type));
  };
  a.recorderDone = new Promise<void>((resolve) => {
    recorder.onstop = () => void chain.then(resolve);
  });
  recorder.start(5000);
  a.mixCtx = mixCtx;
  a.recorder = recorder;
  a.watcher = new ScreenChanges(videoTrack, (jpeg) => sinks.frame(jpeg));
  a.watcher.start();
  return true;
}

export async function stopCapture(): Promise<void> {
  const a = active;
  active = null;
  if (!a) return;
  a.node.port.onmessage = null;
  a.watcher?.stop();
  if (a.recorder && a.recorder.state !== 'inactive') {
    a.recorder.stop();
    await Promise.race([a.recorderDone, new Promise((r) => setTimeout(r, 8000))]);
  }
  a.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  await a.ctx.close().catch(() => undefined);
  await a.mixCtx?.close().catch(() => undefined);
}
