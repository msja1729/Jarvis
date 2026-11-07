/** ISO 8601 with the computer's local offset, e.g. 2026-11-08T16:00:00+05:30. */
export function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Graph "UTC" date-time strings have no zone suffix. */
export function fromGraphUtc(dateTime: string): string {
  return toLocalIso(new Date(/[zZ]|[+-]\d\d:\d\d$/.test(dateTime) ? dateTime : `${dateTime}Z`));
}

/** Any ISO input → "YYYY-MM-DDTHH:mm:ss" in UTC, for Graph with timeZone "UTC". */
export function toGraphUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date-time: ${iso}`);
  return d.toISOString().slice(0, 19);
}
