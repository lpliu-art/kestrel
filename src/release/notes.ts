export function tagMatchesPackageVersion(
  tag: string,
  version: string,
): boolean {
  const name = tag.replace(/^refs\/tags\//, "");
  return name === `v${version}`;
}

export function changelogSection(markdown: string, version: string): string {
  const header = `## ${version}`;
  const start = markdown.indexOf(`${header}\n`);
  if (start < 0) {
    throw new Error(`CHANGELOG has no section ${header}`);
  }
  const rest = markdown.slice(start + header.length);
  const next = rest.search(/\n## /);
  const body = next === -1 ? rest : rest.slice(0, next);
  return `${header}${body}`.trimEnd().concat("\n");
}
