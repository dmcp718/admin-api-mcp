/**
 * Sliding-window rate limiter.
 */
export class RateLimiter {
  private calls: number[] = [];

  constructor(
    private maxCalls: number = 50,
    private windowMs: number = 60_000,
  ) {}

  check(): boolean {
    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < this.windowMs);
    if (this.calls.length >= this.maxCalls) return false;
    this.calls.push(now);
    return true;
  }

  timeUntilReset(): number {
    if (this.calls.length === 0) return 0;
    return Math.max(0, Math.ceil((this.windowMs - (Date.now() - this.calls[0])) / 1000));
  }
}
