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
