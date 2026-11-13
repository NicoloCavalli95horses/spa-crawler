import { pipeline } from '@huggingface/transformers';
import type { PropDiff } from './responseEvaluate';
import type { AuthzClassificationStore } from '../db/AuthzClassificationStore';

/**
 * Port of RAPIDOR's extension-only offscreen classifier (react-devtools-extensions/src/offscreen/
 * offscreen.js): the same sentence-embedding model, the same 4 concept sentences verbatim, and the
 * same threshold 0.33 — the real one RAPIDOR enforces (config.js's sensitiveKeyThr is dead code,
 * referenced nowhere). Runs directly in Node here; @huggingface/transformers works the same way
 * server-side, so no browser/offscreen-document plumbing is needed at all.
 */
const AUTHZ_CONCEPTS = [
  "permissions and access control: user roles, permissions, and access rights determine whether a user can access, use, or is blocked from using a feature or resource",
  "feature gating and availability: features or content can be free, paid, premium, locked, unlocked, blocked, or available depending on the user's permissions and authorization",
  "subscription and access tiers: free and premium subscriptions, paid plans, and membership levels determine access to locked or unlocked features and content",
  "entitlements and usage limitations: user entitlements, credits, quotas, and usage limits determine whether a feature or resource is available, accessible, locked, unlocked, or blocked",
];

const THRESHOLD = 0.33;
const MODEL = 'Xenova/all-MiniLM-L6-v2';

type FeatureExtractor = (text: string | string[], opts: { pooling: 'mean'; normalize: boolean }) =>
  Promise<{ dims: number[]; data: Float32Array | number[] }>;

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export class AuthzClassifier {
  private extractor?: Promise<FeatureExtractor>;
  private conceptEmbeddings?: Float32Array[];
  // L1 (in-memory, this process) in front of the store's L2 (SQLite, survives across runs/sites)
  private cache = new Map<string, { score: number; isAuthZRelevant: boolean }>();

  constructor(private store: AuthzClassificationStore) {}

  private getExtractor(): Promise<FeatureExtractor> {
    this.extractor ??= pipeline('feature-extraction', MODEL) as unknown as Promise<FeatureExtractor>;
    return this.extractor;
  }

  private async getConceptEmbeddings(): Promise<Float32Array[]> {
    if (this.conceptEmbeddings) return this.conceptEmbeddings;
    const extractor = await this.getExtractor();
    const output = await extractor(AUTHZ_CONCEPTS, { pooling: 'mean', normalize: true });
    const dim = output.dims.at(-1) as number;
    this.conceptEmbeddings = AUTHZ_CONCEPTS.map((_, i) => Float32Array.from(output.data.slice(i * dim, (i + 1) * dim)));
    return this.conceptEmbeddings;
  }

  async classify(key: string): Promise<{ score: number; isAuthZRelevant: boolean }> {
    // Two normalizations, both measured to raise recall with zero new false positives (across the real
    // authz keys + values of pimsleur/busuu/lingualeo), and neither a hand-maintained list of "authz"
    // keys:
    //  1. Embed the key as WORDS, not one opaque identifier. `isLessonUnlocked` glued together reads as
    //     noise (0.157); split to "is lesson unlocked" it scores 0.431. camelCase/snake/kebab split.
    //  2. Frame it as a yes/no condition ("whether ..."), which is how authorization fields actually
    //     read ("is this unlocked/available?"). This lifts the ambiguous single-word flags the split
    //     alone can't help — `available` 0.234 -> 0.34 — while 12 negative keys and 8 id-like values
    //     all stay well below threshold.
    // Caching by the normalized form also naturally invalidates entries a previous (raw-key) run stored.
    const norm = normalizeKey(key);
    const cached = this.cache.get(norm) ?? this.store.get(norm);
    if (cached) {
      this.cache.set(norm, cached);
      return cached;
    }

    const extractor = await this.getExtractor();
    const concepts = await this.getConceptEmbeddings();
    const output = await extractor(`whether ${norm}`, { pooling: 'mean', normalize: true });
    const dim = output.dims.at(-1) as number;
    const embedding = Float32Array.from(output.data.slice(0, dim));

    const score = Math.max(...concepts.map((c) => dot(embedding, c)));
    const result = { score, isAuthZRelevant: score >= THRESHOLD };
    this.cache.set(norm, result);
    this.store.set(norm, result);
    return result;
  }
}

/** Split camelCase / snake_case / kebab-case into lowercase space-separated words for embedding. */
export function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Short, identifier-shaped strings only (port of responseEvaluator.js's isValidString filter). */
function isValidString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 50
    && !value.includes(' ') && !/^\d+$/.test(value) && /^[a-zA-Z0-9_]+$/.test(value);
}

export interface AuthzAssessment {
  isAuthzRelevant: boolean;
  differences: PropDiff[];
  sensitiveKeys: string[];
}

/** Port of responseEvaluator.js's assessAuthZ: diffed keys/paths/values classified, not the raw props. */
export async function assessAuthZ({ differences, classifier }: {
  differences: PropDiff[]; classifier: AuthzClassifier;
}): Promise<AuthzAssessment> {
  const payload = differences.flatMap((d) => [d.key, d.pathStr, d.current, d.reference]);
  const filtered = [...new Set(payload.filter(isValidString))];

  const classifications = await Promise.all(filtered.map(async (value) => ({ value, ...(await classifier.classify(value)) })));
  const sensitiveKeys = classifications.filter((c) => c.isAuthZRelevant).map((c) => c.value);

  const hasAnyDifference = differences.some((d) => d.reference !== d.current);
  return { isAuthzRelevant: hasAnyDifference && sensitiveKeys.length > 0, differences, sensitiveKeys };
}
