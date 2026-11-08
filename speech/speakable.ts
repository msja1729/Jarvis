/**
 * Turns a chat reply into text that sounds natural when spoken:
 * no markdown symbols, no raw links or code, list items become sentences.
 */
export const MAX_SPOKEN_CHARS = 2500;

export function cleanForSpeech(text: string): string {
  let t = text.replace(/\r\n/g, '\n');
  t = t.replace(/```[\s\S]*?```/g, ' (I have put the code in the chat.) ');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images
  t = t.replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/g, '$1'); // [text](url)
  // bare links: keep any sentence punctuation that followed them
  t = t.replace(/\bhttps?:\/\/\S+/g, (m) => `a link${m.match(/[.,;:!?)]+$/)?.[0] ?? ''}`);
  t = t.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, (_m, h: string) => (/[.!?:]$/.test(h.trim()) ? h : `${h}.`)); // headings end a sentence
  t = t.replace(/^\s*>\s?/gm, ''); // quotes
  t = t.replace(/^\s*[-*•]\s+(.*)$/gm, (_m, item: string) => (/[.!?:;]$/.test(item.trim()) ? item : `${item}.`)); // bullets
  t = t.replace(/^\s*\|.*\|\s*$/gm, ''); // table rows
  t = t.replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, '$2'); // bold/italic/strike
  t = t.replace(/[*_#>|~]/g, ' ');
  t = t.replace(/\p{Extended_Pictographic}️?/gu, '');
  t = t.replace(/\s*\n\s*\n\s*/g, '. ').replace(/\s*\n\s*/g, ' ');
  t = t.replace(/\s+([,.;:!?])/g, '$1'); // no space before punctuation (e.g. after a removed emoji)
  t = t.replace(/([!?:])\.(?=\s|$)/g, '$1').replace(/\.\s*\./g, '.').replace(/\s{2,}/g, ' ').trim();
  if (t.length > MAX_SPOKEN_CHARS) {
    const cut = t.lastIndexOf('. ', MAX_SPOKEN_CHARS);
    t = `${t.slice(0, cut > 200 ? cut + 1 : MAX_SPOKEN_CHARS)} The rest is in the chat.`;
  }
  return t;
}
