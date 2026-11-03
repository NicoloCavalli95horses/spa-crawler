import type { IStateGraph } from '../core/interfaces';
import type { Action, Edge } from '../core/types';
import type { CrawlEdgeStore } from '../db/CrawlEdgeStore';

/** In-memory state -> action -> state graph; persisted to SQLite incrementally (only new edges). */
export class StateGraph implements IStateGraph {
  private edges: Edge[] = [];
  private keys = new Set<string>();
  private persistedCount = 0;

  constructor(private site: string, private persistent: CrawlEdgeStore) {}

  addEdge(from: string, action: Action, to: string): void {
    const key = `${from}|${action.type}|${action.target.id}|${to}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.edges.push({
      from,
      to,
      action: {
        type: action.type,
        targetId: action.target.id,
        text: action.target.text,
        selector: action.target.selector,
      },
    });
  }

  edgeCount(): number {
    return this.edges.length;
  }

  getEdges(): readonly Edge[] {
    return this.edges;
  }

  async persist(): Promise<void> {
    const newEdges = this.edges.slice(this.persistedCount);
    if (newEdges.length === 0) return;
    this.persistent.recordMany({ site: this.site, edges: newEdges });
    this.persistedCount = this.edges.length;
  }
}
