const INJECTION_PATTERNS = [
  /ignore\s+(?:all|any|previous|this)\s+(?:instructions|rules|reviews?|findings?)/i,
  /do\s+not\s+(?:flag|report|review)/i,
  /this\s+(?:code\s+)?is\s+safe/i,
  /ai\s+reviewer/i,
  /please\s+(?:mark|treat|consider)[^\n]{0,60}(?:safe|benign)/i,
  /not\s+a\s+(?:vulnerability|bug|security\s+issue)/i,
  /kestrel[,:\s]+(?:ignore|approve|safe)/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function injectionProbability(text: string): number {
  return looksLikeInjection(text) ? 0.9 : 0.05;
}
