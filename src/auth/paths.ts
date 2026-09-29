import { homedir } from "node:os";
import { join } from "node:path";

/** User config directory for kestrel (credentials + global config.yml). */
export function userConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32") {
    const base = env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(base, "kestrel");
  }
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "kestrel");
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(userConfigDir(env), "credentials");
}

export function globalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(userConfigDir(env), "config.yml");
}
