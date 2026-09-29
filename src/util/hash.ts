import { createHash } from "node:crypto";
import { canonicalJSON } from "./json.ts";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

export function requestHash(req: {
  model: string;
  state: unknown;
  questions: unknown;
}): string {
  return sha256(
    canonicalJSON({
      model: req.model,
      questions: req.questions,
      state: req.state,
    }),
  );
}
