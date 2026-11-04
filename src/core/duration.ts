/**
 * Formats a millisecond duration as `hh:mm:ss.mmm`, zero-padded (hours are not capped at 24: a
 * multi-hour crawl just keeps counting up, e.g. `27:03:11.004`). Used wherever a duration measured
 * in ms (exploration time, analysis time, ...) is logged or displayed, so it reads at a glance
 * instead of as a bare millisecond count.
 */
export function formatDuration(ms: number): string {
  const totalMs = Math.max(0, Math.trunc(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1_000);
  const millis = totalMs % 1_000;

  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}
