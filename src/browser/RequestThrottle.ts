/** Spaces the requests passing through here at least `delayMs` apart, even when they come from several tabs at once. */
export class RequestThrottle {
  private nextSlot = 0;

  constructor(private delayMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);   // the slot is booked synchronously: no race between tabs
    this.nextSlot = slot + this.delayMs;
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  }
}
