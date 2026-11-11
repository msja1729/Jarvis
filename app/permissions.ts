/**
 * What Jarvis's own pages may capture. Only Jarvis's pages (file://) ever get anything:
 *  - the microphone (push-to-talk, meetings);
 *  - for meeting recording, "display capture": the screen and the computer's own sound. The main
 *    process answers it itself with the screen the mouse is on and Windows loopback audio (no picker),
 *    and it is only requested while a meeting is being recorded.
 * Camera and everything else are refused.
 */
export function allowCapture(permission: string, mediaTypes: readonly string[] | undefined, pageUrl: string): boolean {
  if (!pageUrl.startsWith('file://')) return false;
  if (permission === 'display-capture') return true;
  if (permission !== 'media') return false;
  // getUserMedia: microphone only (no camera)
  return (mediaTypes ?? []).every((t) => t === 'audio');
}
