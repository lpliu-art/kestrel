import { randomBytes } from "node:crypto";
import type { RequestTrace } from "../pipeline/judge-unit.ts";
import type { Report } from "../report/model.ts";

export async function exportTelemetry(input: {
  endpoint: string;
  traces: RequestTrace[];
  report: Report;
  fetchImpl?: typeof fetch;
}): Promise<string | undefined> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.endpoint.replace(/\/+$/, "");
  const traceId = randomBytes(16).toString("hex");
  const root = randomBytes(8).toString("hex");
  const now = Date.now();
  const spans = [
    span({
      traceId,
      spanId: root,
      name: "review.run",
      startMs: now - input.report.run.durationMs,
      endMs: now,
      attributes: [
        attr("kestrel.requests", input.report.run.requests),
        attr("kestrel.tokens.input", input.report.run.tokens.input),
        attr("kestrel.latency_ms", input.report.run.durationMs),
        attr("kestrel.band.report", input.report.summary.findings.report),
        attr("kestrel.band.uncertain", input.report.summary.findings.uncertain),
        attr("kestrel.model", input.report.provider.model),
      ],
    }),
    ...input.traces.map((trace) =>
      span({
        traceId,
        spanId: randomBytes(8).toString("hex"),
        parentSpanId: root,
        name: trace.pass === 1 ? "unit.pass1" : "unit.pass2",
        startMs: now - trace.latencyMs,
        endMs: now,
        attributes: [
          attr("kestrel.unit", trace.unitId),
          attr("kestrel.cached", trace.cached ? 1 : 0),
          attr("kestrel.tokens.input", trace.usage.input_tokens),
          attr("kestrel.latency_ms", trace.latencyMs),
          attr("kestrel.questions", trace.questionKeys.length),
        ],
      }),
    ),
    span({
      traceId,
      spanId: randomBytes(8).toString("hex"),
      parentSpanId: root,
      name: "render",
      startMs: now,
      endMs: now,
      attributes: [attr("kestrel.findings", input.report.findings.length)],
    }),
  ];
  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: [attr("service.name", "kestrel")],
        },
        scopeSpans: [{ scope: { name: "kestrel" }, spans }],
      },
    ],
  };
  try {
    const response = await fetchImpl(`${base}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return `OpenTelemetry export failed (${response.status})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `OpenTelemetry export failed (${message})`;
  }
  return undefined;
}

function span(input: {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    traceId: input.traceId,
    spanId: input.spanId,
    ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
    name: input.name,
    startTimeUnixNano: String(input.startMs * 1_000_000),
    endTimeUnixNano: String(input.endMs * 1_000_000),
    attributes: input.attributes,
  };
}

function attr(key: string, value: string | number): Record<string, unknown> {
  if (typeof value === "number") {
    return { key, value: { intValue: String(Math.round(value)) } };
  }
  return { key, value: { stringValue: value } };
}
