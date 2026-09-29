import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedConfig } from "../config/schema.ts";
import { KestrelError } from "../util/errors.ts";
import { type KestrelPlugin, PLUGIN_API_VERSION } from "./api.ts";
import { corePlugin } from "./builtin/core/index.ts";
import { csharpPlugin } from "./builtin/csharp/index.ts";
import { goPlugin } from "./builtin/go/index.ts";
import { javaPlugin } from "./builtin/java/index.ts";
import { pythonPlugin } from "./builtin/python/index.ts";
import { rustPlugin } from "./builtin/rust/index.ts";
import { typescriptPlugin } from "./builtin/typescript/index.ts";
import { PluginRegistry } from "./registry.ts";

export const builtinPlugins: KestrelPlugin[] = [
  corePlugin,
  typescriptPlugin,
  pythonPlugin,
  javaPlugin,
  goPlugin,
  rustPlugin,
  csharpPlugin,
];

export async function loadPlugins(
  config: ResolvedConfig,
  cwd: string,
  untrusted: boolean,
): Promise<PluginRegistry> {
  const registry = new PluginRegistry();
  for (const plugin of builtinPlugins) registry.add(plugin);
  if (untrusted && config.plugins.length > 0) {
    config.warnings.push("Untrusted mode: skipping third-party code plugins.");
    return registry;
  }
  for (const spec of config.plugins) {
    const plugin = await importPlugin(spec, cwd);
    registry.add(plugin);
  }
  return registry;
}

async function importPlugin(spec: string, cwd: string): Promise<KestrelPlugin> {
  const target =
    spec.startsWith(".") || spec.startsWith("/")
      ? pathToFileURL(resolve(cwd, spec)).href
      : spec;
  let imported: { default?: KestrelPlugin; plugin?: KestrelPlugin };
  try {
    imported = (await import(target)) as {
      default?: KestrelPlugin;
      plugin?: KestrelPlugin;
    };
  } catch (error) {
    throw new KestrelError(
      `Cannot load plugin ${spec}: ${(error as Error).message}`,
      2,
      "config",
    );
  }
  const plugin = imported.default ?? imported.plugin;
  if (
    !plugin ||
    plugin.apiVersion !== PLUGIN_API_VERSION ||
    !plugin.id ||
    !plugin.languages
  ) {
    throw new KestrelError(
      `Plugin ${spec} does not default-export a KestrelPlugin (apiVersion 1).`,
      2,
      "config",
    );
  }
  return plugin;
}
