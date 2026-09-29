import { Query } from "web-tree-sitter";
import type { ReviewUnit } from "../units/build.ts";
import { parseStateHunk } from "../units/state.ts";
import { grammarReady, languageFor, parseLanguage } from "./runtime.ts";

export interface TreesitterAnchor {
  line: number;
  text: string;
  groups: string[];
  captures: Record<string, string>;
}

export interface TreesitterRule {
  trigger: { kind: string; query?: string; pattern?: string; flags?: string };
  applies?: { languages?: string[] };
}

export function matchTreesitter(
  rule: TreesitterRule,
  unit: ReviewUnit,
): { available: boolean; anchors: TreesitterAnchor[] } {
  const queryText = rule.trigger.query;
  if (!queryText) return { available: false, anchors: [] };
  const languageId = unit.languageId;
  if (!grammarReady(languageId)) return { available: false, anchors: [] };
  const source = unit.sourceLines.join("\n");
  const hits = queryHits(languageId, queryText, source);
  if (!hits) return { available: false, anchors: [] };
  const added = new Set(unit.addedLineNumbers);
  const anchors = hits
    .map((hit) => toAnchor(hit, added))
    .filter((anchor): anchor is TreesitterAnchor => anchor !== undefined);
  return { available: true, anchors };
}

export function treesitterHunkHit(
  rule: TreesitterRule,
  hunk: string,
): boolean | undefined {
  if (rule.trigger.kind !== "treesitter" || !rule.trigger.query)
    return undefined;
  const languageId = rule.applies?.languages?.find((id) => grammarReady(id));
  if (!languageId) return undefined;
  const source = reconstructSource(hunk);
  const hits = queryHits(languageId, rule.trigger.query, source);
  if (!hits) return undefined;
  const added = new Set(
    parseStateHunk(hunk)
      .added.map((line) => line.no)
      .filter((no): no is number => no !== undefined),
  );
  return hits.some((hit) => rangeIntersects(hit.startLine, hit.endLine, added));
}

interface Hit {
  startLine: number;
  endLine: number;
  text: string;
  captures: Record<string, string>;
  groups: string[];
}

function queryHits(
  languageId: string,
  queryText: string,
  source: string,
): Hit[] | undefined {
  const language = languageFor(languageId);
  if (!language) return undefined;
  const tree = parseLanguage(languageId, source);
  if (!tree) return undefined;
  try {
    const query = new Query(language, queryText);
    const hits: Hit[] = [];
    for (const match of query.matches(tree.rootNode)) {
      const captures: Record<string, string> = {};
      const groups: string[] = [];
      let primary = match.captures[0]?.node;
      for (const capture of match.captures) {
        captures[capture.name] = capture.node.text;
        groups.push(capture.node.text);
        if (capture.name !== "name") primary = capture.node;
      }
      if (!primary) continue;
      hits.push({
        startLine: primary.startPosition.row + 1,
        endLine: Math.max(
          primary.startPosition.row + 1,
          primary.endPosition.row + (primary.endPosition.column === 0 ? 0 : 1),
        ),
        text: primary.text,
        captures,
        groups,
      });
    }
    query.delete();
    return hits;
  } catch {
    return undefined;
  } finally {
    tree.delete();
  }
}

function toAnchor(hit: Hit, added: Set<number>): TreesitterAnchor | undefined {
  if (!rangeIntersects(hit.startLine, hit.endLine, added)) return undefined;
  let line = hit.startLine;
  for (let cursor = hit.startLine; cursor <= hit.endLine; cursor++) {
    if (added.has(cursor)) {
      line = cursor;
      break;
    }
  }
  return {
    line,
    text: hit.text,
    groups: hit.groups,
    captures: hit.captures,
  };
}

function rangeIntersects(
  start: number,
  end: number,
  added: Set<number>,
): boolean {
  for (const line of added) {
    if (line >= start && line <= end) return true;
  }
  return false;
}

export function reconstructSource(hunk: string): string {
  const rows = new Map<number, string>();
  for (const line of hunk.split("\n")) {
    const added = /^L(\d+) \+ (.*)$/.exec(line);
    if (added?.[1]) {
      rows.set(Number(added[1]), added[2] ?? "");
      continue;
    }
    const context = /^L(\d+) {3}(.*)$/.exec(line);
    if (context?.[1] && !rows.has(Number(context[1])))
      rows.set(Number(context[1]), context[2] ?? "");
  }
  const max = Math.max(0, ...rows.keys());
  const lines: string[] = [];
  for (let no = 1; no <= max; no++) lines.push(rows.get(no) ?? "");
  return lines.join("\n");
}
