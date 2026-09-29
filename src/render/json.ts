import type { Report } from "../report/model.ts";
import { stableStringify } from "../util/json.ts";

export function renderJson(report: Report): string {
  return stableStringify(report);
}
