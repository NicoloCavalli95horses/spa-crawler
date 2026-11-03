import type { RapidorGraph } from '../db/ReactStateStore';
import { tokenize } from './preindex';

export interface MatchCandidate {
  stateId: number;
  referenceNodeId: string;
  candidateNodeId: string;
  path: (string | number)[];
  referenceValue: unknown;
  candidateValue: string;
  referenceProps: unknown;
  candidateProps: unknown;
}

/** Walks `path` into `obj`; undefined if any step is missing (mirrors matchFinder.js's getValueAtPath walk). */
export function readPath(obj: unknown, path: (string | number)[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null || typeof current !== 'object' || !Object.hasOwn(current as object, String(key))) return undefined;
    current = (current as Record<string, unknown>)[key as string];
  }
  return current;
}

/**
 * Port of matchFinder.js's getValueAtPath diffing step. Deviation, deliberate: RAPIDOR always
 * compares a NUMBER candidate against the reference's tokenized string ARRAY via `!=` (always
 * unequal regardless of actual value), which would flag identical numbers as "different". Here we
 * compare the actual values: string-vs-string uses the same tokenized single-diff extraction,
 * anything else uses straight inequality.
 */
export function diffValue({ candidateRaw, referenceRaw }: { candidateRaw: unknown; referenceRaw: unknown }): string | undefined {
  if (candidateRaw == null) return undefined;
  if (typeof referenceRaw === 'string' && typeof candidateRaw === 'string') {
    const refTokens = new Set(tokenize(referenceRaw));
    const diffTokens = tokenize(candidateRaw).filter((t) => !refTokens.has(t));
    return diffTokens.length === 1 ? diffTokens[0] : undefined;
  }
  return candidateRaw !== referenceRaw ? String(candidateRaw) : undefined;
}

/**
 * Given a preindexed match (a node, at a given state, carrying `value` at `path`), finds sibling
 * instances of the same component (via the graph's componentIndex) whose value at the same path
 * genuinely differs — each one a candidate replacement for an IDOR probe.
 */
export function findCandidates({ stateId, graph, nodeId, path }: {
  stateId: number; graph: RapidorGraph; nodeId: string; path: (string | number)[];
}): MatchCandidate[] {
  const nodes = (graph.nodes ?? {}) as Record<string, { id: string; componentId?: number; props?: unknown }>;
  const componentIndex = (graph.componentIndex ?? {}) as Record<string, string[]>;

  const node = nodes[nodeId];
  if (!node || node.componentId == null) return [];

  const instancesIds = componentIndex[String(node.componentId)];
  if (!instancesIds?.length) return [];

  const referenceRaw = readPath(node, path);
  if (referenceRaw == null) return [];

  const candidates: MatchCandidate[] = [];
  for (const id of instancesIds) {
    if (id === nodeId) continue;
    const candidateNode = nodes[id];
    if (!candidateNode) continue;

    const candidateRaw = readPath(candidateNode, path);
    const candidateValue = diffValue({ candidateRaw, referenceRaw });
    if (candidateValue === undefined) continue;

    candidates.push({
      stateId, referenceNodeId: nodeId, candidateNodeId: id, path,
      referenceValue: referenceRaw, candidateValue,
      referenceProps: node.props, candidateProps: candidateNode.props,
    });
  }
  return candidates;
}
