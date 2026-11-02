import type { BrowserContext } from 'playwright';
import type { AuthConfig } from '../config';

/** Headers to send: bearerToken becomes Authorization, `headers` takes precedence. */
export function authHeaders(auth: AuthConfig): Record<string, string> {
  return {
    ...(auth.bearerToken ? { Authorization: `Bearer ${auth.bearerToken}` } : {}),
    ...auth.headers,
  };
}

/** The explored site and its subdomains: credentials must never reach third parties. */
export function isSameSite(requestUrl: string, siteUrl: string): boolean {
  const host = new URL(requestUrl).hostname;
  const site = new URL(siteUrl).hostname.replace(/^www\./, '');
  return host === site || host.endsWith(`.${site}`);
}

/**
 * Sets authentication cookies and headers on the browser context.
 * Headers go out with every request (navigations, fetch, XHR, resources) to the explored
 * site; requests to other domains stay without credentials.
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
