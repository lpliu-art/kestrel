import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearCredentials,
  maskKey,
  readSkipKeyPrompt,
  resolveApiKey,
  statusText,
  writeCredentials,
  writeSkipKeyPrompt,
} from "../../src/auth/credentials.ts";
import { resolveApiKeyForRun } from "../../src/auth/onboard.ts";
import { userConfigDir } from "../../src/auth/paths.ts";
import { runCli } from "../../src/cli/program.ts";
import { defaultConfig } from "../../src/config/defaults.ts";
import { runDoctor } from "../../src/doctor/run.ts";
import { buildProvider } from "../../src/jev/factory.ts";
import { cleanEnv, initRepo } from "../helpers/git-repo.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempHome(): { env: NodeJS.ProcessEnv; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "kestrel-auth-"));
  dirs.push(dir);
  return {
    dir,
    env: {
      HOME: dir,
      USERPROFILE: dir,
      XDG_CONFIG_HOME: join(dir, "xdg"),
      APPDATA: join(dir, "appdata"),
    },
  };
}

describe("auth credentials", () => {
  it("prefers env over the credentials file and masks the key", () => {
    const { env } = tempHome();
    writeCredentials("file-secret-key-zzzz", env);
    expect(
      resolveApiKey({ ...env, TYPESAFE_API_KEY: "env-secret-key-aaaa" }),
    ).toEqual({
      key: "env-secret-key-aaaa",
      source: "env",
    });
    const fromFile = resolveApiKey(env);
    expect(fromFile.source).toBe("file");
    expect(fromFile.key).toBe("file-secret-key-zzzz");
    expect(maskKey("abcd")).toBe("****");
    expect(maskKey("file-secret-key-zzzz")).toBe("…zzzz");
    expect(statusText(fromFile, "en")).toMatch(/file .*zzzz/);
    expect(clearCredentials(env)).toBe(true);
    expect(resolveApiKey(env).source).toBe("none");
  });

  it("writes credentials with mode 0600 on posix", () => {
    const { env } = tempHome();
    const path = writeCredentials("ts-fake-key-demo", env);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8").trim()).toBe("ts-fake-key-demo");
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  it("parses KEY=value credentials and remembers skipKeyPrompt", () => {
    const { env } = tempHome();
    const dir = userConfigDir(env);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "credentials"),
      "TYPESAFE_API_KEY=ts-from-file-wxyz\n",
      { mode: 0o600 },
    );
    expect(resolveApiKey(env).key).toBe("ts-from-file-wxyz");
    expect(readSkipKeyPrompt(env)).toBe(false);
    writeSkipKeyPrompt(true, env);
    expect(readSkipKeyPrompt(env)).toBe(true);
  });

  it("onboards once interactively, then respects the skip flag", async () => {
    const { env } = tempHome();
    const first = await resolveApiKeyForRun({
      env,
      interactive: true,
      ci: false,
      lang: "en",
      prompt: async () => "",
    });
    expect(first.key).toBeUndefined();
    expect(first.warnings[0]).toMatch(/mock/);
    expect(readSkipKeyPrompt(env)).toBe(true);
    let prompted = 0;
    const second = await resolveApiKeyForRun({
      env,
      interactive: true,
      ci: false,
      lang: "en",
      prompt: async () => {
        prompted += 1;
        return "should-not-run";
      },
    });
    expect(prompted).toBe(0);
    expect(second.key).toBeUndefined();

    writeSkipKeyPrompt(false, env);
    const saved = await resolveApiKeyForRun({
      env,
      interactive: true,
      ci: false,
      lang: "en",
      prompt: async () => "ts-prompted-key-qwer",
    });
    expect(saved.source).toBe("file");
    expect(saved.key).toBe("ts-prompted-key-qwer");
  });

  it("never prompts in CI", async () => {
    const { env } = tempHome();
    let prompted = 0;
    const result = await resolveApiKeyForRun({
      env,
      interactive: true,
      ci: true,
      prompt: async () => {
        prompted += 1;
        return "nope";
      },
    });
    expect(prompted).toBe(0);
    expect(result.source).toBe("none");
  });

  it("buildProvider uses a stored key and doctor reports the source", async () => {
    const { env } = tempHome();
    writeCredentials("ts-stored-key-mnop", env);
    const cwd = await initRepo();
    const config = defaultConfig();
    config.jev.provider = "typesafe";
    config.output.language = "en";
    const built = await buildProvider({
      config,
      rules: [],
      cwd,
      env,
      providerExplicit: false,
      tty: false,
      ci: true,
    });
    expect(built.provider.name).toBe("typesafe");
    const doctor = await runDoctor({
      cwd,
      config,
      env,
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    expect(doctor.text).toMatch(/file \(.*credentials\) · …mnop/);
    expect(doctor.text).toContain("reachable");
  });

  it("auth CLI set/status/clear never print the full key", async () => {
    const { env, dir } = tempHome();
    const cwd = await initRepo();
    const out: string[] = [];
    const err: string[] = [];
    const stdout = process.stdout.write.bind(process.stdout);
    const stderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      err.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    const previous = { ...process.env };
    try {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, cleanEnv(cwd, env));
      delete process.env.TYPESAFE_API_KEY;
      const setCode = await runCli([
        "node",
        "kestrel",
        "auth",
        "set",
        "--key",
        "ts-cli-fake-key-uvwx",
        "--lang",
        "en",
      ]);
      expect(setCode).toBe(0);
      const statusCode = await runCli(["node", "kestrel", "auth", "status"]);
      expect(statusCode).toBe(0);
      const clearCode = await runCli(["node", "kestrel", "auth", "clear"]);
      expect(clearCode).toBe(0);
    } finally {
      process.stdout.write = stdout;
      process.stderr.write = stderr;
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, previous);
    }
    const text = `${out.join("")}${err.join("")}`;
    expect(text).toContain("uvwx");
    expect(text).not.toContain("ts-cli-fake-key-uvwx");
    expect(text).toMatch(/file|stored|cleared/);
    expect(existsSync(join(userConfigDir(env), "credentials"))).toBe(false);
    void dir;
  });
});
