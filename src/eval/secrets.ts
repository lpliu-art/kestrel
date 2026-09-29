export const MISSING_API_KEY_MESSAGE =
  "TYPESAFE_API_KEY is missing. Add it as a GitHub Actions repository secret named TYPESAFE_API_KEY. This command does not print the secret.";

export function needsApiKey(provider: string): boolean {
  return provider === "typesafe" || provider === "http";
}

export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}
