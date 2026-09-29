export class BudgetGuard {
  spent = 0;

  constructor(private readonly maxInputTokens: number) {}

  canSpend(estimate: number): boolean {
    return this.spent + estimate <= this.maxInputTokens;
  }

  spend(tokens: number): void {
    this.spent += tokens;
  }
}

/** Caps how many provider calls a run may make. The check is synchronous. */
export class RequestGuard {
  sent = 0;

  constructor(readonly max: number) {}

  canSend(): boolean {
    return this.sent < this.max;
  }

  spend(): void {
    this.sent += 1;
  }
}
