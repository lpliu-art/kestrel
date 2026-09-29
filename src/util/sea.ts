import { createRequire } from "node:module";

export const SEA_PREFIX = "sea:";

export function builtinAssetKey(plugin: string, file: string): string {
  return `builtin/${plugin}/rules/${file}`;
}

interface SeaLike {
  isSea?: () => boolean;
  getAsset?: (key: string) => ArrayBuffer | Uint8Array | string | undefined;
}

type SeaSource = SeaLike | (() => SeaLike | undefined);

let overrideEnabled = false;
let override: SeaSource | undefined;

export function setSeaForTests(sea: SeaSource | undefined): void {
  overrideEnabled = true;
  override = sea;
}

export function clearSeaForTests(): void {
  overrideEnabled = false;
  override = undefined;
}

export function runningInSea(): boolean {
  return Boolean(seaApi()?.isSea?.());
}

export function readSeaText(key: string): string | undefined {
  try {
    const sea = seaApi();
    if (!sea?.isSea?.()) return undefined;
    return textOf(sea.getAsset?.(key));
  } catch {
    return undefined;
  }
}

function seaApi(): SeaLike | undefined {
  try {
    if (overrideEnabled) {
      return typeof override === "function" ? override() : override;
    }
    const url = import.meta.url;
    const require =
      typeof url === "string" && url.length > 0
        ? createRequire(url)
        : createRequire(process.execPath);
    return require("node:sea") as SeaLike;
  } catch {
    return undefined;
  }
}

function textOf(asset: unknown): string | undefined {
  if (typeof asset === "string") return asset;
  if (asset instanceof Uint8Array) return new TextDecoder().decode(asset);
  if (asset instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(asset));
  }
  return undefined;
}
