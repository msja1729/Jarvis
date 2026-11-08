/**
 * Window setup for the glass look. Windows' own Acrylic material renders as flat
 * grey on some PCs (tested), so Jarvis draws its glass itself: CSS frosted panels
 * (translucent fill + backdrop blur + 1px rim) over its own blurred space background.
 * Frameless windows get rounded corners from Windows 11, so no rectangle shows around them.
 */
import type { BrowserWindowConstructorOptions } from 'electron';

export const SPACE = '#161616';

/** Every Jarvis window paints its own background (no OS material). */
export function glassOptions(): Partial<BrowserWindowConstructorOptions> {
  return { backgroundColor: SPACE };
}

/** Main window: hidden title bar, with the OS window buttons drawn over the app. */
export function mainChromeOptions(platform = process.platform): Partial<BrowserWindowConstructorOptions> {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 24 } };
  return { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#cfcfcf', height: 64 } };
}
