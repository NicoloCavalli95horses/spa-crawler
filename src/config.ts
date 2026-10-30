export interface CrawlConfig {
  startUrl: string;
  maxDepth: number;
  maxStates: number;            // tetto agli stati salvati: garantisce la terminazione
  maxDurationSecs: number;      // budget di tempo per sito: poi l'esplorazione si chiude da sola
  concurrency: number;          // siti esplorati in parallelo
  viewport: { width: number; height: number };  // fisso: i rettangoli dipendono dalla viewport
  stability: { quietMs: number; timeoutMs: number; longRequestMs: number };
  rectGridPx: number;           // arrotondamento dei rettangoli nel fingerprint
  includeUrlInFingerprint: boolean;
  text: {
    inElementId: boolean;         // testo del cliccabile nel suo id
    inStateFingerprint: boolean;  // testi visibili della pagina nel fingerprint dello stato
    maxBlocks: number;
    maxBlockLength: number;
  };
  actionTimeoutMs: number;
  screenshots: boolean;         // salva un'immagine PNG di ogni stato (solo per debug visivo)
  headless: boolean;            // false: apre una finestra del browser per vedere il crawler in azione
  locale: string;               // lingua chiesta ai siti: tiene coerenti testi e blocklist
  blocklist: string[];          // testi da non cliccare (es. logout)
}

export const config: Readonly<CrawlConfig> = Object.freeze({
  // serve il protocollo, altrimenti Crawlee scarta l'URL
  startUrl: process.env.START_URL ?? 'https://example.com',
  maxDepth: 3,
  maxStates: 500,
  maxDurationSecs: 1800,
  concurrency: 1,
  viewport: { width: 1280, height: 800 },
  stability: { quietMs: 500, timeoutMs: 10_000, longRequestMs: 3_000 },
  rectGridPx: 4,
  includeUrlInFingerprint: true,
  // i testi sono normalizzati (cifre -> '#'); su pagine con contenuti casuali
  // (consigli, caroselli) conviene disattivare inStateFingerprint
  text: { inElementId: true, inStateFingerprint: true, maxBlocks: 2000, maxBlockLength: 200 },
  actionTimeoutMs: 5_000,
  // immagini PNG degli stati: non servono all'esplorazione, solo a ispezionarla a occhio
  screenshots: false,
  // HEADLESS=false npm start per vedere il browser
  headless: process.env.HEADLESS !== 'false',
  // locale del browser e header Accept-Language: i siti multilingua rispondono in inglese
  locale: 'en-US',
  // confronto per sottostringa, senza distinzione di maiuscole, su testo, aria-label e href
  blocklist: ['logout', 'log out', 'sign out', 'quit'],
});
