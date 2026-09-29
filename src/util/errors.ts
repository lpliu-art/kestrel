export type ErrorCategory =
  | "config"
  | "usage"
  | "auth"
  | "provider"
  | "validation"
  | "rate";

export class KestrelError extends Error {
  readonly exitCode: 2 | 3 | 4;
  readonly category: ErrorCategory;

  constructor(message: string, exitCode: 2 | 3 | 4, category: ErrorCategory) {
    super(message);
    this.name = "KestrelError";
    this.exitCode = exitCode;
    this.category = category;
  }
}

export function isKestrelError(error: unknown): error is KestrelError {
  return error instanceof KestrelError;
}
