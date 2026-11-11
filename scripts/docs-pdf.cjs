// Electron script: renders a docs/*.html page to PDF (A4, page numbers).
// Run with: npm run docs:pdf  (docs/jarvis-capabilities.html -> docs/Jarvis-Capabilities.pdf)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const [srcName = 'jarvis-capabilities.html', outName = 'Jarvis-Capabilities.pdf', footer = 'Jarvis Capabilities'] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('.cjs'));
const src = path.join(root, 'docs', path.basename(srcName));
const out = path.join(root, 'docs', path.basename(outName));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  win.webContents.setAudioMuted(true);
  await win.loadFile(src);
  await new Promise((r) => setTimeout(r, 400)); // let the cover pattern draw
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;font:8px Segoe UI,sans-serif;color:#8b90a0;padding:0 15mm;display:flex;justify-content:space-between">' +
      `<span>${footer.replace(/[<>&]/g, '')}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  fs.writeFileSync(out, pdf);
  console.log(`wrote ${out} (${Math.round(pdf.length / 1024)} KB)`);
  app.quit();
});
