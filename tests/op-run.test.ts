/**
 * Tests for op_run. Real child processes use Node itself so the suite remains
 * platform-independent; WSL boundary cases use a minimal mocked child.
 */

import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

vi.mock("../src/client.js", () => ({
  getClient: vi.fn(),
  requireServiceAccountToken: vi.fn(() => "mock-token"),
  resetClient: vi.fn(),
}));

vi.mock("../src/logger.js", () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../src/client.js";
import { resetConfig } from "../src/config.js";
import { resolveShellSelection } from "../src/tools/op-run.js";
import { registerAllTools } from "../src/tools/index.js";

const mockedGetClient = vi.mocked(getClient);
const mockedSpawn = vi.mocked(spawn);
const node = process.execPath;

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function mockSuccessfulSpawn(stdout = "", stderr = ""): void {
  mockedSpawn.mockImplementationOnce(((..._args: unknown[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() };
    queueMicrotask(() => {
      if (stdout) child.stdout.emit("data", Buffer.from(stdout));
      if (stderr) child.stderr.emit("data", Buffer.from(stderr));
      child.emit("close", 0, null);
    });
    return child;
  }) as typeof spawn);
}

function mockSpawnError(message: string): void {
  mockedSpawn.mockImplementationOnce(((..._args: unknown[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() };
    queueMicrotask(() => child.emit("error", new Error(message)));
    return child;
  }) as typeof spawn);
}

describe("shell resolution", () => {
  const env: NodeJS.ProcessEnv = {
    SystemRoot: "C:\\Windows",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
    ProgramFiles: "C:\\Program Files",
    LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
  };
  const installed = new Set([
    "C:\\Windows\\System32\\cmd.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Windows\\System32\\wsl.exe",
  ].map((entry) => entry.toLowerCase()));
  const context = {
    platform: "win32" as const,
    env,
    pathExists: (candidate: string) => installed.has(candidate.toLowerCase()),
    findExecutable: () => [],
  };

  it.each([
    ["cmd", "C:\\Windows\\System32\\cmd.exe"],
    ["powershell", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"],
    ["pwsh", "C:\\Program Files\\PowerShell\\7\\pwsh.exe"],
    ["git-bash", "C:\\Program Files\\Git\\bin\\bash.exe"],
    ["wsl", "C:\\Windows\\System32\\wsl.exe"],
  ])("maps %s to a validated absolute executable", (token, expected) => {
    const result = resolveShellSelection(token, context);
    expect(result.shellUsed).toBe(expected);
    expect(result.spawnShell).toBe(expected);
  });

  it("accepts an absolute path as-is", () => {
    const absolute = "C:\\Custom Shell\\shell.exe";
    expect(resolveShellSelection(absolute, context).shellUsed).toBe(absolute);
  });

  it("rejects bare bash on Windows with actionable guidance", () => {
    expect(() => resolveShellSelection("bash", context)).toThrow(/git-bash.*wsl.*absolute path/i);
  });

  it("maps sh and bash only on non-Windows", () => {
    expect(resolveShellSelection("sh", { platform: "linux" }).shellUsed).toBe("/bin/sh");
    expect(resolveShellSelection("bash", { platform: "linux" }).shellUsed).toBe("/bin/bash");
  });
});

describe("op_run", () => {
  let server: McpServer;
  let registeredTools: Map<string, any>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    resetConfig();
    delete process.env.OP_MCP_ALLOWED_VAULTS;

    server = new McpServer({ name: "test", version: "0.0.0" });
    registeredTools = new Map();
    const originalTool = server.tool.bind(server);
    vi.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        registeredTools.set(args[0], {
          description: args[1],
          schema: args[2],
          handler: args[3],
        });
      }
      return originalTool(...args);
    });
    registerAllTools(server);
  });

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
    resetConfig();
  });

  function handler() {
    return registeredTools.get("op_run")!.handler;
  }

  function mockBulkResolve(values: Record<string, string>) {
    const resolveAll = vi.fn().mockImplementation(async (references: string[]) => ({
      individualResponses: Object.fromEntries(
        references.map((reference) => [reference, { content: { secret: values[reference] ?? "" } }]),
      ),
    }));
    mockedGetClient.mockResolvedValue({ secrets: { resolveAll } } as any);
    return resolveAll;
  }

  it("resolves a secret into env while returning safe direct-run diagnostics", async () => {
    mockBulkResolve({ "op://vibe_coding/github/token": "my-secret-value" });

    const result = await handler()({
      argv: [node, "-e", "process.exit(process.env.MY_SECRET === 'my-secret-value' ? 0 : 1)"],
      env: { MY_SECRET: "op://vibe_coding/github/token" },
    });
    const data = parse(result);

    expect(result.isError).toBeUndefined();
    expect(data).toMatchObject({
      exitCode: 0,
      executionMode: "direct",
      shellUsed: null,
      executable: node,
      platform: process.platform,
      wsl: false,
      injectedEnvNames: ["MY_SECRET"],
      requestedSecretCount: 1,
      resolvedSecretCount: 1,
    });
    expect(JSON.stringify(data)).not.toContain("my-secret-value");
    expect(JSON.stringify(data)).not.toContain("op://");
  });

  it("keeps the omitted-shell default and reports the resolved platform shell", async () => {
    mockSuccessfulSpawn();
    const result = await handler()({ command: "ignored by mocked spawn" });
    const data = parse(result);
    const expected = process.platform === "win32"
      ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
      : "/bin/sh";

    expect(data).toMatchObject({ executionMode: "shell", shellUsed: expected, executable: null });
    expect(mockedSpawn.mock.calls[0][1]).toMatchObject({ shell: true });
  });

  it.skipIf(process.platform !== "win32")("rejects a PATH-ambiguous bare bash executable on Windows", async () => {
    const result = await handler()({ argv: ["bash", "-c", "true"] });
    const data = parse(result);
    expect(result.isError).toBe(true);
    expect(data.error).toMatch(/Ambiguous executable.*git-bash.*wsl\.exe.*absolute path/i);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it("passes an absolute command shell through and reports it", async () => {
    mockSuccessfulSpawn();
    const shell = process.execPath;
    const result = await handler()({ command: "ignored", shell });
    const data = parse(result);

    expect(data.shellUsed).toBe(shell);
    expect(mockedSpawn.mock.calls[0][1]).toMatchObject({ shell });
  });

  it("redacts regex and shell metacharacters from stdout and stderr", async () => {
    const secret = "$a.*[b](c)^&|;`";
    mockBulkResolve({ "op://vibe_coding/meta/credential": secret });

    const result = await handler()({
      argv: [node, "-e", "process.stdout.write(process.env.K); process.stderr.write(process.env.K)"],
      env: { K: "op://vibe_coding/meta/credential" },
    });
    const data = parse(result);

    expect(data.stdout).toBe("«REDACTED:K»");
    expect(data.stderr).toBe("«REDACTED:K»");
    expect(JSON.stringify(data)).not.toContain(secret);
  });

  it("skips redaction markers for an empty resolved secret", async () => {
    mockBulkResolve({ "op://vibe_coding/empty/credential": "" });

    const result = await handler()({
      argv: [node, "-e", "process.stdout.write('empty=' + process.env.EMPTY)"],
      env: { EMPTY: "op://vibe_coding/empty/credential" },
    });
    const data = parse(result);

    expect(data.stdout).toBe("empty=");
    expect(data.stdout).not.toContain("REDACTED");
  });

  it("redacts overlapping secrets longest-first", async () => {
    const resolveAll = mockBulkResolve({
      "op://vibe_coding/short/credential": "abc",
      "op://vibe_coding/long/credential": "abc123",
    });

    const result = await handler()({
      argv: [node, "-e", "process.stdout.write(process.env.SHORT + '|' + process.env.LONG)"],
      env: {
        SHORT: "op://vibe_coding/short/credential",
        LONG: "op://vibe_coding/long/credential",
      },
    });
    const data = parse(result);

    expect(data.stdout).toBe("«REDACTED:SHORT»|«REDACTED:LONG»");
    expect(data.stdout).not.toContain("abc");
    expect(resolveAll).toHaveBeenCalledOnce();
    expect(resolveAll).toHaveBeenCalledWith([
      "op://vibe_coding/short/credential",
      "op://vibe_coding/long/credential",
    ]);
  });

  it("does not redact literal env pass-through values", async () => {
    const result = await handler()({
      argv: [node, "-e", "process.stdout.write(process.env.PLAIN_VAR)"],
      env: { PLAIN_VAR: "plain-value" },
    });
    const data = parse(result);

    expect(data.stdout).toBe("plain-value");
    expect(data.requestedSecretCount).toBe(0);
    expect(data.resolvedSecretCount).toBe(0);
  });

  it("keeps successfully resolved values out of a later bulk-resolution error", async () => {
    const resolveAll = vi.fn().mockResolvedValue({
      individualResponses: {
        "op://vibe_coding/first/credential": { content: { secret: "partial-secret" } },
        "op://vibe_coding/second/credential": { error: { type: "not_found" } },
      },
    });
    mockedGetClient.mockResolvedValue({ secrets: { resolveAll } } as any);

    const result = await handler()({
      argv: [node, "-e", "process.exit(0)"],
      env: {
        FIRST: "op://vibe_coding/first/credential",
        SECOND: "op://vibe_coding/second/credential",
      },
    });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Could not resolve secret reference");
    expect(data.error).not.toContain("partial-secret");
    expect(JSON.stringify(data)).not.toContain("partial-secret");
    expect(JSON.stringify(data)).not.toContain("op://");
    expect(data.requestedSecretCount).toBe(2);
    expect(data.resolvedSecretCount).toBe(1);
    expect(data.injectedEnvNames).toEqual(["FIRST"]);
  });

  it("redacts a resolved secret from a spawn error message", async () => {
    mockBulkResolve({ "op://vibe_coding/spawn/credential": "spawn-secret" });
    mockSpawnError("child failed while handling spawn-secret");

    const result = await handler()({
      argv: [node],
      env: { K: "op://vibe_coding/spawn/credential" },
    });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("«REDACTED:K»");
    expect(JSON.stringify(data)).not.toContain("spawn-secret");
  });

  it("refuses WSL with a resolved secret before spawning", async () => {
    mockBulkResolve({ "op://vibe_coding/api/credential": "secret" });

    const result = await handler()({
      argv: ["wsl.exe", "echo", "$K"],
      env: { K: "op://vibe_coding/api/credential" },
    });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toMatch(/Refusing to run.*de-authenticated/i);
    expect(data.wsl).toBe(true);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it("detects an absolute System32 bash path as WSL", async () => {
    mockBulkResolve({ "op://vibe_coding/api/credential": "secret" });
    const system32Bash = process.platform === "win32"
      ? "C:\\Windows\\System32\\bash.exe"
      : "/Windows/System32/bash.exe";

    const result = await handler()({
      argv: [system32Bash, "-c", "true"],
      env: { K: "op://vibe_coding/api/credential" },
    });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.wsl).toBe(true);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it("allows missing WSL secrets only with an explicit override and warns", async () => {
    mockBulkResolve({ "op://vibe_coding/api/credential": "secret" });
    mockSuccessfulSpawn();

    const result = await handler()({
      argv: ["wsl.exe", "echo", "$K"],
      env: { K: "op://vibe_coding/api/credential" },
      allowMissingSecretsInWsl: true,
    });
    const data = parse(result);

    expect(result.isError).toBeUndefined();
    expect(data.warning).toMatch(/without forwarding.*absent inside WSL/i);
    expect(data.wsl).toBe(true);
    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it("forwards names through WSLENV only with explicit opt-in and preserves existing entries", async () => {
    process.env.WSLENV = "EXISTING/u";
    mockBulkResolve({ "op://vibe_coding/api/credential": "secret" });
    mockSuccessfulSpawn();

    const result = await handler()({
      argv: ["wsl.exe", "env"],
      env: { K: "op://vibe_coding/api/credential", PLAIN: "literal" },
      forwardEnvToWsl: true,
    });
    const data = parse(result);
    const options = mockedSpawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv };

    expect(options.env.WSLENV).toBe("EXISTING/u:K/u:PLAIN/u");
    expect(data.warning).toMatch(/widens.*exposure.*WSL distro/i);
    expect(data.injectedEnvNames).toEqual(["K", "PLAIN"]);
  });

  it("allows WSL with non-secret env, warns, and never changes WSLENV implicitly", async () => {
    process.env.WSLENV = "EXISTING/u";
    mockSuccessfulSpawn();

    const result = await handler()({
      argv: ["wsl", "env"],
      env: { PLAIN: "literal" },
    });
    const data = parse(result);
    const options = mockedSpawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv };

    expect(options.env.WSLENV).toBe("EXISTING/u");
    expect(data.warning).toMatch(/do not cross.*not modified/i);
  });

  it("does not add a WSL warning for a native child", async () => {
    const result = await handler()({ argv: [node, "-e", "process.exit(0)"] });
    const data = parse(result);
    expect(data.wsl).toBe(false);
    expect(data.warning).toBeUndefined();
  });

  it("returns friendly ENOENT guidance without claiming the target is a builtin", async () => {
    const result = await handler()({ argv: ["definitely-not-a-real-exe-1password-mcp"] });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("definitely-not-a-real-exe-1password-mcp");
    expect(data.error).toMatch(/was not found on PATH.*argv runs with no shell.*may|was not found on PATH.*shell builtins/is);
    expect(data.error).not.toMatch(/is a shell builtin/i);
  });

  it("rejects an op:// reference outside the vault allow-list without returning the ref", async () => {
    const resolveAll = vi.fn();
    mockedGetClient.mockResolvedValue({ secrets: { resolveAll } } as any);

    const result = await handler()({
      argv: [node, "-e", "process.exit(0)"],
      env: { MY_SECRET: "op://personal/github/token" },
    });
    const data = parse(result);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("not in the allowed vault list");
    expect(JSON.stringify(data)).not.toContain("op://personal");
    expect(resolveAll).not.toHaveBeenCalled();
  });

  it("validates command/argv selection", async () => {
    const neither = await handler()({});
    const both = await handler()({ command: "echo hi", argv: [node, "-e", "1"] });
    expect(parse(neither).error).toContain("Provide either `command` or `argv`");
    expect(parse(both).error).toContain("only one of");
  });

  it("respects cwd", async () => {
    const cwd = process.cwd();
    const normalize = (value: string) => value.toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");
    const result = await handler()({
      argv: [node, "-e", "process.stdout.write(process.cwd())"],
      cwd,
    });
    expect(normalize(parse(result).stdout)).toBe(normalize(cwd));
  });

  it("describes direct-vs-shell execution, WSL, env-only refs, and redaction limits", () => {
    const description = registeredTools.get("op_run")!.description;
    expect(description).toMatch(/argv.*direct spawn.*no shell/is);
    expect(description).toMatch(/cmd\.exe.*%VAR%.*powershell.*\$env:VAR/is);
    expect(description).toMatch(/bare bash|never use bare bash/is);
    expect(description).toMatch(/env values only/is);
    expect(description).toMatch(/transcript output only.*files.*network/is);
  });
});
