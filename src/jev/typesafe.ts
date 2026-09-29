import {
  APIError,
  AuthenticationError,
  InternalServerError,
  RateLimitError,
  TypeSafeClient,
  UnprocessableEntityError,
} from "@typesafe-ai/sdk";
import { KestrelError } from "../util/errors.ts";
import type { JevProvider, JevResponse } from "./types.ts";

export interface TypeSafeProviderOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Clamped to info. The SDK prints request bodies at debug. */
  logLevel?: "debug" | "info" | "warn" | "error" | "off";
}

export function createTypeSafeProvider(
  options: TypeSafeProviderOptions = {},
): JevProvider {
  if (!options.apiKey && !process.env.TYPESAFE_API_KEY) {
    throw new KestrelError(
      "Missing TYPESAFE_API_KEY. Real reviews need a TypeSafe API key. Use --provider mock for an offline demo (not an AI judgment), or set TYPESAFE_API_KEY and retry.",
      3,
      "auth",
    );
  }
  const requested = options.logLevel ?? "warn";
  const logLevel = requested === "debug" ? "info" : requested;
  let client: TypeSafeClient;
  try {
    client = new TypeSafeClient({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options.model ? { defaultModel: options.model } : {}),
      timeout: options.timeoutMs ?? 10_000,
      logLevel,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  } catch (error) {
    throw new KestrelError(
      `TypeSafe SDK could not start: ${(error as Error).message}`,
      3,
      "auth",
    );
  }
  return {
    name: "typesafe",
    isAI: true,
    async ask(req, call) {
      try {
        const result = await client.systemOne(
          {
            model: req.model,
            state: req.state,
            questions: req.questions,
          } as Parameters<TypeSafeClient["systemOne"]>[0],
          call?.signal ? { signal: call.signal } : undefined,
        );
        const response: JevResponse = {
          model: result.model,
          answers: result.answers as JevResponse["answers"],
          usage: {
            input_tokens: result.usage.input_tokens,
            output_tokens: result.usage.output_tokens,
          },
          meta: { provider: "typesafe" },
        };
        return response;
      } catch (error) {
        throw mapSdkError(error);
      }
    },
    async listModels() {
      const models = await client.models.list();
      return models.map((model) => model.name);
    },
  };
}

export function mapSdkError(error: unknown): KestrelError {
  if (error instanceof KestrelError) return error;
  if (
    error instanceof AuthenticationError ||
    (error instanceof APIError && error.status === 401)
  ) {
    return new KestrelError(
      "TypeSafe API rejected TYPESAFE_API_KEY (HTTP 401).",
      3,
      "auth",
    );
  }
  if (
    error instanceof UnprocessableEntityError ||
    (error instanceof APIError && error.status === 422)
  ) {
    return new KestrelError(
      `TypeSafe rejected the question payload (HTTP 422): ${(error as Error).message}`,
      3,
      "validation",
    );
  }
  if (
    error instanceof RateLimitError ||
    (error instanceof APIError && error.status === 429)
  ) {
    return new KestrelError(
      `TypeSafe rate limit (HTTP 429): ${(error as Error).message}`,
      3,
      "rate",
    );
  }
  if (
    error instanceof InternalServerError ||
    (error instanceof APIError && error.status === 529)
  ) {
    return new KestrelError(
      `TypeSafe overloaded (HTTP ${(error as APIError).status}).`,
      3,
      "rate",
    );
  }
  if (error instanceof APIError) {
    return new KestrelError(
      `TypeSafe HTTP ${error.status}: ${error.message}`,
      3,
      "provider",
    );
  }
  return new KestrelError(
    `TypeSafe request failed: ${(error as Error).message}`,
    3,
    "provider",
  );
}
