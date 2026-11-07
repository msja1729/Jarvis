/**
 * Audio capture in the renderer: microphone, and for meetings also the computer's
 * sound (Windows loopback). Everything is resampled to 16 kHz mono by the
 * AudioContext and sent to the main process as Int16 PCM. Nothing is sent to Claude.
 */
import { floatTo16, rms, SAMPLE_RATE } from '../../speech/pcm.js';

export type CaptureKind = 'meeting' | 'ptt';

interface Active {
  ctx: AudioContext;
  streams: MediaStream[];
  node: AudioWorkletNode;
  systemAudio: boolean;
}

let active: Active | null = null;

export async function startCapture(
  kind: CaptureKind,
  onChunk: (pcm: Uint8Array, level: number) => void,
): Promise<{ systemAudio: boolean }> {
  await stopCapture();
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const streams = [mic];
  let systemAudio = false;
  if (kind === 'meeting') {
    try {
      // The main process answers this with the screen's loopback audio (no picker).
      const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      display.getVideoTracks().forEach((t) => t.stop());
      if (display.getAudioTracks().length) {
        streams.push(display);
        systemAudio = true;
      }
    } catch {
      systemAudio = false; // microphone only
    }
  }

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await ctx.audioWorklet.addModule('pcm-worklet.js');
  const node = new AudioWorkletNode(ctx, 'pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
  for (const s of streams) ctx.createMediaStreamSource(s).connect(node);
  // Keep the graph running without playing anything back.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  node.port.onmessage = (ev: MessageEvent<Float32Array>) => onChunk(floatTo16(ev.data), rms(ev.data));
  active = { ctx, streams, node, systemAudio };
  return { systemAudio };
}

export async function stopCapture(): Promise<void> {
  const a = active;
  active = null;
  if (!a) return;
  a.node.port.onmessage = null;
  a.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  await a.ctx.close().catch(() => undefined);
}
