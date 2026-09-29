import { estimateTokens } from "./tokens.ts";
import type { JevProvider } from "./types.ts";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class RateLimiter {
  private hits: number[] = [];
  private tokens = 0;
  private windowStart: number;
  private penaltyUntil = 0;
  private rpm: number;

  constructor(
    private readonly limits: {
      requestsPerMinute: number;
      tokensPerSecond: number;
    },
    private readonly clock: Clock = systemClock,
  ) {
    this.rpm = limits.requestsPerMinute;
    this.windowStart = clock.now();
  }

  penalize(ms = 60_000): void {
    this.rpm = Math.max(1, Math.floor(this.limits.requestsPerMinute / 2));
    this.penaltyUntil = this.clock.now() + ms;
  }

  async acquire(tokens: number): Promise<void> {
    for (;;) {
      if (this.penaltyUntil && this.clock.now() >= this.penaltyUntil) {
        this.rpm = this.limits.requestsPerMinute;
        this.penaltyUntil = 0;
      }
      const wait = this.tryAcquire(Math.max(1, tokens));
      if (wait === 0) return;
      await this.clock.sleep(wait);
    }
  }

  private tryAcquire(tokens: number): number {
    const now = this.clock.now();
    this.hits = this.hits.filter((hit) => now - hit < 60_000);
    if (this.hits.length >= this.rpm) {
      const oldest = this.hits[0] ?? now;
      return Math.max(1, 60_000 - (now - oldest));
    }
    if (now - this.windowStart >= 1000) {
      this.tokens = 0;
      this.windowStart = now;
    }
    if (this.tokens + tokens > this.limits.tokensPerSecond) {
      return Math.max(1, 1000 - (now - this.windowStart));
    }
    this.hits.push(now);
    this.tokens += tokens;
    return 0;
  }
}

export function withRateLimit(
  inner: JevProvider,
  limiter: RateLimiter,
): JevProvider {
  return {
    name: inner.name,
    isAI: inner.isAI,
    async ask(req, opts) {
      await limiter.acquire(estimateTokens(req));
      return inner.ask(req, opts);
    },
    listModels: inner.listModels?.bind(inner),
  };
}
