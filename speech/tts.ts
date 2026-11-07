/** Text-to-speech with the OS voice via the Web Speech API (T8: never through Claude). */

export function speak(text: string, onEnd?: () => void): void {
  if (typeof speechSynthesis === 'undefined') {
    onEnd?.();
    return;
  }
  speechSynthesis.cancel();
  const clean = text.replace(/[*_#`>|]/g, '').slice(0, 1500);
  const u = new SpeechSynthesisUtterance(clean);
  if (onEnd) {
    u.onend = () => onEnd();
    u.onerror = () => onEnd();
  }
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
