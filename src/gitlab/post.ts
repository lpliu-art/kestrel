import {
  addedLinesInPatch,
  planPost,
  type ReviewEvent,
} from "../github/post.ts";
import type { Report } from "../report/model.ts";

export interface GitLabPostOptions {
  report: Report;
  summaryBody: string;
  project: string;
  mr: number;
  token: string;
  summaryOnly: boolean;
  strict: boolean;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

export interface GitLabPostResult {
  exitCode: number;
  warnings: string[];
  postedComments: number;
  skippedDuplicates: number;
  event: ReviewEvent;
}

interface VersionShas {
  base: string;
  start: string;
  head: string;
}

export async function postGitLabReview(
  options: GitLabPostOptions,
): Promise<GitLabPostResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const base = (options.apiBase ?? "https://gitlab.com/api/v4").replace(
    /\/+$/,
    "",
  );
  const root = `${base}/projects/${encodeURIComponent(options.project)}/merge_requests/${options.mr}`;
  const headers = {
    "PRIVATE-TOKEN": options.token,
    "Content-Type": "application/json",
  };
  try {
    const [discussions, notes, versions] = await Promise.all([
      getJson(fetchImpl, `${root}/discussions`, headers),
      getJson(fetchImpl, `${root}/notes`, headers),
      getJson(fetchImpl, `${root}/versions`, headers),
    ]);
    const shas = shasFrom(versions);
    const addedLines = addedFromVersions(versions);
    if (!shas) {
      warnings.push(
        "Could not read merge request versions; inline discussions were folded into the summary.",
      );
    }
    const plan = planPost({
      report: options.report,
      existingBodies: [...bodiesFrom(discussions), ...bodiesFrom(notes)],
      addedLines: shas ? addedLines : undefined,
      summaryOnly: options.summaryOnly || !shas,
      event: "auto",
      summaryBody: options.summaryBody,
    });
    let posted = 0;
    const folded: string[] = [];
    for (const comment of plan.comments) {
      const response = await fetchImpl(`${root}/discussions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          body: comment.body,
          position: {
            position_type: "text",
            base_sha: shas?.base,
            start_sha: shas?.start,
            head_sha: shas?.head,
            old_path: comment.path,
            new_path: comment.path,
            new_line: comment.line,
          },
        }),
      });
      if (response.ok) {
        posted += 1;
        continue;
      }
      folded.push(
        `- \`${comment.path}:${comment.line}\` discussion failed (${response.status})`,
      );
    }
    if (folded.length > 0) {
      warnings.push(
        "Some inline discussions were rejected; they were added to the summary.",
      );
    }
    const summary = `${plan.summary}${folded.length > 0 ? `\n\n${folded.join("\n")}` : ""}`;
    const noteWarning = await upsertNote(
      fetchImpl,
      root,
      headers,
      notes,
      summary,
    );
    if (noteWarning) warnings.push(noteWarning);
    const failed = warnings.some((warning) => /failed/i.test(warning));
    return {
      exitCode: failed && options.strict ? 4 : 0,
      warnings,
      postedComments: posted,
      skippedDuplicates: plan.skippedDuplicates,
      event: plan.event,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`GitLab API request failed: ${message}`);
    return {
      exitCode: options.strict ? 4 : 0,
      warnings,
      postedComments: 0,
      skippedDuplicates: 0,
      event: "COMMENT",
    };
  }
}

async function upsertNote(
  fetchImpl: typeof fetch,
  root: string,
  headers: Record<string, string>,
  existing: unknown,
  body: string,
): Promise<string | undefined> {
  const notes = Array.isArray(existing) ? existing : [];
  const sticky = notes.find(
    (note) =>
      note &&
      typeof note === "object" &&
      "body" in note &&
      typeof note.body === "string" &&
      note.body.includes("<!-- kestrel:summary -->") &&
      "id" in note,
  ) as { id?: number } | undefined;
  const response = sticky?.id
    ? await fetchImpl(`${root}/notes/${sticky.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ body }),
      })
    : await fetchImpl(`${root}/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body }),
      });
  if (response.ok) return undefined;
  return `GitLab summary note failed (${response.status}).`;
}

function shasFrom(value: unknown): VersionShas | undefined {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object")
    return undefined;
  const version = value[0] as {
    base_commit_sha?: unknown;
    start_commit_sha?: unknown;
    head_commit_sha?: unknown;
  };
  if (
    typeof version.base_commit_sha !== "string" ||
    typeof version.start_commit_sha !== "string" ||
    typeof version.head_commit_sha !== "string"
  ) {
    return undefined;
  }
  return {
    base: version.base_commit_sha,
    start: version.start_commit_sha,
    head: version.head_commit_sha,
  };
}

function addedFromVersions(
  value: unknown,
): Map<string, Set<number>> | undefined {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object")
    return undefined;
  const diffs = (value[0] as { diffs?: unknown }).diffs;
  if (!Array.isArray(diffs)) return new Map();
  const map = new Map<string, Set<number>>();
  for (const diff of diffs) {
    if (!diff || typeof diff !== "object") continue;
    const path =
      "new_path" in diff && typeof diff.new_path === "string"
        ? diff.new_path
        : undefined;
    const patch =
      "diff" in diff && typeof diff.diff === "string" ? diff.diff : "";
    if (!path) continue;
    map.set(path, addedLinesInPatch(patch));
  }
  return map;
}

function bodiesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const bodies: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    if ("body" in item && typeof item.body === "string") bodies.push(item.body);
    if ("notes" in item && Array.isArray(item.notes)) {
      for (const note of item.notes) {
        if (
          note &&
          typeof note === "object" &&
          "body" in note &&
          typeof note.body === "string"
        ) {
          bodies.push(note.body);
        }
      }
    }
  }
  return bodies;
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
