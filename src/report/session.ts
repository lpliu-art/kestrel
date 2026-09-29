import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export class SessionLog {
  constructor(
    private readonly path: string,
    private readonly logPayload: boolean,
  ) {}

  static async open(
    cwd: string,
    startedAt: Date,
    logPayload: boolean,
  ): Promise<SessionLog> {
    const dir = join(cwd, ".kestrel", "sessions");
    await mkdir(dir, { recursive: true });
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
    return new SessionLog(join(dir, `${stamp}.jsonl`), logPayload);
  }

  async write(event: Record<string, unknown>): Promise<void> {
    const copy: Record<string, unknown> = { ...event };
    if (!this.logPayload) {
      delete copy.state;
      delete copy.questions;
    }
    await appendFile(this.path, `${JSON.stringify(copy)}\n`);
  }
}
