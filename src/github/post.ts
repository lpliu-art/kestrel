import { readFile } from "node:fs/promises";
import type { Report } from "../report/model.ts";
import { KestrelError } from "../util/errors.ts";

export const SUMMARY_MARKER = "<!-- kestrel:summary -->";

export function fingerprintMarker(fingerprint: string): string {
  return `<!-- kestrel:fp=${fingerprint} -->`;
}

export function extractFingerprints(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/<!-- kestrel:fp=([a-f0-9]+) -->/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

export type ReviewEvent = "COMMENT" | "REQUEST_CHANGES";

export function chooseEvent(input: {
  requested: "auto" | ReviewEvent;
  decision: Report["verdict"]["decision"];
}): ReviewEvent {
  if (input.requested === "COMMENT" || input.requested === "REQUEST_CHANGES")
    return input.requested;
  return input.decision === "request_changes" ? "REQUEST_CHANGES" : "COMMENT";
}

export function downgradeEvent(status: number, body: string): boolean {
  if (status !== 403 && status !== 422) return false;
  return /request changes|not permitted|resource not accessible|can not approve|cannot approve/i.test(
    body,
  );
}

export interface InlineComment {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

export interface PostPlan {
  event: ReviewEvent;
  comments: InlineComment[];
  summary: string;
  skippedDuplicates: number;
  folded: number;
  resolved: string[];
}

export function planPost(input: {
  report: Report;
  existingBodies: string[];
  addedLines: Map<string, Set<number>> | undefined;
  summaryOnly: boolean;
  event: "auto" | ReviewEvent;
  summaryBody: string;
}): PostPlan {
  const known = new Set(input.existingBodies.flatMap(extractFingerprints));
  const current = new Set(
    input.report.findings
      .filter((finding) => finding.band === "report")
      .map((finding) => finding.fingerprint),
  );
  const resolved = [...known].filter(
    (fingerprint) => !current.has(fingerprint),
  );
  const comments: InlineComment[] = [];
  const folded: string[] = [];
  let skippedDuplicates = 0;
  for (const finding of input.report.findings) {
    if (finding.band !== "report") continue;
    if (known.has(finding.fingerprint)) {
      skippedDuplicates += 1;
      continue;
    }
    const lineOk =
      input.addedLines
        ?.get(finding.location.path)
        ?.has(finding.location.startLine) ?? false;
    const body = `${finding.message}\n\n${fingerprintMarker(finding.fingerprint)}`;
    if (!input.summaryOnly && input.addedLines && lineOk) {
      comments.push({
        path: finding.location.path,
        line: finding.location.startLine,
        side: "RIGHT",
        body,
      });
    } else {
      folded.push(
        `- \`${finding.location.path}:${finding.location.startLine}\` ${finding.message}\n\n${fingerprintMarker(finding.fingerprint)}`,
      );
    }
  }
  const resolvedBlock =
    resolved.length > 0
      ? `\n\nResolved fingerprints: ${resolved.join(", ")}`
      : "";
  const foldedBlock = folded.length > 0 ? `\n\n${folded.join("\n")}` : "";
  return {
    event: chooseEvent({
      requested: input.event,
      decision: input.report.verdict.decision,
    }),
    comments,
    summary: `${input.summaryBody}${foldedBlock}${resolvedBlock}`,
    skippedDuplicates,
    folded: folded.length,
    resolved,
  };
}

export interface GitHubPostOptions {
  report: Report;
  summaryBody: string;
  repository: string;
  pr: number;
  token: string;
  event: "auto" | ReviewEvent;
  summaryOnly: boolean;
  sticky: boolean;
  strict: boolean;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

export interface GitHubPostResult {
  exitCode: number;
  warnings: string[];
  postedComments: number;
  skippedDuplicates: number;
  event: ReviewEvent;
  downgraded: boolean;
}

export async function postGitHubReview(
  options: GitHubPostOptions,
): Promise<GitHubPostResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const base = options.apiBase ?? "https://api.github.com";
  const root = `${base}/repos/${options.repository}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${options.token}`,
    "Content-Type": "application/json",
    "User-Agent": "kestrel-review",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const [reviewComments, issueComments, reviews, files] = await Promise.all([
      getJson(fetchImpl, `${root}/pulls/${options.pr}/comments`, headers),
      getJson(fetchImpl, `${root}/issues/${options.pr}/comments`, headers),
      getJson(fetchImpl, `${root}/pulls/${options.pr}/reviews`, headers),
      getJson(fetchImpl, `${root}/pulls/${options.pr}/files`, headers),
    ]);
    const bodies = [
      ...bodiesFrom(reviewComments),
      ...bodiesFrom(issueComments),
      ...bodiesFrom(reviews),
    ];
    const addedLines = addedFromFiles(files);
    if (!addedLines) {
      warnings.push(
        "Could not read the pull request diff; inline comments were folded into the summary.",
      );
    }
    const plan = planPost({
      report: options.report,
      existingBodies: bodies,
      addedLines,
      summaryOnly: options.summaryOnly,
      event: options.event,
      summaryBody: options.summaryBody,
    });
    let event = plan.event;
    let downgraded = false;
    const shouldReview =
      plan.comments.length > 0 ||
      event === "REQUEST_CHANGES" ||
      (plan.folded > 0 && !options.sticky);
    if (shouldReview) {
      const posted = await sendReview(
        fetchImpl,
        `${root}/pulls/${options.pr}/reviews`,
        headers,
        event,
        plan,
      );
      if (posted.downgrade) {
        downgraded = true;
        event = "COMMENT";
        warnings.push(
          "REQUEST_CHANGES is not permitted for this token; posted COMMENT instead.",
        );
        const retry = await sendReview(
          fetchImpl,
          `${root}/pulls/${options.pr}/reviews`,
          headers,
          "COMMENT",
          plan,
        );
        if (!retry.ok)
          warnings.push(retry.warning ?? "GitHub review post failed.");
      } else if (!posted.ok) {
        warnings.push(posted.warning ?? "GitHub review post failed.");
      }
    }
    if (options.sticky) {
      const stickyWarning = await upsertSticky(
        fetchImpl,
        root,
        options.pr,
        headers,
        issueComments,
        plan.summary,
      );
      if (stickyWarning) warnings.push(stickyWarning);
    }
    const failed = warnings.some((warning) => /failed/i.test(warning));
    return {
      exitCode: failed && options.strict ? 4 : 0,
      warnings,
      postedComments: plan.comments.length,
      skippedDuplicates: plan.skippedDuplicates,
      event,
      downgraded,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`GitHub API request failed: ${message}`);
    return {
      exitCode: options.strict ? 4 : 0,
      warnings,
      postedComments: 0,
      skippedDuplicates: 0,
      event: chooseEvent({
        requested: options.event,
        decision: options.report.verdict.decision,
      }),
      downgraded: false,
    };
  }
}

export async function pullRequestNumber(
  explicit: number | undefined,
  eventPath: string | undefined,
): Promise<number> {
  if (explicit && Number.isFinite(explicit)) return explicit;
  if (!eventPath)
    throw new KestrelError("Pass --pr or set GITHUB_EVENT_PATH.", 2, "usage");
  const raw = JSON.parse(await readFile(eventPath, "utf8")) as {
    pull_request?: { number?: number };
    number?: number;
  };
  const number = raw.pull_request?.number ?? raw.number;
  if (!number)
    throw new KestrelError(
      "GITHUB_EVENT_PATH does not contain a pull request number.",
      2,
      "usage",
    );
  return number;
}

async function sendReview(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  event: ReviewEvent,
  plan: PostPlan,
): Promise<{ ok: boolean; downgrade: boolean; warning?: string }> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      event,
      body: plan.summary,
      comments: plan.comments,
    }),
  });
  if (response.ok) return { ok: true, downgrade: false };
  const text = await response.text();
  if (event === "REQUEST_CHANGES" && downgradeEvent(response.status, text))
    return { ok: false, downgrade: true };
  return {
    ok: false,
    downgrade: false,
    warning: `GitHub review post failed (${response.status}).`,
  };
}

async function upsertSticky(
  fetchImpl: typeof fetch,
  root: string,
  pr: number,
  headers: Record<string, string>,
  existing: unknown,
  body: string,
): Promise<string | undefined> {
  const comments = Array.isArray(existing) ? existing : [];
  const sticky = comments.find(
    (comment) =>
      comment &&
      typeof comment === "object" &&
      "body" in comment &&
      typeof comment.body === "string" &&
      comment.body.includes(SUMMARY_MARKER) &&
      "id" in comment,
  ) as { id?: number } | undefined;
  const response = sticky?.id
    ? await fetchImpl(`${root}/issues/comments/${sticky.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ body }),
      })
    : await fetchImpl(`${root}/issues/${pr}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body }),
      });
  if (response.ok) return undefined;
  return `GitHub summary comment failed (${response.status}).`;
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) return undefined;
  return response.json();
}

function bodiesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || !("body" in item)) return [];
    return typeof item.body === "string" ? [item.body] : [];
  });
}

function addedFromFiles(value: unknown): Map<string, Set<number>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const map = new Map<string, Set<number>>();
  for (const file of value) {
    if (!file || typeof file !== "object") continue;
    const filename =
      "filename" in file && typeof file.filename === "string"
        ? file.filename
        : undefined;
    const patch =
      "patch" in file && typeof file.patch === "string" ? file.patch : "";
    if (!filename) continue;
    map.set(filename, addedLinesInPatch(patch));
  }
  return map;
}

export function addedLinesInPatch(patch: string): Set<number> {
  const lines = new Set<number>();
  let cursor = 0;
  for (const line of patch.split("\n")) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header?.[1]) {
      cursor = Number(header[1]);
      continue;
    }
    if (!cursor) continue;
    if (line.startsWith("+")) {
      lines.add(cursor);
      cursor += 1;
    } else if (line.startsWith("-")) {
    } else if (line.startsWith("\\")) {
    } else {
      cursor += 1;
    }
  }
  return lines;
}
