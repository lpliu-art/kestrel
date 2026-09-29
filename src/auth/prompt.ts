import { stdin as input, stderr as output } from "node:process";

/**
 * Ask for a secret on stderr with echo disabled. Empty Enter returns "".
 * Requires a TTY stdin. Never writes the value anywhere.
 */
export async function promptHidden(message: string): Promise<string> {
  if (!input.isTTY) {
    throw new Error("Hidden prompt requires a TTY stdin");
  }
  output.write(message);
  return await new Promise<string>((resolve, reject) => {
    const wasRaw = input.isRaw;
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const char of text) {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          cleanup();
          output.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          output.write("\n");
          reject(new Error("Interrupted"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (char < " " && char !== "\t") continue;
        value += char;
      }
    };
    let value = "";
    const cleanup = () => {
      input.off("data", onData);
      try {
        if (typeof input.setRawMode === "function") input.setRawMode(wasRaw);
      } catch {
        // ignore
      }
      input.pause();
    };
    try {
      if (typeof input.setRawMode === "function") input.setRawMode(true);
    } catch (error) {
      reject(error);
      return;
    }
    input.resume();
    input.on("data", onData);
  });
}

export async function readPipedStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

export function keyPromptMessage(lang: "zh-CN" | "en"): string {
  if (lang === "en") {
    return "Jev API key (Enter to skip, continues in mock mode): ";
  }
  return "Jev API 密钥（直接回车跳过，将以 mock 模式继续）: ";
}
