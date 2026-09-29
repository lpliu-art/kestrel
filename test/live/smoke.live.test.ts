import { describe, expect, it } from "vitest";
import { createTypeSafeProvider } from "../../src/jev/typesafe.ts";

const key = process.env.TYPESAFE_API_KEY;

describe("live jev", () => {
  it.skipIf(!key)("reviews one unit when TYPESAFE_API_KEY is set", async () => {
    const provider = createTypeSafeProvider({
      apiKey: key,
      model: "jev-1.13.0",
    });
    const response = await provider.ask({
      model: "jev-1.13.0",
      state: { hunk: "L1 + const value = 1;" },
      questions: {
        q: {
          type: "noul",
          instructions:
            "Do the added lines in `hunk` contain an obvious defect?",
          criteria: {
            true: { what: "A careful reviewer would flag a defect" },
            false: { what: "Nothing needs a comment" },
          },
        },
      },
    });
    expect(response.model).toBeTruthy();
    expect(response.usage.input_tokens).toBeGreaterThanOrEqual(0);
    expect(response.usage.output_tokens).toBeGreaterThanOrEqual(0);
  });
});
