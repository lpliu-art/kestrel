import picomatch from "picomatch";
import type { ReviewUnit } from "../units/build.ts";
import type { LoadedRule } from "./schema.ts";

export interface Anchor {
  line: number;
  text: string;
  groups: string[];
}

export interface TriggerMatch {
  matched: boolean;
  anchors: Anchor[];
  suppressed: boolean;
}

const IGNORE_RE = /kestrel-ignore(?:\s+(\S+))?/;

export function matchTrigger(rule: LoadedRule, unit: ReviewUnit): TriggerMatch {
  if (rule.deprecated || rule.deterministic)
    return { matched: false, anchors: [], suppressed: false };
  if (!applies(rule, unit))
    return { matched: false, anchors: [], suppressed: false };
  if (rule.trigger.kind === "always" || rule.trigger.kind === "removed") {
    if (
      rule.trigger.kind === "removed" &&
      !unit.lines.some((line) => line.kind === "deleted")
    ) {
      return { matched: false, anchors: [], suppressed: false };
    }
    const suppressed = unit.addedLineNumbers.some((line) =>
      isSuppressed(rule.id, line, unit.sourceLines),
    );
    return { matched: !suppressed, anchors: [], suppressed };
  }
  const on = rule.trigger.on ?? "added";
  const pool = unit.lines.filter((line) => {
    if (on === "added") return line.kind === "added";
    if (on === "removed") return line.kind === "deleted";
    return line.kind === "added" || line.kind === "deleted";
  });
  const regex = compileRegex(rule.trigger.pattern ?? "", rule.trigger.flags);
  if (!regex) return { matched: false, anchors: [], suppressed: false };
  const anchors: Anchor[] = [];
  for (const line of pool) {
    const lineNo = line.kind === "deleted" ? undefined : line.newNo;
    if (lineNo !== undefined && isSuppressed(rule.id, lineNo, unit.sourceLines))
      continue;
    regex.lastIndex = 0;
    const match = regex.exec(line.text);
    if (match && lineNo !== undefined) {
      anchors.push({
        line: lineNo,
        text: line.text,
        groups: match.slice(1).map((part) => part ?? ""),
      });
    }
  }
  if (anchors.length === 0) {
    const joined = pool.map((line) => line.text).join("\n");
    regex.lastIndex = 0;
    const match = regex.exec(joined);
    if (match) {
      const offset = joined.slice(0, match.index).split("\n").length - 1;
      const line = pool[offset];
      const lineNo = line?.newNo;
      if (
        line &&
        lineNo !== undefined &&
        !isSuppressed(rule.id, lineNo, unit.sourceLines)
      ) {
        anchors.push({
          line: lineNo,
          text: line.text,
          groups: match.slice(1).map((part) => part ?? ""),
        });
      }
    }
  }
  return { matched: anchors.length > 0, anchors, suppressed: false };
}

export function applies(rule: LoadedRule, unit: ReviewUnit): boolean {
  const languages = rule.applies?.languages;
  if (languages && languages.length > 0 && !languages.includes(unit.languageId))
    return false;
  const paths = rule.applies?.paths;
  if (paths && paths.length > 0) {
    const norm = unit.path.replaceAll("\\", "/");
    const ok = paths.some((pattern) =>
      picomatch(pattern, { dot: true, nocase: true })(norm),
    );
    if (!ok) return false;
  }
  const frameworks = rule.applies?.frameworks;
  if (
    frameworks &&
    frameworks.length > 0 &&
    !frameworks.some((item) => unit.frameworks.includes(item))
  ) {
    return false;
  }
  if (
    rule.applies?.minAddedLines &&
    unit.addedLineNumbers.length < rule.applies.minAddedLines
  )
    return false;
  return true;
}

export function isSuppressed(
  ruleId: string,
  lineNo: number,
  sourceLines: string[],
): boolean {
  const texts = [sourceLines[lineNo - 1] ?? "", sourceLines[lineNo - 2] ?? ""];
  return texts.some((text) => {
    const match = IGNORE_RE.exec(text);
    if (!match) return false;
    if (!match[1]) return true;
    return match[1] === ruleId;
  });
}

export function compileRegex(
  pattern: string,
  flags?: string,
): RegExp | undefined {
  const clean = (flags ?? "").replace(/g/g, "");
  try {
    return new RegExp(pattern, clean);
  } catch {
    return undefined;
  }
}

export function lineHits(rule: LoadedRule, text: string): boolean {
  if (rule.trigger.kind !== "regex" || !rule.trigger.pattern) return false;
  const regex = compileRegex(rule.trigger.pattern, rule.trigger.flags);
  if (!regex) return false;
  return regex.test(text);
}
