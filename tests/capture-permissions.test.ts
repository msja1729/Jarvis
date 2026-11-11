/** The real rules for what Jarvis may capture, and no filler transcripts from silence. */
import { describe, expect, it } from 'vitest';
import { allowCapture } from '../app/permissions.js';
import { dropFiller, pcmLevel, SILENCE_LEVEL } from '../speech/hallucination.js';

const page = 'file:///C:/Program%20Files/Jarvis/resources/app/dist/renderer/index.html?mode=main';

describe('capture permissions (the rules the app really uses)', () => {
  it('a meeting may capture the screen and the computer sound (display capture), on Jarvis pages', () => {
    // This is exactly what Chromium asks for getDisplayMedia({ audio: true, video: … }): it was refused before.
    expect(allowCapture('display-capture', ['audio', 'video'], page)).toBe(true);
  });

  it('the microphone yes, the camera no', () => {
    expect(allowCapture('media', ['audio'], page)).toBe(true);
    expect(allowCapture('media', ['video'], page)).toBe(false);
    expect(allowCapture('media', ['audio', 'video'], page)).toBe(false);
  });

  it('nothing for any other page, and nothing else at all', () => {
    expect(allowCapture('display-capture', ['audio', 'video'], 'https://example.com/')).toBe(false);
    expect(allowCapture('media', ['audio'], 'https://example.com/')).toBe(false);
    for (const p of ['geolocation', 'notifications', 'clipboard-read', 'openExternal']) expect(allowCapture(p, [], page)).toBe(false);
  });
});

describe('no filler from silence or noise', () => {
  const tone = (amp: number, n = 16000) => {
    const b = new Uint8Array(n * 2);
    const v = new DataView(b.buffer);
    for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.round(amp * 32767 * Math.sin(i / 5)), true);
    return b;
  };

  it('silence is detected; speech-level sound is not', () => {
    expect(pcmLevel(new Uint8Array(32000))).toBe(0);
    expect(pcmLevel(tone(0.001))).toBeLessThan(SILENCE_LEVEL);
    expect(pcmLevel(tone(0.05))).toBeGreaterThan(SILENCE_LEVEL);
  });

  it('Whisper’s stock phrases alone become nothing; real speech is kept whole', () => {
    for (const f of ['Thank you.', 'Thank you. Thank you.', ' Thanks for watching!', 'you', '[BLANK_AUDIO]', '(music)', '♪ ♪', 'Thank you very much.\nBye.'])
      expect(dropFiller(f), f).toBe('');
    expect(dropFiller('Thank you. Let us move to the budget for Q3.')).toBe('Thank you. Let us move to the budget for Q3.');
    expect(dropFiller('The deadline is Friday.')).toBe('The deadline is Friday.');
  });
});
