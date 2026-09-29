import {
  type ResolvedApiKey,
  readSkipKeyPrompt,
  resolveApiKey,
  writeCredentials,
  writeSkipKeyPrompt,
} from "./credentials.ts";
import { keyPromptMessage, promptHidden } from "./prompt.ts";

export interface OnboardOptions {
  env?: NodeJS.ProcessEnv;
  /** Both stdin and stdout are TTYs. */
  interactive: boolean;
  ci: boolean;
  lang?: "zh-CN" | "en";
  /** Injected in tests. */
  prompt?: (message: string) => Promise<string>;
}

export interface OnboardResult extends ResolvedApiKey {
  warnings: string[];
}

/**
 * Resolve a key for a review run. On a first interactive run with no key,
 * ask once (hidden). Empty Enter skips and remembers the skip in user config.
 * Never prompts in CI or non-interactive runs.
 */
export async function resolveApiKeyForRun(
  options: OnboardOptions,
): Promise<OnboardResult> {
  const env = options.env ?? process.env;
  const lang = options.lang ?? "zh-CN";
  const warnings: string[] = [];
  const existing = resolveApiKey(env);
  if (existing.key) return { ...existing, warnings };

  const mayPrompt =
    options.interactive && !options.ci && !readSkipKeyPrompt(env);
  const canPrompt = Boolean(options.prompt) || Boolean(process.stdin.isTTY);
  if (!mayPrompt || !canPrompt) {
    return { key: undefined, source: "none", warnings };
  }

  const prompt = options.prompt ?? promptHidden;
  let answer: string;
  try {
    answer = (await prompt(keyPromptMessage(lang))).trim();
  } catch {
    return { key: undefined, source: "none", warnings };
  }

  if (!answer) {
    writeSkipKeyPrompt(true, env);
    warnings.push(
      lang === "en"
        ? "No API key entered; continuing with the mock provider. Results are not AI judgments. Run kestrel auth set to store a key, or set TYPESAFE_API_KEY."
        : "未输入 API 密钥，已改用 mock。结果不是 AI 判断。可用 kestrel auth set 保存密钥，或设置 TYPESAFE_API_KEY。",
    );
    return { key: undefined, source: "none", warnings };
  }

  const path = writeCredentials(answer, env);
  return { key: answer, source: "file", path, warnings };
}
