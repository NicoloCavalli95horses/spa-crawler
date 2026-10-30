/** Distanzia di almeno `delayMs` le richieste che passano da qui, anche se arrivano da più tab insieme. */
export class RequestThrottle {
  private nextSlot = 0;

  constructor(private delayMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);   // lo slot si prenota in modo sincrono: nessuna corsa tra tab
    this.nextSlot = slot + this.delayMs;
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  }
}
