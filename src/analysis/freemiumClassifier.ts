import { pipeline } from '@huggingface/transformers';

/**
 * Embedding-based replacement for exact keyword matching in scripts/freemiumPrefilter.ts: a UI
 * phrase ("Go Pro", "Unlock everything", "Passa a Premium") counts when it lands close, in the same
 * sentence-embedding space as AuthzClassifier, to a paid-tier/feature-gating concept.
 *
 * Why not just reuse AuthzClassifier: its concepts and 0.33 threshold are tuned for identifier-like
 * state keys ("isPremium", "userRole"). On short natural UI text they do not separate: measured on
 * sample labels, "Upgrade to Pro" scored 0.21 (miss) while "Privacy policy" scored 0.37 (false hit).
 * These concepts are phrased the way paywall copy is, and the threshold was re-measured on the same
 * kind of labels (paywall labels 0.37-0.71, ordinary site chrome up to 0.33).
 */
const PAYWALL_CONCEPTS = [
  'upgrade to a paid premium plan to unlock locked features',
  'subscribe to a pro subscription plan, pricing and billing',
  'start a free trial of the premium plan',
  'free plan with limited usage, upgrade for unlimited access',
  'this content is locked for free users, only premium members can access it',
];

export const PAYWALL_THRESHOLD = 0.36;
const MODEL = 'Xenova/all-MiniLM-L6-v2';
const BATCH_SIZE = 64;

type FeatureExtractor = (text: string[], opts: { pooling: 'mean'; normalize: boolean }) =>
  Promise<{ dims: number[]; data: Float32Array | number[] }>;

export interface PhraseScore {
  phrase: string;
  score: number;                 // best cosine similarity against any paywall concept
  isPaywallRelevant: boolean;
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export class FreemiumPhraseClassifier {
  private extractor?: Promise<FeatureExtractor>;
  private conceptEmbeddings?: Promise<Float32Array[]>;
  // phrases repeat across sites ("Sign in", "Pricing", ...), so scores are kept for the whole run
  private cache = new Map<string, number>();

  private getExtractor(): Promise<FeatureExtractor> {
    this.extractor ??= pipeline('feature-extraction', MODEL) as unknown as Promise<FeatureExtractor>;
    return this.extractor;
  }

  private async embed({ texts }: { texts: string[] }): Promise<Float32Array[]> {
    const output = await (await this.getExtractor())(texts, { pooling: 'mean', normalize: true });
    const dim = output.dims.at(-1) as number;
    return texts.map((_, i) => Float32Array.from(output.data.slice(i * dim, (i + 1) * dim)));
  }

  private getConceptEmbeddings(): Promise<Float32Array[]> {
    this.conceptEmbeddings ??= this.embed({ texts: PAYWALL_CONCEPTS });
    return this.conceptEmbeddings;
  }

  async scorePhrases({ phrases }: { phrases: string[] }): Promise<PhraseScore[]> {
    const unique = [...new Set(phrases)];
    const missing = unique.filter((p) => !this.cache.has(p));
    if (missing.length > 0) {
      const concepts = await this.getConceptEmbeddings();
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = missing.slice(i, i + BATCH_SIZE);
        const embeddings = await this.embed({ texts: batch });
        batch.forEach((phrase, j) => this.cache.set(phrase, Math.max(...concepts.map((c) => dot(embeddings[j], c)))));
      }
    }
    return unique.map((phrase) => {
      const score = this.cache.get(phrase)!;
      return { phrase, score, isPaywallRelevant: score >= PAYWALL_THRESHOLD };
    });
  }
}
