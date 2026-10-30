export interface ExtensionCall {
  fn: string;                    // nome su window, es. '__RAPIDOR__getData'
  when: 'start' | 'end';         // start: prima dell'esplorazione; end: dopo l'ultimo stato
  args?: unknown[];              // argomenti, serializzabili in JSON
}

export interface ExtensionConfig {
  path: string;                  // cartella dell'estensione (quella con manifest.json), non pacchettizzata
  calls: ExtensionCall[];
}

export interface AuthConfig {
  bearerToken?: string;                  // diventa `Authorization: Bearer <token>`
  headers?: Record<string, string>;      // header aggiuntivi (hanno la precedenza su bearerToken)
  cookies?: Record<string, string>;      // cookie di sessione, impostati sul dominio del sito
}

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
  extension?: ExtensionConfig;  // estensione Chrome da caricare (opzionale)
  auth?: AuthConfig;            // credenziali inviate a ogni richiesta verso il sito esplorato (opzionale)
}

/** "a=1; b=2" -> { a: '1', b: '2' } (formato dell'header Cookie copiato dai DevTools). */
function parseCookies(raw: string): Record<string, string> {
  return Object.fromEntries(raw.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i), p.slice(i + 1)];
  }));
}

const auth: AuthConfig | undefined =
  process.env.AUTH_BEARER || process.env.AUTH_COOKIES || process.env.AUTH_HEADERS
    ? {
        bearerToken: process.env.AUTH_BEARER,
        cookies: process.env.AUTH_COOKIES ? parseCookies(process.env.AUTH_COOKIES) : undefined,
        headers: process.env.AUTH_HEADERS ? JSON.parse(process.env.AUTH_HEADERS) : undefined,
      }
    : undefined;

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
  // estensione Chrome: i risultati delle chiamate finiscono nel KeyValueStore come
  // `<sito>--extension-<when>-<fn>`. Le funzioni devono stare nel mondo MAIN della pagina
  // (content script con "world": "MAIN" nel manifest), altrimenti window non le vede.
  // autenticazione, solo da variabili d'ambiente per non committare segreti:
  //   AUTH_BEARER=<token>  AUTH_COOKIES='sid=abc; lang=it'  AUTH_HEADERS='{"X-Api-Key":"k"}'
  auth,
  extension: {
    path: '../rapidor/packages/react-devtools-extensions/chrome/build/unpacked',
    calls: [
      // { fn: '__RAPIDOR__init', when: 'start' },
      { fn: '__RAPIDOR__getData', when: 'end' },
    ],
  },
} as const satisfies CrawlConfig);
