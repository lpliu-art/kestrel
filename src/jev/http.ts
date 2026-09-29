import { KestrelError } from "../util/errors.ts";
import type { JevProvider, JevResponse } from "./types.ts";

export interface HttpProviderOptions {
  apiKey?: string;
  baseURL?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRateLimit?: () => void;
}

const sleepDefault = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createHttpProvider(options: HttpProviderOptions): JevProvider {
  const base = (options.baseURL ?? "https://api.typesafe.ai").replace(
    /\/$/,
    "",
  );
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? sleepDefault;
  return {
    name: "http",
    isAI: true,
    async ask(req, call) {
      if (!options.apiKey) {
        throw new KestrelError(
          "Missing TYPESAFE_API_KEY. Real reviews need a TypeSafe API key. Use --provider mock for an offline demo (not an AI judgment), or set TYPESAFE_API_KEY and retry.",
          3,
          "auth",
        );
      }
      let lastError: KestrelError | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          options.timeoutMs ?? 10_000,
        );
        const onAbort = () => controller.abort();
        call?.signal?.addEventListener("abort", onAbort);
        try {
          const response = await doFetch(`${base}/v1/systemone`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${options.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: req.model,
              state: req.state,
              questions: req.questions,
            }),
            signal: controller.signal,
          });
          const body: unknown = await response.json().catch(() => undefined);
          if (response.status === 401) {
            throw new KestrelError(
              "TypeSafe API rejected TYPESAFE_API_KEY (HTTP 401).",
              3,
              "auth",
            );
          }
          if (response.status === 422) {
            throw new KestrelError(
              `TypeSafe rejected the question payload (HTTP 422): ${summarize(body)}`,
              3,
              "validation",
            );
          }
          if (response.status === 429 || response.status === 529) {
            options.onRateLimit?.();
            lastError = new KestrelError(
              `TypeSafe rate limit or overload (HTTP ${response.status}).`,
              3,
              "rate",
            );
            if (attempt < 2) {
              await sleep(200 * 2 ** attempt);
              continue;
            }
            throw lastError;
          }
          if (!response.ok) {
            throw new KestrelError(
              `TypeSafe HTTP ${response.status}: ${summarize(body)}`,
              3,
              "provider",
            );
          }
          return normalize(body, "http");
        } catch (error) {
          if (error instanceof KestrelError) {
            if (error.category === "rate" && attempt < 2) {
              lastError = error;
              continue;
            }
            throw error;
          }
          lastError = new KestrelError(
            `TypeSafe request failed: ${(error as Error).message}`,
            3,
            "provider",
          );
          if (attempt < 2) {
            await sleep(200 * 2 ** attempt);
            continue;
          }
          throw lastError;
        } finally {
          clearTimeout(timer);
          call?.signal?.removeEventListener("abort", onAbort);
        }
      }
      throw (
        lastError ?? new KestrelError("TypeSafe request failed", 3, "provider")
      );
    },
  };
}

export function normalize(body: unknown, provider: string): JevResponse {
  if (!body || typeof body !== "object") {
    throw new KestrelError(
      "TypeSafe response was not a JSON object",
      3,
      "provider",
    );
  }
  const record = body as {
    model?: unknown;
    answers?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  if (
    typeof record.model !== "string" ||
    !record.answers ||
    typeof record.answers !== "object"
  ) {
    throw new KestrelError(
      "TypeSafe response is missing model or answers",
      3,
      "provider",
    );
  }
  return {
    model: record.model,
    answers: record.answers as JevResponse["answers"],
    usage: {
      input_tokens: numberOr(record.usage?.input_tokens),
      output_tokens: numberOr(record.usage?.output_tokens),
    },
    meta: { provider },
  };
}

function numberOr(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function summarize(body: unknown): string {
  if (body === undefined) return "(empty body)";
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.slice(0, 400);
}
