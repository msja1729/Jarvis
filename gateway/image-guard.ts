/**
 * Last line of defence for T7/T8 (criteria 14, 15): every attachment leaving the
 * Gateway must be a PNG or JPEG whose longest side is at most 1280 px. Audio and
 * anything else is refused. Screen/whiteboard code scales images before this point.
 */
export const MAX_IMAGE_SIDE = 1280;
const ALLOWED = new Set(['image/png', 'image/jpeg']);

export function imageSize(buf: Buffer): { width: number; height: number } | null {
  // PNG: signature + IHDR width/height at bytes 16..23
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: walk segments to a SOFn marker
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Scaled size so the longest side is at most MAX_IMAGE_SIDE (never upscales). */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

export function checkAttachment(att: { data: string; mimeType: string }): string | null {
  if (!ALLOWED.has(att.mimeType)) return `attachment type ${att.mimeType} is not allowed`;
  const size = imageSize(Buffer.from(att.data, 'base64'));
  if (!size) return 'unreadable image';
  if (Math.max(size.width, size.height) > MAX_IMAGE_SIDE) {
    return `image ${size.width}x${size.height} is larger than ${MAX_IMAGE_SIDE}px`;
  }
  return null;
}
