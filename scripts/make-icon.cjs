// Draws Jarvis's pictures from the same rings as the logo in the app (an outer ring, an open ring with a
// quarter missing, a dotted ring, two short arcs and a glowing core):
//   build/icon.ico               the Windows icon: every size Windows uses, each drawn for its own size,
//                                so it stays sharp (thicker lines and no fine dots at the small sizes)
//   build/icon.png               the same logo at 1024×1024 (for other uses)
//   build/installerSidebar.bmp   the installer's side picture (164×314)
//   build/uninstallerSidebar.bmp the uninstaller's side picture
// Run with: npx electron scripts/make-icon.cjs   (renders off-screen; nothing appears)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const circ = (r) => 2 * Math.PI * r;
/** The sizes Windows asks for (taskbar, title bar, Explorer, Start, shortcuts, at any display scaling). */
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

/**
 * The logo drawn for a picture `size` pixels wide, with its outer ring of radius R around (cx, cy).
 * Lines never get thinner than about 1.5 pixels; the dotted ring and the glow only appear where there
 * is room for them, so small icons are crisp instead of fuzzy.
 */
function logo(cx, cy, R, size, ids) {
  const k = R / 378;
  const px = (size / 1024) * (1024 / (R * 2.32)); // how many output pixels one unit of this drawing is
  const w = (base, min) => Math.max(base * k, min / px);
  const ring = (r, width, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r * k}" fill="none" stroke="#f2f5fb" stroke-width="${width}" ${extra}/>`;
  const small = size < 40;
  const tiny = size <= 24; // 16-24 px: just the outer ring and the core, which still read clearly
  const glow = size >= 128;
  const openR = (small ? 285 : 300) * k;
  const dotsR = 232 * k;
  const arcsR = (small ? 190 : 172) * k;
  const dotCount = size >= 128 ? 54 : 30;
  return `
  <g ${glow ? `filter="url(#${ids}soft)"` : ''} stroke-linecap="round">
    ${ring(tiny ? 360 : 378, w(19, tiny ? 1.9 : 1.7))}
    ${tiny ? '' : ring(openR / k, w(17, 1.5), `stroke-dasharray="${circ(openR) * 0.75} ${circ(openR) * 0.25}" transform="rotate(-140 ${cx} ${cy})"`)}
    ${small ? '' : ring(232, w(15, 1.6), `stroke-opacity=".9" stroke-dasharray="0.1 ${circ(dotsR) / dotCount - 0.1}"`)}
    ${tiny ? '' : ring(arcsR / k, w(15, 1.5), `stroke-dasharray="${circ(arcsR) * 0.14} ${circ(arcsR) * 0.36}" transform="rotate(20 ${cx} ${cy})"`)}
  </g>
  <circle cx="${cx}" cy="${cy}" r="${(tiny ? 150 : small ? 115 : 100) * k}" fill="url(#${ids}core)" ${glow ? `filter="url(#${ids}bloom)"` : ''}/>`;
}

function defs(ids, blur) {
  return `
    <radialGradient id="${ids}core" cx="40%" cy="36%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#dde7fc"/><stop offset="1" stop-color="#9fb5e4"/></radialGradient>
    <radialGradient id="${ids}glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#c9d6f5" stop-opacity=".55"/><stop offset=".55" stop-color="#8d9fc8" stop-opacity=".16"/><stop offset="1" stop-color="#8d9fc8" stop-opacity="0"/></radialGradient>
    <filter id="${ids}soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${7 * blur}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${ids}bloom" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="${22 * blur}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

/** The icon drawn for one size: just the rings and the glowing core on a transparent background. */
const icon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>${defs('i', 1)}</defs>
  ${logo(512, 512, 440, size, 'i')}
</svg>`;

/** The installer's side picture: the starry backdrop, the logo, the name and a line under it. */
function sidebar(line1, line2) {
  const W = 164;
  const H = 314;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = Array.from({ length: 70 }, () => `<circle cx="${(rnd() * W).toFixed(1)}" cy="${(rnd() * H).toFixed(1)}" r="${(0.3 + rnd() * 0.7).toFixed(2)}" fill="#fff" fill-opacity="${(0.25 + rnd() * 0.55).toFixed(2)}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="80%"><stop offset="0" stop-color="#262c3b"/><stop offset=".6" stop-color="#14161d"/><stop offset="1" stop-color="#0c0d11"/></radialGradient>
    ${defs('s', 0.12)}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${stars}
  <circle cx="82" cy="104" r="62" fill="url(#sglow)"/>
  ${logo(82, 104, 44, 256, 's')}
  <text x="82" y="192" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="17" font-weight="300" letter-spacing="6.5" fill="#f2f4f8">JARVIS</text>
  <text x="82" y="222" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="11.5" font-weight="600" fill="#d9dde5">${line1}</text>
  <text x="82" y="238" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="11.5" font-weight="600" fill="#d9dde5">${line2}</text>
</svg>`;
}

/** A 24-bit Windows bitmap (what the installer needs) from RGBA pixels. */
function bmp(width, height, rgba) {
  const row = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + row * height;
  const b = Buffer.alloc(size);
  b.write('BM', 0);
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(width, 18);
  b.writeInt32LE(height, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(row * height, 34);
  b.writeInt32LE(2835, 38);
  b.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4; // bitmaps are stored bottom-up
    const dst = 54 + y * row;
    for (let x = 0; x < width; x++) {
      b[dst + x * 3] = rgba[src + x * 4 + 2];
      b[dst + x * 3 + 1] = rgba[src + x * 4 + 1];
      b[dst + x * 3 + 2] = rgba[src + x * 4];
    }
  }
  return b;
}

/** A Windows .ico holding one PNG picture per size. */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // an icon
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); // 0 means 256
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2);
    head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // drawn on a canvas inside the page, so the window's own size (limited by the screen) does not matter
  const win = new BrowserWindow({ width: 400, height: 300, show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,<html><body></body></html>');
  const draw = (svg, w, h) =>
    win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = ${w}; c.height = ${h};
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, ${w}, ${h});
        resolve({ png: c.toDataURL('image/png'), rgba: Array.from(g.getImageData(0, 0, ${w}, ${h}).data) });
      };
      img.onerror = () => reject(new Error('the picture could not be drawn'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)});
    })`);
  const png = (r) => Buffer.from(r.png.split(',')[1], 'base64');
  fs.writeFileSync(path.join(BUILD, 'icon.png'), png(await draw(icon(1024), 1024, 1024)));
  const sizes = [];
  for (const s of ICO_SIZES) sizes.push({ size: s, data: png(await draw(icon(s), s, s)) });
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico(sizes));
  const inst = await draw(sidebar('Your own team of', 'AI experts'), 164, 314);
  fs.writeFileSync(path.join(BUILD, 'installerSidebar.bmp'), bmp(164, 314, inst.rgba));
  const uninst = await draw(sidebar('Thanks for trying', 'Jarvis'), 164, 314);
  fs.writeFileSync(path.join(BUILD, 'uninstallerSidebar.bmp'), bmp(164, 314, uninst.rgba));
  // each size also as its own picture, to check by eye (not part of the app)
  const check = path.join(require('os').tmpdir(), 'jarvis-icon-sizes');
  fs.mkdirSync(check, { recursive: true });
  for (const s of sizes) fs.writeFileSync(path.join(check, `${s.size}.png`), s.data);
  console.log(`each size to look at: ${check}`);
  console.log(`wrote build/icon.ico (${ICO_SIZES.join(', ')} px), build/icon.png, build/installerSidebar.bmp, build/uninstallerSidebar.bmp`);
  app.exit(0);
});
