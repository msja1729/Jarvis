/**
 * Kokoro-82M (Apache-2.0) model files, pinned to one repository revision and
 * checked with SHA-256 after download. Voices ship inside the kokoro-js package.
 */
export const KOKORO_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const KOKORO_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';

export const KOKORO_FILES: { path: string; bytes: number; sha256: string }[] = [
  { path: 'config.json', bytes: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
  { path: 'tokenizer.json', bytes: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
  { path: 'tokenizer_config.json', bytes: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' },
  // Full precision. The 8-bit model is ~5x slower on x86 CPUs, and the fp16 model produces broken
  // (NaN) audio for some voices, which sounded like speech cutting off. fp32 is clean and as fast.
  { path: 'onnx/model.onnx', bytes: 325532232, sha256: '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb' },
];

/** Which of the model files above the engine loads. */
export const KOKORO_DTYPE = 'fp32';

export const kokoroUrl = (file: string) => `https://huggingface.co/${KOKORO_REPO}/resolve/${KOKORO_REVISION}/${file}`;

export interface VoiceInfo {
  id: string;
  name: string;
  accent: 'British' | 'American';
  gender: 'Female' | 'Male';
  /** Kokoro's own quality grade for the voice. */
  grade: string;
}

/** Best voices first within each group; grades come from the Kokoro voice list. */
export const VOICES: VoiceInfo[] = [
  { id: 'bm_george', name: 'George', accent: 'British', gender: 'Male', grade: 'C' },
  { id: 'bm_fable', name: 'Fable', accent: 'British', gender: 'Male', grade: 'C' },
  { id: 'bm_lewis', name: 'Lewis', accent: 'British', gender: 'Male', grade: 'D+' },
  { id: 'bm_daniel', name: 'Daniel', accent: 'British', gender: 'Male', grade: 'D' },
  { id: 'bf_emma', name: 'Emma', accent: 'British', gender: 'Female', grade: 'B-' },
  { id: 'bf_isabella', name: 'Isabella', accent: 'British', gender: 'Female', grade: 'C' },
  { id: 'bf_alice', name: 'Alice', accent: 'British', gender: 'Female', grade: 'D' },
  { id: 'bf_lily', name: 'Lily', accent: 'British', gender: 'Female', grade: 'D' },
  { id: 'am_fenrir', name: 'Fenrir', accent: 'American', gender: 'Male', grade: 'C+' },
  { id: 'am_michael', name: 'Michael', accent: 'American', gender: 'Male', grade: 'C+' },
  { id: 'am_puck', name: 'Puck', accent: 'American', gender: 'Male', grade: 'C+' },
  { id: 'am_echo', name: 'Echo', accent: 'American', gender: 'Male', grade: 'D' },
  { id: 'am_eric', name: 'Eric', accent: 'American', gender: 'Male', grade: 'D' },
  { id: 'am_liam', name: 'Liam', accent: 'American', gender: 'Male', grade: 'D' },
  { id: 'am_onyx', name: 'Onyx', accent: 'American', gender: 'Male', grade: 'D' },
  { id: 'af_heart', name: 'Heart', accent: 'American', gender: 'Female', grade: 'A' },
  { id: 'af_bella', name: 'Bella', accent: 'American', gender: 'Female', grade: 'A-' },
  { id: 'af_nicole', name: 'Nicole', accent: 'American', gender: 'Female', grade: 'B-' },
  { id: 'af_aoede', name: 'Aoede', accent: 'American', gender: 'Female', grade: 'C+' },
  { id: 'af_kore', name: 'Kore', accent: 'American', gender: 'Female', grade: 'C+' },
  { id: 'af_sarah', name: 'Sarah', accent: 'American', gender: 'Female', grade: 'C+' },
];

export const DEFAULT_VOICE = 'bm_george';
export const MIN_SPEED = 0.8;
export const MAX_SPEED = 1.3;

export function isVoice(id: unknown): id is string {
  return typeof id === 'string' && VOICES.some((v) => v.id === id);
}
