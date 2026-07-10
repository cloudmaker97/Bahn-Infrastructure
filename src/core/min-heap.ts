// Generic binary min-heap. Single responsibility: priority queue (SRP).
export class MinHeap<T extends { d: number }> {
  private a: T[] = [];

  get size(): number { return this.a.length; }

  push(item: T): void {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.d <= a[i]!.d) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }

  pop(): T | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < n && a[l]!.d < a[s]!.d) s = l;
        if (r < n && a[r]!.d < a[s]!.d) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i]!, a[s]!];
        i = s;
      }
    }
    return top;
  }
}
