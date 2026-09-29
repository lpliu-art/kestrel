export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const bytes = Buffer.byteLength(text, "utf8");
  return Math.max(1, Math.ceil(bytes / 3.5));
}

export function estimateRequestTokens(
  state: unknown,
  questions: unknown,
): number {
  return estimateTokens(state) + estimateTokens(questions);
}
