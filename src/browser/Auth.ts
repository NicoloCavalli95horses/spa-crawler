import type { BrowserContext } from 'playwright';
import type { AuthConfig } from '../config';

/** Header da inviare: bearerToken diventa Authorization, `headers` ha la precedenza. */
export function authHeaders(auth: AuthConfig): Record<string, string> {
  return {
    ...(auth.bearerToken ? { Authorization: `Bearer ${auth.bearerToken}` } : {}),
    ...auth.headers,
  };
}

/** Il sito esplorato e i suoi sottodomini: le credenziali non devono arrivare a terze parti. */
export function isSameSite(requestUrl: string, siteUrl: string): boolean {
  const host = new URL(requestUrl).hostname;
  const site = new URL(siteUrl).hostname.replace(/^www\./, '');
  return host === site || host.endsWith(`.${site}`);
}

/**
 * Imposta cookie e header di autenticazione sul contesto del browser.
 * Gli header partono con ogni richiesta (navigazioni, fetch, XHR, risorse) verso il sito
 * esplorato; le richieste verso altri domini restano senza credenziali.
 */
export async function applyAuth(context: BrowserContext, auth: AuthConfig, siteUrl: string): Promise<void> {
  if (auth.cookies) {
    await context.addCookies(
      Object.entries(auth.cookies).map(([name, value]) => ({ name, value, url: siteUrl })),
    );
  }
  const headers = authHeaders(auth);
  if (Object.keys(headers).length === 0) return;
  await context.route('**/*', (route) => {
    const req = route.request();
    if (!isSameSite(req.url(), siteUrl)) return route.continue();
    return route.continue({ headers: { ...req.headers(), ...headers } });
  });
}
