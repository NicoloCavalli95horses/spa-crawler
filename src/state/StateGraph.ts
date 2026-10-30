import type { IOutputSink, IStateGraph } from '../core/interfaces';
import type { Action } from '../core/types';

export interface Edge {
  from: string;
  to: string;
  action: { type: Action['type']; targetId: string; text?: string; selector: string };
}

/** Grafo stato -> azione -> stato in memoria, salvato come JSON tramite il sink. */
export class StateGraph implements IStateGraph {
  private edges: Edge[] = [];
  private keys = new Set<string>();

  constructor(private output: IOutputSink, private storeKey = 'state-graph') {}

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
    await this.output.saveJson(this.storeKey, { edges: this.edges });
  }
}
