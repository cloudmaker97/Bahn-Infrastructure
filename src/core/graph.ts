// Streckennetz-Graph mit Dijkstra. Verantwortung: Graphstruktur + Pfadsuche (SRP).
// Implementiert die Pathfinder-Abstraktion (DIP fuer den RouteService).
import { MinHeap } from './min-heap.js';
import type { Edge, LatLng, Pathfinder, PathResult, RouteMode } from '../types.js';

export class Graph implements Pathfinder {
  private adj = new Map<number, Edge[]>();
  edgeCount = 0;

  addEdge(from: number, to: number, edge: Omit<Edge, 'to'>): void {
    if (!this.adj.has(from)) this.adj.set(from, []);
    this.adj.get(from)!.push({ to, ...edge });
  }

  /** Bidirektionale Kante (Rueckrichtung mit umgekehrter Geometrie). */
  addBidirectional(a: number, b: number, edge: Omit<Edge, 'to'>): void {
    this.addEdge(a, b, edge);
    this.addEdge(b, a, { ...edge, coords: [...edge.coords].reverse() as LatLng[] });
    this.edgeCount++;
  }

  get nodeCount(): number { return this.adj.size; }
  hasNode(n: number): boolean { return this.adj.has(n); }

  dijkstra(start: number, goal: number, mode: RouteMode, edgeFilter?: (e: Edge) => boolean): PathResult | null {
    const key: keyof Edge = mode === 'short' ? 'distKm' : 'timeMin';
    const dist = new Map<number, number>();
    const prev = new Map<number, { from: number; edge: Edge }>();
    const done = new Set<number>();
    dist.set(start, 0);
    const heap = new MinHeap<{ node: number; d: number }>();
    heap.push({ node: start, d: 0 });

    while (heap.size) {
      const cur = heap.pop()!;
      if (done.has(cur.node)) continue;
      done.add(cur.node);
      if (cur.node === goal) break;
      const nbrs = this.adj.get(cur.node);
      if (!nbrs) continue;
      for (const e of nbrs) {
        if (done.has(e.to)) continue;
        if (edgeFilter && !edgeFilter(e)) continue;
        const nd = cur.d + (e[key] as number);
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { from: cur.node, edge: e });
          heap.push({ node: e.to, d: nd });
        }
      }
    }

    if (!prev.has(goal) && start !== goal) return null;

    const nodesSeq: number[] = [goal];
    const edges: Edge[] = [];
    let node = goal;
    while (node !== start) {
      const p = prev.get(node);
      if (!p) break;
      edges.push(p.edge);
      nodesSeq.push(p.from);
      node = p.from;
    }
    nodesSeq.reverse();
    edges.reverse();
    return { nodesSeq, edges };
  }
}
