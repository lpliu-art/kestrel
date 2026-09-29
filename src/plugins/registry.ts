import { KestrelError } from "../util/errors.ts";
import type { KestrelPlugin, LanguageDefinition } from "./api.ts";

export class PluginRegistry {
  readonly plugins: KestrelPlugin[] = [];
  private readonly languages = new Map<
    string,
    { pluginId: string; language: LanguageDefinition }
  >();

  add(plugin: KestrelPlugin): void {
    if (plugin.apiVersion !== 1) {
      throw new KestrelError(
        `Plugin ${plugin.id} uses apiVersion ${plugin.apiVersion}; this Kestrel build supports apiVersion 1.`,
        2,
        "config",
      );
    }
    for (const language of plugin.languages) {
      const existing = this.languages.get(language.id);
      if (existing && existing.pluginId !== plugin.id && !language.override) {
        throw new KestrelError(
          `Language "${language.id}" is already claimed by plugin ${existing.pluginId}. Set override: true to replace it.`,
          2,
          "config",
        );
      }
      this.languages.set(language.id, { pluginId: plugin.id, language });
    }
    this.plugins.push(plugin);
  }

  languageList(): LanguageDefinition[] {
    return [...this.languages.values()].map((entry) => entry.language);
  }

  pluginForLanguage(languageId: string | undefined): KestrelPlugin | undefined {
    if (!languageId) return undefined;
    const owner = this.languages.get(languageId)?.pluginId;
    return this.plugins.find((plugin) => plugin.id === owner);
  }

  get(id: string): KestrelPlugin | undefined {
    return this.plugins.find((plugin) => plugin.id === id);
  }
}
