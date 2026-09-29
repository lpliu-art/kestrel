export interface SecretHit {
  kind: string;
  line: number;
}

export interface RedactResult {
  text: string;
  secrets: SecretHit[];
}

const TOKEN_PATTERNS: Array<{ kind: string; source: string; flags: string }> = [
  {
    kind: "private-key",
    source:
      "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----",
    flags: "g",
  },
  { kind: "aws-key", source: "\\bAKIA[0-9A-Z]{16}\\b", flags: "g" },
  {
    kind: "github-token",
    source:
      "\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\\b|\\bgithub_pat_[A-Za-z0-9_]{20,}\\b",
    flags: "g",
  },
  {
    kind: "slack-token",
    source: "\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b",
    flags: "g",
  },
  { kind: "openai-key", source: "\\bsk-[A-Za-z0-9]{20,}\\b", flags: "g" },
  {
    kind: "connection-string",
    source:
      "\\b(?:postgres|postgresql|mysql|mongodb(?:\\+srv)?|redis|amqp):\\/\\/[^\\s'\"]+",
    flags: "gi",
  },
];

const ASSIGN =
  /\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b(\s*[:=]\s*)(['"])([^'"]{8,})\3/gi;

const PLACEHOLDER =
  /^(?:example|changeme|placeholder|redacted|dummy|fake|todo|test|password|secret|token|your[-_].*|x{4,}|<[^>]+>)$/i;

export function redactText(text: string, line = 1): RedactResult {
  const secrets: SecretHit[] = [];
  let next = text;
  for (const pattern of TOKEN_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    if (!re.test(next)) continue;
    secrets.push({ kind: pattern.kind, line });
    next = next.replace(
      new RegExp(pattern.source, pattern.flags),
      `[REDACTED:${pattern.kind}]`,
    );
  }
  next = next.replace(
    ASSIGN,
    (full, _name: string, sep: string, quote: string, value: string) => {
      if (
        value.includes("[REDACTED:") ||
        PLACEHOLDER.test(value) ||
        value.toLowerCase().includes("example")
      ) {
        return full;
      }
      secrets.push({ kind: "secret", line });
      return `${_name}${sep}${quote}[REDACTED:secret]${quote}`;
    },
  );
  return { text: next, secrets };
}

export function redactLineMap(
  lines: Array<{ line: number; text: string; added: boolean }>,
): { lines: Map<number, string>; secrets: SecretHit[] } {
  const map = new Map<number, string>();
  const secrets: SecretHit[] = [];
  for (const line of lines) {
    const result = redactText(line.text, line.line);
    map.set(line.line, result.text);
    if (line.added) {
      for (const secret of result.secrets) secrets.push(secret);
    }
  }
  return { lines: map, secrets };
}
