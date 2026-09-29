import type { LlmRewrite } from "./parse.ts";
import { parseRewrite } from "./parse.ts";

export type LlmProtocol = "openai" | "anthropic";

export interface LlmCall {
  protocol: LlmProtocol;
  baseURL: string;
  model: string;
  apiKey: string;
  prompt: string;
  fetchImpl?: typeof fetch;
}

export async function completeNarration(input: LlmCall): Promise<LlmRewrite> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.baseURL.replace(/\/+$/, "");
  const response =
    input.protocol === "anthropic"
      ? await fetchImpl(anthropicUrl(base), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": input.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: input.model,
            max_tokens: 800,
            messages: [{ role: "user", content: input.prompt }],
          }),
        })
      : await fetchImpl(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${input.apiKey}`,
          },
          body: JSON.stringify({
            model: input.model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: input.prompt }],
          }),
        });
  if (!response.ok) {
    throw new Error(`LLM request failed (${response.status})`);
  }
  const body = (await response.json()) as unknown;
  const text =
    input.protocol === "anthropic" ? anthropicText(body) : openaiText(body);
  const rewrite = parseRewrite(text);
  if (!rewrite) throw new Error("LLM response was not the expected JSON");
  return rewrite;
}

function anthropicUrl(base: string): string {
  return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
}

function openaiText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const message = (
    choices[0] as { message?: { content?: unknown } } | undefined
  )?.message;
  return typeof message?.content === "string" ? message.content : "";
}

function anthropicText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const first = content[0] as { text?: unknown } | undefined;
  return typeof first?.text === "string" ? first.text : "";
}
