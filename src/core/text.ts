/**
 * Normalizes a text for comparisons and fingerprints: lowercase, collapsed whitespace,
 * digits replaced by '#'. This way counters, dates and times ("Cart (3)", "2 min ago")
 * do not generate new states at every change.
 */
export function normalizeText(s: string | undefined | null): string {
  if (!s) return '';
  return s.normalize('NFKC').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}
