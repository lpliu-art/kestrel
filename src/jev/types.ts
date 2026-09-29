import type { JsonValue } from "../util/json.ts";

export type Structured = string | { [key: string]: JsonValue } | JsonValue[];

export type JevQuestion =
  | {
      type: "noul";
      instructions: Structured;
      criteria?: { true?: Structured; false?: Structured };
    }
  | {
      type: "choice";
      instructions: Structured;
      criteria: Record<string, Structured | null>;
    }
  | {
      type: "score";
      instructions: Structured;
      criteria: Structured[];
    };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    }
  | {
      type: "score";
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    };

export interface JevRequest {
  model: string;
  state: JsonValue;
  questions: Record<string, JevQuestion>;
}

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  meta?: { provider: string; cached?: boolean; latencyMs?: number };
}

export interface JevProvider {
  readonly name: string;
  readonly isAI: boolean;
  ask(req: JevRequest, opts?: { signal?: AbortSignal }): Promise<JevResponse>;
  listModels?(): Promise<string[]>;
}

export interface ProviderStats {
  requests: number;
  cachedRequests: number;
  inputTokens: number;
  outputTokens: number;
}

export function emptyStats(): ProviderStats {
  return { requests: 0, cachedRequests: 0, inputTokens: 0, outputTokens: 0 };
}
