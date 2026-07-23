/**
 * op_run — Execute a local command with 1Password secrets injected as
 * environment variables, without returning secret plaintext to the caller.
 * This is the MCP equivalent of `op run -- <command>`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getClient } from "../client.js";
import { log, logError } from "../logger.js";
import { jsonResult } from "../utils.js";
import { isSecretRef, parseSecretRef, assertVaultAllowed } from "../secret-ref.js";

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MiB safety cap per stream
const DEFAULT_TIMEOUT_MS = 120_000;
const REDACTED_REFERENCE = "«REDACTED:SECRET_REFERENCE»";

const SHELL_TOKENS = ["cmd", "powershell", "pwsh", "git-bash", "wsl", "sh", "bash"] as const;
type ShellToken = (typeof SHELL_TOKENS)[number];

interface ResolvedEnvEntry {
  name: string;
  value: string;
  /** True if this env var came from an op:// reference and must be redacted from output. */
  secret: boolean;
}

export interface ShellResolution {
  /** Value passed to Node's spawn `shell` option. */
  spawnShell: boolean | string;
  /** Absolute path reported in diagnostics. */
  shellUsed: string;
  token: ShellToken | null;
}

interface ShellResolutionContext {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathExists?: (candidate: string) => boolean;
  findExecutable?: (
    executable: string,
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv,
  ) => string[];
}

interface ExecutionDiagnostics {
  executionMode: "shell" | "direct";
  shellUsed: string | null;
  executable: string | null;
  platform: NodeJS.Platform;
  wsl: boolean;
  injectedEnvNames: string[];
  requestedSecretCount: number;
  resolvedSecretCount: number;
}

function absoluteForPlatform(candidate: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? path.win32.isAbsolute(candidate) : path.posix.isAbsolute(candidate);
}

function defaultShellPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform !== "win32") return "/bin/sh";
  const configured = env.ComSpec;
  if (configured && path.win32.isAbsolute(configured)) return configured;
  return path.win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
}

function findOnPath(
  executable: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const locator = platform === "win32"
    ? path.win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "where.exe")
    : "which";
  try {
    const output = execFileSync(locator, [executable], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return String(output)
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => absoluteForPlatform(entry, platform));
  } catch {
    return [];
  }
}

function firstExisting(candidates: Array<string | undefined>, pathExists: (candidate: string) => boolean): string | undefined {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (pathExists(candidate)) return candidate;
  }
  return undefined;
}

function resolveWindowsToken(
  token: Exclude<ShellToken, "sh" | "bash">,
  env: NodeJS.ProcessEnv,
  pathExists: (candidate: string) => boolean,
  findExecutable: NonNullable<ShellResolutionContext["findExecutable"]>,
): string {
  const systemRoot = env.SystemRoot ?? "C:\\Windows";
  const programFiles = [env.ProgramW6432, env.ProgramFiles, env["ProgramFiles(x86)"]].filter(
    (entry): entry is string => Boolean(entry),
  );
  let candidates: Array<string | undefined> = [];

  if (token === "cmd") {
    candidates = [env.ComSpec, path.win32.join(systemRoot, "System32", "cmd.exe"), ...findExecutable("cmd.exe", "win32", env)];
  } else if (token === "powershell") {
    candidates = [
      path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ...findExecutable("powershell.exe", "win32", env),
    ];
  } else if (token === "pwsh") {
    candidates = [
      ...programFiles.map((root) => path.win32.join(root, "PowerShell", "7", "pwsh.exe")),
      ...findExecutable("pwsh.exe", "win32", env),
    ];
  } else if (token === "wsl") {
    candidates = [path.win32.join(systemRoot, "System32", "wsl.exe"), ...findExecutable("wsl.exe", "win32", env)];
  } else {
    const gitRoots = [
      ...programFiles.map((root) => path.win32.join(root, "Git")),
      env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, "Programs", "Git") : undefined,
    ];
    const gitFromPath = findExecutable("git.exe", "win32", env).flatMap((gitExe) => {
      const parent = path.win32.dirname(gitExe);
      const root = ["cmd", "bin"].includes(path.win32.basename(parent).toLowerCase())
        ? path.win32.dirname(parent)
        : parent;
      return [path.win32.join(root, "bin", "bash.exe"), path.win32.join(root, "usr", "bin", "bash.exe")];
    });
    const bashFromPath = findExecutable("bash.exe", "win32", env).filter((candidate) =>
      candidate.replace(/\//g, "\\").toLowerCase().includes("\\git\\"),
    );
    candidates = [
      ...gitRoots.flatMap((root) => root
        ? [path.win32.join(root, "bin", "bash.exe"), path.win32.join(root, "usr", "bin", "bash.exe")]
        : []),
      ...gitFromPath,
      ...bashFromPath,
    ];
  }

  const resolved = firstExisting(candidates, pathExists);
  if (!resolved || !path.win32.isAbsolute(resolved)) {
    const extra = token === "git-bash"
      ? " Install Git for Windows or pass its bash.exe as an absolute path."
      : " Install it or pass an absolute executable path.";
    throw new Error(`Could not resolve shell token '${token}' to an installed absolute executable path.${extra}`);
  }
  return resolved;
}

/** Resolve a stable shell token or absolute path without allowing PATH-ambiguous shell names. */
export function resolveShellSelection(
  shell: string | undefined,
  context: ShellResolutionContext = {},
): ShellResolution {
  const platform = context.platform ?? process.platform;
  const env = context.env ?? process.env;
  const pathExists = context.pathExists ?? existsSync;
  const findExecutable = context.findExecutable ?? findOnPath;

  if (shell === undefined) {
    return { spawnShell: true, shellUsed: defaultShellPath(platform, env), token: null };
  }
  if (absoluteForPlatform(shell, platform)) {
    return { spawnShell: shell, shellUsed: shell, token: null };
  }

  const token = shell.toLowerCase();
  if (!SHELL_TOKENS.includes(token as ShellToken)) {
    throw new Error(
      `Unsupported shell '${shell}'. Use cmd, powershell, pwsh, git-bash, wsl, sh/bash on non-Windows, or an absolute path.`,
    );
  }
  if (platform === "win32" && (token === "bash" || token === "sh")) {
    throw new Error(
      `Ambiguous shell '${shell}' is not allowed on Windows because PATH may resolve it to WSL. Use git-bash, wsl, cmd, powershell, pwsh, or an absolute path.`,
    );
  }
  if (platform !== "win32") {
    if (token === "bash" || token === "sh") {
      const resolved = `/bin/${token}`;
      return { spawnShell: resolved, shellUsed: resolved, token: token as ShellToken };
    }
    if (token === "powershell" || token === "pwsh") {
      const executable = token === "powershell" ? "powershell" : "pwsh";
      const resolved = firstExisting(findExecutable(executable, platform, env), pathExists);
      if (resolved) return { spawnShell: resolved, shellUsed: resolved, token: token as ShellToken };
    }
    throw new Error(`Shell token '${shell}' is not supported on ${platform}; pass an absolute path instead.`);
  }

  const resolved = resolveWindowsToken(
    token as Exclude<ShellToken, "sh" | "bash">,
    env,
    pathExists,
    findExecutable,
  );
  return { spawnShell: resolved, shellUsed: resolved, token: token as ShellToken };
}

/** Resolve all secret references in one SDK call, retaining successful earlier entries on a per-ref failure. */
async function resolveEnvEntries(
  env: Record<string, string> | undefined,
  entries: ResolvedEnvEntry[],
): Promise<void> {
  if (!env) return;
  const envEntries = Object.entries(env);
  const secretReferences = envEntries
    .map(([, value]) => value)
    .filter(isSecretRef);
  const hasSecret = secretReferences.length > 0;
  const client = hasSecret ? await getClient() : undefined;
  if (hasSecret && !client?.secrets?.resolveAll) {
    throw new Error("Your @1password/sdk version does not support resolving secrets.");
  }

  for (const reference of secretReferences) {
    assertVaultAllowed(parseSecretRef(reference).vault);
  }
  const resolved = hasSecret ? await client!.secrets.resolveAll(secretReferences) : undefined;

  for (const [name, rawValue] of envEntries) {
    if (isSecretRef(rawValue)) {
      const response = resolved!.individualResponses[rawValue];
      if (!response?.content) {
        const reason = response?.error?.type ?? "unknown";
        throw new Error(`Could not resolve secret reference '${rawValue}' (${reason}).`);
      }
      entries.push({ name, value: response.content.secret, secret: true });
    } else {
      entries.push({ name, value: rawValue, secret: false });
    }
  }
}

/** Replace literal secret values with markers, longest first to handle overlapping values. */
function redact(text: string, secrets: ResolvedEnvEntry[]): string {
  let redacted = text;
  const ordered = secrets
    .filter((entry) => entry.secret && entry.value.length > 0)
    .sort((left, right) => right.value.length - left.value.length);
  for (const entry of ordered) {
    redacted = redacted.split(entry.value).join(`«REDACTED:${entry.name}»`);
  }
  return redacted;
}

function safeMessage(error: unknown, secrets: ResolvedEnvEntry[]): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redact(raw, secrets).replace(/op:\/\/[^\s"'`]+/giu, REDACTED_REFERENCE);
}

function truncate(buffer: Buffer): { text: string; truncated: boolean } {
  if (buffer.length <= MAX_OUTPUT_BYTES) {
    return { text: buffer.toString("utf8"), truncated: false };
  }
  return {
    text: buffer.subarray(0, MAX_OUTPUT_BYTES).toString("utf8"),
    truncated: true,
  };
}

function executableBasename(executable: string): string {
  return path.win32.basename(executable.replace(/\//g, "\\")).toLowerCase();
}

function isWslExecutable(executable: string): boolean {
  const normalized = executable.replace(/\//g, "\\").toLowerCase();
  const basename = executableBasename(executable);
  return basename === "wsl" || basename === "wsl.exe" || /\\system32\\(?:bash|wsl)\.exe$/u.test(normalized);
}

function isWslTarget(shellResolution: ShellResolution | undefined, executable: string | undefined): boolean {
  return shellResolution?.token === "wsl"
    || Boolean(shellResolution && isWslExecutable(shellResolution.shellUsed))
    || Boolean(executable && isWslExecutable(executable));
}

function assertUnambiguousWindowsArgv(executable: string): void {
  if (process.platform !== "win32") return;
  const hasDirectory = /[\\/]/u.test(executable);
  const basename = executableBasename(executable);
  if (!hasDirectory && ["bash", "bash.exe", "sh", "sh.exe"].includes(basename)) {
    throw new Error(
      `Ambiguous executable '${executable}' is not allowed on Windows because PATH may resolve it to WSL. Use git-bash through the command form, wsl.exe explicitly, a native shell, or an absolute path.`,
    );
  }
}

function appendWslenv(childEnv: NodeJS.ProcessEnv, names: string[]): void {
  const existing = (childEnv.WSLENV ?? "").split(":").filter(Boolean);
  const seen = new Set(existing.map((entry) => entry.toLowerCase()));
  for (const name of names) {
    const forwarded = `${name}/u`;
    if (!seen.has(forwarded.toLowerCase())) {
      existing.push(forwarded);
      seen.add(forwarded.toLowerCase());
    }
  }
  childEnv.WSLENV = existing.join(":");
}

function diagnostics(
  command: string | undefined,
  argv: string[] | undefined,
  shellResolution: ShellResolution | undefined,
  wsl: boolean,
  resolvedEnv: ResolvedEnvEntry[],
  requestedSecretCount: number,
): ExecutionDiagnostics {
  return {
    executionMode: command !== undefined ? "shell" : "direct",
    shellUsed: command !== undefined ? (shellResolution?.shellUsed ?? null) : null,
    executable: argv?.[0] ?? null,
    platform: process.platform,
    wsl,
    injectedEnvNames: resolvedEnv.map((entry) => entry.name),
    requestedSecretCount,
    resolvedSecretCount: resolvedEnv.filter((entry) => entry.secret).length,
  };
}

function structuredError(message: string, details: ExecutionDiagnostics) {
  const result = jsonResult({ error: message, ...details });
  return { ...result, isError: true as const };
}

const TOOL_DESCRIPTION = "Use 1Password secrets in a local process without putting plaintext in the MCP transcript. Put op:// references in env values only; references in command/argv text are not resolved, and command lines may be visible to the OS. argv is a direct spawn with no shell, builtin commands, or $VAR/%VAR% expansion; argv[0] must be a real executable. command uses a shell (cmd.exe by default on Windows: use %VAR%; choose shell 'powershell' for $env:VAR). On Windows never use bare bash/sh: choose git-bash or explicit wsl with forwardEnvToWsl when needed. Resolved op:// values are replaced in fully buffered stdout, stderr, and error text with «REDACTED:NAME» (empty values skipped); this protects transcript output only, not transformed encodings or disclosure through files, network, process arguments, child processes, or OS process listings.";

export function registerOpRun(server: McpServer): void {
  server.tool(
    "op_run",
    TOOL_DESCRIPTION,
    {
      command: z
        .string()
        .optional()
        .describe(
          "Shell command line. On Windows the default shell is cmd.exe (%VAR%); use shell:'powershell' for $env:VAR. Provide either command or argv, not both. Put secrets in env, never command text.",
        ),
      argv: z
        .array(z.string())
        .optional()
        .describe(
          "Direct argument vector [real executable, ...args], with no shell, builtin commands, quoting expansion, or $VAR/%VAR% expansion. Provide either argv or command, not both.",
        ),
      cwd: z
        .string()
        .optional()
        .describe("Working directory to run the command in, e.g. a repo checkout path."),
      env: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "ENV_VAR_NAME -> literal or op://vault/item/field value. Only env values resolve secret refs. Diagnostic output returns names, so do not put sensitive data in variable names.",
        ),
      shell: z
        .string()
        .optional()
        .describe(
          "Shell token cmd|powershell|pwsh|git-bash|wsl, or an absolute path. sh/bash tokens are non-Windows only; bare bash/sh is rejected on Windows to prevent accidental WSL. Defaults to cmd.exe on Windows and /bin/sh elsewhere. Ignored with argv.",
        ),
      forwardEnvToWsl: z
        .boolean()
        .optional()
        .default(false)
        .describe("For an explicit WSL target, append injected env names to the child WSLENV. This widens secret exposure into the WSL distro."),
      allowMissingSecretsInWsl: z
        .boolean()
        .optional()
        .default(false)
        .describe("Allow an explicit WSL target to run even though injected Windows env vars will be absent inside WSL."),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .max(600_000)
        .optional()
        .describe("Kill the process if it runs longer than this many milliseconds. Default 120000 (2 minutes)."),
      stdin: z
        .string()
        .optional()
        .describe("Optional text to write to the process's stdin."),
    },
    async ({
      command,
      argv,
      cwd,
      env,
      shell,
      forwardEnvToWsl,
      allowMissingSecretsInWsl,
      timeout_ms,
      stdin,
    }) => {
      const startedAt = Date.now();
      let resolvedEnv: ResolvedEnvEntry[] = [];
      const requestedSecretCount = env
        ? Object.values(env).filter(isSecretRef).length
        : 0;
      let shellResolution: ShellResolution | undefined;
      let wsl = false;

      try {
        log("debug", "Tool call: op_run.", {
          hasCommand: Boolean(command),
          hasArgv: Boolean(argv),
          cwd,
          envKeys: env ? Object.keys(env) : [],
          shell,
          forwardEnvToWsl,
          allowMissingSecretsInWsl,
          timeout_ms,
        });

        if (!command && !argv) throw new Error("Provide either `command` or `argv`.");
        if (command && argv) throw new Error("Provide only one of `command` or `argv`, not both.");
        if (argv && argv.length === 0) throw new Error("`argv` must contain at least the executable name.");

        if (argv) assertUnambiguousWindowsArgv(argv[0]);
        if (command !== undefined) shellResolution = resolveShellSelection(shell);
        wsl = isWslTarget(shellResolution, argv?.[0]);

        await resolveEnvEntries(env, resolvedEnv);
        const childEnv: NodeJS.ProcessEnv = { ...process.env };
        for (const entry of resolvedEnv) childEnv[entry.name] = entry.value;

        const hasResolvedSecret = resolvedEnv.some((entry) => entry.secret);
        if (wsl && hasResolvedSecret && !forwardEnvToWsl && !allowMissingSecretsInWsl) {
          const message = "Refusing to run: target is WSL and resolved 1Password secret(s) would NOT be visible inside WSL (Windows env does not cross the WSL boundary), so the command would run de-authenticated. Set forwardEnvToWsl: true to forward via WSLENV (widens the secret's exposure into the distro), allowMissingSecretsInWsl: true to run anyway, or use a native shell (cmd/powershell/git-bash).";
          return structuredError(
            message,
            diagnostics(command, argv, shellResolution, wsl, resolvedEnv, requestedSecretCount),
          );
        }

        let warning: string | undefined;
        if (wsl && forwardEnvToWsl) {
          appendWslenv(childEnv, resolvedEnv.map((entry) => entry.name));
          warning = "Injected environment names were forwarded through WSLENV. This widens any resolved secret's exposure into the WSL distro.";
        } else if (wsl && hasResolvedSecret) {
          warning = "Running WSL without forwarding injected environment variables; resolved secrets will be absent inside WSL because allowMissingSecretsInWsl was explicitly enabled.";
        } else if (wsl) {
          warning = "WSL target detected. Windows environment variables do not cross into WSL unless explicitly forwarded; WSLENV was not modified.";
        }

        const timeout = timeout_ms ?? DEFAULT_TIMEOUT_MS;
        const result = await new Promise<{
          exitCode: number | null;
          signal: NodeJS.Signals | null;
          stdout: Buffer;
          stderr: Buffer;
          timedOut: boolean;
          spawnError?: NodeJS.ErrnoException;
        }>((resolve) => {
          const stdoutChunks: Buffer[] = [];
          const stderrChunks: Buffer[] = [];
          let timedOut = false;

          const child = argv
            ? spawn(argv[0], argv.slice(1), {
                cwd,
                env: childEnv,
                shell: false,
                timeout,
                killSignal: "SIGTERM",
              })
            : spawn(command as string, {
                cwd,
                env: childEnv,
                shell: shellResolution!.spawnShell,
                timeout,
                killSignal: "SIGTERM",
              });

          child.on("error", (spawnError) => {
            const typedError = spawnError as NodeJS.ErrnoException;
            resolve({
              exitCode: null,
              signal: null,
              stdout: Buffer.concat(stdoutChunks),
              stderr: Buffer.concat(stderrChunks),
              timedOut,
              spawnError: typedError,
            });
          });
          child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
          child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

          if (stdin !== undefined && child.stdin) child.stdin.write(stdin);
          child.stdin?.end();

          child.on("close", (code, signal) => {
            if (signal === "SIGTERM" || signal === "SIGKILL") {
              timedOut = Date.now() - startedAt >= timeout;
            }
            resolve({
              exitCode: code,
              signal,
              stdout: Buffer.concat(stdoutChunks),
              stderr: Buffer.concat(stderrChunks),
              timedOut,
            });
          });
        });

        const durationMs = Date.now() - startedAt;
        const { text: stdoutRaw, truncated: stdoutTruncated } = truncate(result.stdout);
        const { text: stderrRaw, truncated: stderrTruncated } = truncate(result.stderr);
        const stdout = redact(stdoutRaw, resolvedEnv);
        const stderr = redact(stderrRaw, resolvedEnv);
        const runDiagnostics = diagnostics(command, argv, shellResolution, wsl, resolvedEnv, requestedSecretCount);

        if (result.spawnError) {
          let message = safeMessage(result.spawnError, resolvedEnv);
          if (result.spawnError.code === "ENOENT") {
            const target = argv?.[0] ?? shellResolution?.shellUsed ?? command ?? "unknown";
            message = `Executable '${target}' was not found on PATH. Note: argv runs with no shell, so shell builtins (e.g. echo) and $VAR/%VAR% expansion are unavailable — pass a real executable, or use the command form with a shell.`;
            message = safeMessage(new Error(message), resolvedEnv);
          }
          logError("op_run spawn failed.", new Error(message));
          return structuredError(message, runDiagnostics);
        }

        log("debug", "op_run completed.", {
          exitCode: result.exitCode,
          signal: result.signal,
          durationMs,
          timedOut: result.timedOut,
          wsl,
        });

        return jsonResult({
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          stdout,
          stderr,
          stdoutTruncated,
          stderrTruncated,
          durationMs,
          ...runDiagnostics,
          ...(warning ? { warning } : {}),
        });
      } catch (error) {
        const message = safeMessage(error, resolvedEnv);
        const safeError = new Error(message);
        logError("op_run failed.", safeError);
        return structuredError(
          message,
          diagnostics(command, argv, shellResolution, wsl, resolvedEnv, requestedSecretCount),
        );
      }
    },
  );
}
