export interface TemplateVars {
  [key: string]: string | undefined;
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  const withBlocks = template.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_all, key: string, inner: string) => {
      return vars[key] ? renderTemplate(inner, vars) : "";
    },
  );
  return withBlocks.replace(
    /\{\{(\w+)\}\}/g,
    (_all, key: string) => vars[key] ?? "",
  );
}

export function templateVars(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(/\{\{#if (\w+)\}\}|\{\{(\w+)\}\}/g)) {
    const name = match[1] ?? match[2];
    if (name) names.add(name);
  }
  return [...names];
}

export const KNOWN_TEMPLATE_VARS = new Set([
  "line",
  "file",
  "symbol",
  "p",
  "severity",
  "snippet",
]);
