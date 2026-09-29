import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ViewInput {
  sessions: Array<{ file: string; events: unknown[] }>;
  report?: unknown;
}

export async function loadViewInput(
  sessionDir: string,
  reportPath?: string,
): Promise<ViewInput> {
  let names: string[] = [];
  try {
    names = (await readdir(sessionDir))
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
  } catch {
    names = [];
  }
  const sessions = [];
  for (const name of names) {
    const text = await readFile(join(sessionDir, name), "utf8");
    const events = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
    sessions.push({ file: name, events });
  }
  let report: unknown;
  if (reportPath)
    report = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
  return { sessions, ...(report ? { report } : {}) };
}

export function renderViewer(input: ViewInput): string {
  const payload = JSON.stringify(input).replaceAll("<", "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Kestrel session viewer</title>
<style>
  body { font: 14px/1.45 ui-sans-serif, sans-serif; margin: 24px; color: #1c1917; background: #faf7f2; }
  h1 { font-size: 20px; }
  .unit { border: 1px solid #e7e0d6; background: white; margin: 12px 0; padding: 12px 16px; }
  pre { white-space: pre-wrap; background: #f4efe6; padding: 8px; }
  .muted { color: #78716c; }
</style>
</head>
<body>
<h1>Kestrel session viewer</h1>
<p class="muted">Local file. No network requests. State is shown only when the session was recorded with --log-payload.</p>
<div id="app"></div>
<script id="data" type="application/json">${payload}</script>
<script>
const data = JSON.parse(document.getElementById("data").textContent);
const app = document.getElementById("app");
function esc(value) {
  return String(value ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
}
function block(title, value) {
  if (value === undefined || value === null || value === "") return "";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return "<h3>" + esc(title) + "</h3><pre>" + esc(text) + "</pre>";
}
const units = new Map();
for (const session of data.sessions || []) {
  for (const event of session.events || []) {
    const id = event.unitId || event.path || session.file;
    const list = units.get(id) || [];
    list.push(event);
    units.set(id, list);
  }
}
if (units.size === 0) app.innerHTML = "<p>No session events.</p>";
for (const [id, events] of units) {
  const card = document.createElement("section");
  card.className = "unit";
  let html = "<h2>Unit " + esc(id) + "</h2>";
  for (const event of events) {
    html += "<p><strong>" + esc(event.type || "event") + "</strong>";
    if (event.pass) html += " pass " + esc(event.pass);
    if (event.latencyMs !== undefined) html += " · " + esc(event.latencyMs) + " ms";
    if (event.model) html += " · " + esc(event.model);
    html += "</p>";
    html += block("questions", event.questions || event.questionKeys);
    html += block("answers", event.answers);
    html += block("state", event.state || "(omitted)");
  }
  card.innerHTML = html;
  app.appendChild(card);
}
if (data.report && Array.isArray(data.report.findings)) {
  const card = document.createElement("section");
  card.className = "unit";
  let html = "<h2>Report traces</h2>";
  for (const finding of data.report.findings) {
    html += "<h3>" + esc(finding.ruleId) + " " + esc(finding.location && finding.location.path) + ":" + esc(finding.location && finding.location.startLine) + "</h3>";
    html += "<p>" + esc(finding.message) + "</p>";
    html += block("trace", finding.trace);
  }
  card.innerHTML = html;
  app.appendChild(card);
}
</script>
</body>
</html>
`;
}

export async function writeViewer(options: {
  sessionDir: string;
  reportPath?: string;
  outPath: string;
}): Promise<string> {
  const input = await loadViewInput(options.sessionDir, options.reportPath);
  const html = renderViewer(input);
  await writeFile(options.outPath, html);
  return options.outPath;
}
