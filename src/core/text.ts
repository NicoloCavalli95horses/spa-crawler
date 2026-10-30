/**
 * Normalizza un testo per confronti e fingerprint: minuscolo, spazi compattati,
 * cifre sostituite da '#'. Così contatori, date e orari ("Carrello (3)", "2 min fa")
 * non generano stati nuovi a ogni variazione.
 */
export function normalizeText(s: string | undefined | null): string {
  if (!s) return '';
  return s.normalize('NFKC').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}
