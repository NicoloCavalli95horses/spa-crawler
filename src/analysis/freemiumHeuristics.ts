/**
 * Cheap triage signals for scripts/freemiumPrefilter.ts
 *  > does a page look like a freemium app with a paid-feature preview
 *    worth a manual login and a full exploration?
 *
 * Two independent signals: UI phrases close (by embedding) to paywall concepts, and known billing
 * provider scripts in the markup. The second stays a literal match on purpose: a script host is a
 * deterministic fingerprint, not natural language, so there is nothing for an embedding to add.
 */
import type { FreemiumPhraseClassifier } from './freemiumClassifier';

// Script hosts of well-known billing/subscription providers; a substring match against <script src>
// URLs in the raw markup (no need to parse the DOM for this).
export const BILLING_SCRIPT_HOSTS: readonly string[] = [
  'js.stripe.com', 'checkout.stripe.com', 'cdn.paddle.com', 'js.paddle.com',
  'js.chargebee.com', 'js.recurly.com', 'js.braintreegateway.com', 'www.paypalobjects.com',
  'paypal.com/sdk', 'cdn.revenuecat.com', 'checkout.razorpay.com', 'js.squareup.com',
];

export interface FreemiumScore {
  score: number;
  keywordHits: string[];        // paywall-like UI phrases, most similar first
  billingScriptHits: string[];
}

const SCRIPT_SRC_RE = /<script[^>]+src=["']([^"']+)["']/gi;

// A billing-provider script is a strong, low-noise signal. Phrase hits are individually weaker (the
// embedding is fuzzy) and a page repeats them (pricing table, nav, footer), so they are capped:
// the score says "how many independent kinds of evidence", not "how long is the pricing page".
const BILLING_SCRIPT_WEIGHT = 2;
const PHRASE_WEIGHT = 1;
const MAX_PHRASE_HITS = 5;

// UI labels, not prose: long sentences dilute the embedding and are rarely the paywall control itself
const MIN_PHRASE_CHARS = 3;
const MAX_PHRASE_CHARS = 60;
const MAX_PHRASE_WORDS = 8;
const MAX_PHRASES_PER_PAGE = 400;

/** Splits visible text (one UI block per line, see htmlToText) into short unique candidate phrases. */
export function extractPhrases({ text }: { text: string }): string[] {
  const phrases = new Set<string>();
  for (const line of text.split('\n')) {
    const phrase = line.replace(/\s+/g, ' ').trim();
    if (phrase.length < MIN_PHRASE_CHARS || phrase.length > MAX_PHRASE_CHARS) continue;
    if (phrase.split(' ').length > MAX_PHRASE_WORDS || !/\p{L}/u.test(phrase)) continue;
    phrases.add(phrase);
    if (phrases.size >= MAX_PHRASES_PER_PAGE) break;
  }
  return [...phrases];
}

export async function scoreFreemiumSignals(
  { html, text, classifier }: { html: string; text: string; classifier: FreemiumPhraseClassifier },
): Promise<FreemiumScore> {
  const scored = await classifier.scorePhrases({ phrases: extractPhrases({ text }) });
  const keywordHits = scored
    .filter((p) => p.isPaywallRelevant)
    .sort((a, b) => b.score - a.score)
    .map((p) => p.phrase);

  const scriptSrcs = [...html.matchAll(SCRIPT_SRC_RE)].map((m) => m[1]);
  const billingScriptHits = BILLING_SCRIPT_HOSTS.filter((host) => scriptSrcs.some((src) => src.includes(host)));

  return {
    score: Math.min(keywordHits.length, MAX_PHRASE_HITS) * PHRASE_WEIGHT + billingScriptHits.length * BILLING_SCRIPT_WEIGHT,
    keywordHits: keywordHits.slice(0, MAX_PHRASE_HITS),
    billingScriptHits,
  };
}

/** Strips scripts/styles and turns every tag into a line break, so each UI block becomes its own line. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
}
