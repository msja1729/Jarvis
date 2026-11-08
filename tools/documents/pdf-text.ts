/**
 * Text of each page of a PDF, using Mozilla's pdf.js, on this computer.
 * pdf.js 6 never evaluates code from a PDF and scripting is not enabled here; nothing is fetched.
 */
export const MAX_PDF_PAGES = 1000;

export async function pdfPages(data: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false, stopAtErrors: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        text += item.hasEOL ? '\n' : ' ';
      }
      pages.push(text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
