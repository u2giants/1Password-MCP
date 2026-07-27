/**
 * Tests for src/config.ts — server configuration and CLI argument parsing.
 */

import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { requireServiceAccountToken } from "../src/client.js";
import {
  getConfig,
  readMacOsKeychainToken,
  readTokenFile,
  refreshServiceAccountToken,
  resetConfig,
  resolveServiceAccountToken,
  SERVER_NAME,
  SERVER_VERSION,
} from "../src/config.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("config", () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };
  const temporaryDirectories: string[] = [];

  beforeEach(() => {
    resetConfig();
    // Clean env vars that affect config
    delete process.env.MCP_LOG_LEVEL;
    delete process.env.MCP_DEBUG;
    delete process.env.OP_INTEGRATION_NAME;
    delete process.env.OP_INTEGRATION_VERSION;
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN_FILE;
    delete process.env.OP_KEYCHAIN_SERVICE;
    delete process.env.OP_KEYCHAIN_ACCOUNT;
  });

  afterEach(() => {
    process.argv = originalArgv;
    // Restore env
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
    resetConfig();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("exports correct server constants", () => {
    expect(SERVER_NAME).toBe("1password-mcp");
  });

  it("keeps the runtime version aligned with package.json", () => {
    expect(SERVER_VERSION).toBe(packageJson.version);
  });

  it("defaults to info log level", () => {
    process.argv = ["node", "index.js"];
    const config = getConfig();
    expect(config.logLevel).toBe("info");
    expect(config.logLevelValue).toBe(2);
  });

  it("reads log level from --log-level arg", () => {
    process.argv = ["node", "index.js", "--log-level", "debug"];
    const config = getConfig();
    expect(config.logLevel).toBe("debug");
    expect(config.logLevelValue).toBe(3);
  });

  it("reads log level from MCP_LOG_LEVEL env", () => {
    process.argv = ["node", "index.js"];
    process.env.MCP_LOG_LEVEL = "warn";
    const config = getConfig();
    expect(config.logLevel).toBe("warn");
  });

  it("sets debug level when MCP_DEBUG is set", () => {
    process.argv = ["node", "index.js"];
    process.env.MCP_DEBUG = "1";
    const config = getConfig();
    expect(config.logLevel).toBe("debug");
  });

  it("reports tokenSource as missing when no token provided", () => {
    process.argv = ["node", "index.js"];
    const config = getConfig();
    expect(config.tokenSource).toBe("missing");
    expect(config.serviceAccountToken).toBeUndefined();
  });

  it("reads token from --service-account-token arg", () => {
    process.argv = ["node", "index.js", "--service-account-token", "test-token"];
    const config = getConfig();
    expect(config.tokenSource).toBe("args");
    expect(config.serviceAccountToken).toBe("test-token");
  });

  it("reads token from env var", () => {
    process.argv = ["node", "index.js"];
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "env-token";
    const config = getConfig();
    expect(config.tokenSource).toBe("env");
    expect(config.serviceAccountToken).toBe("env-token");
  });

  it("prefers arg token over env token", () => {
    process.argv = ["node", "index.js", "--token", "arg-token"];
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "env-token";
    const config = getConfig();
    expect(config.tokenSource).toBe("args");
    expect(config.serviceAccountToken).toBe("arg-token");
  });

  it("runs the expected macOS keychain lookup command", () => {
    const execFileSyncImpl = vi.fn(() => "keychain-token\n");

    const token = readMacOsKeychainToken({
      service: "op-service-account",
      account: "alice",
      platform: "darwin",
      execFileSyncImpl,
    });

    expect(token).toBe("keychain-token");
    expect(execFileSyncImpl).toHaveBeenCalledWith("security", [
      "find-generic-password",
      "-a",
      "alice",
      "-s",
      "op-service-account",
      "-w",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  });

  it("skips macOS keychain lookup on non-macOS platforms", () => {
    const execFileSyncImpl = vi.fn();

    const token = readMacOsKeychainToken({
      service: "op-service-account",
      platform: "linux",
      execFileSyncImpl,
    });

    expect(token).toBeUndefined();
    expect(execFileSyncImpl).not.toHaveBeenCalled();
  });

  it("resolves token from macOS keychain when configured", () => {
    const readKeychainToken = vi.fn(() => "keychain-token");

    const config = resolveServiceAccountToken({
      env: {
        OP_KEYCHAIN_SERVICE: "op-service-account",
        OP_KEYCHAIN_ACCOUNT: "alice",
      },
      readKeychainToken,
    });

    expect(config.tokenSource).toBe("keychain");
    expect(config.serviceAccountToken).toBe("keychain-token");
    expect(readKeychainToken).toHaveBeenCalledWith({
      service: "op-service-account",
      account: "alice",
    });
  });

  it("prefers env token over macOS keychain lookup", () => {
    const readKeychainToken = vi.fn(() => "keychain-token");

    const config = resolveServiceAccountToken({
      env: {
        OP_SERVICE_ACCOUNT_TOKEN: "env-token",
        OP_KEYCHAIN_SERVICE: "op-service-account",
      },
      readKeychainToken,
    });

    expect(config.tokenSource).toBe("env");
    expect(config.serviceAccountToken).toBe("env-token");
    expect(readKeychainToken).not.toHaveBeenCalled();
  });

  it("resolves token from a token file when env/args are absent", () => {
    const readTokenFileImpl = vi.fn(() => "file-token");
    const readKeychainToken = vi.fn(() => "keychain-token");

    const config = resolveServiceAccountToken({
      env: {
        OP_SERVICE_ACCOUNT_TOKEN_FILE: "/run/secrets/op-token",
        OP_KEYCHAIN_SERVICE: "op-service-account",
      },
      readTokenFileImpl,
      readKeychainToken,
    });

    expect(config.tokenSource).toBe("file");
    expect(config.serviceAccountToken).toBe("file-token");
    expect(readTokenFileImpl).toHaveBeenCalledWith("/run/secrets/op-token");
    // File wins over the macOS-only keychain fallback.
    expect(readKeychainToken).not.toHaveBeenCalled();
  });

  it("prefers env token over the token file", () => {
    const readTokenFileImpl = vi.fn(() => "file-token");

    const config = resolveServiceAccountToken({
      env: {
        OP_SERVICE_ACCOUNT_TOKEN: "env-token",
        OP_SERVICE_ACCOUNT_TOKEN_FILE: "/run/secrets/op-token",
      },
      readTokenFileImpl,
    });

    expect(config.tokenSource).toBe("env");
    expect(config.serviceAccountToken).toBe("env-token");
    expect(readTokenFileImpl).not.toHaveBeenCalled();
  });

  it("reports missing when no source yields a token", () => {
    const config = resolveServiceAccountToken({
      env: {},
      readTokenFileImpl: () => undefined,
      readKeychainToken: () => undefined,
    });

    expect(config.tokenSource).toBe("missing");
    expect(config.serviceAccountToken).toBeUndefined();
  });

  it("readTokenFile trims content and swallows unreadable paths", () => {
    expect(readTokenFile("/tmp/token", (() => "  tok  ") as never)).toBe("tok");
    expect(readTokenFile("/tmp/token", (() => "   ") as never)).toBeUndefined();
    expect(
      readTokenFile("/tmp/token", (() => {
        throw new Error("ENOENT");
      }) as never),
    ).toBeUndefined();
    expect(readTokenFile(undefined)).toBeUndefined();
  });

  it("refreshServiceAccountToken recovers a token after a tokenless start", () => {
    // Simulate the launcher race: the server starts with no token at all...
    process.argv = ["node", "index.js"];
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN_FILE;
    expect(getConfig().tokenSource).toBe("missing");

    // ...and a token source appears later.
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "late-token";
    expect(refreshServiceAccountToken()).toBe("late-token");
    expect(getConfig().serviceAccountToken).toBe("late-token");
    expect(getConfig().tokenSource).toBe("env");
  });

  it.each(["--service-account-token-file", "--token-file"])(
    "reads a token through the %s CLI flag",
    (flag) => {
      const directory = mkdtempSync(join(tmpdir(), "onepassword-mcp-"));
      temporaryDirectories.push(directory);
      const tokenPath = join(directory, "token");
      writeFileSync(tokenPath, "cli-file-token\n", "utf8");
      process.argv = ["node", "index.js", flag, tokenPath];

      expect(getConfig().serviceAccountToken).toBe("cli-file-token");
      expect(getConfig().tokenSource).toBe("file");
    },
  );

  it("the client retry recovers when a configured token file appears later", () => {
    const directory = mkdtempSync(join(tmpdir(), "onepassword-mcp-"));
    temporaryDirectories.push(directory);
    const tokenPath = join(directory, "late-token");
    process.argv = ["node", "index.js"];
    process.env.OP_SERVICE_ACCOUNT_TOKEN_FILE = tokenPath;

    expect(getConfig().tokenSource).toBe("missing");
    writeFileSync(tokenPath, "late-file-token\n", "utf8");

    expect(requireServiceAccountToken()).toBe("late-file-token");
    expect(getConfig().tokenSource).toBe("file");
  });

  it("uses default integration name/version", () => {
    process.argv = ["node", "index.js"];
    const config = getConfig();
    expect(config.integrationName).toBe(SERVER_NAME);
    expect(config.integrationVersion).toBe(SERVER_VERSION);
  });

  it("reads --flag=value style args", () => {
    process.argv = ["node", "index.js", "--log-level=error"];
    const config = getConfig();
    expect(config.logLevel).toBe("error");
  });

  it("caches config on repeated calls", () => {
    process.argv = ["node", "index.js"];
    const c1 = getConfig();
    const c2 = getConfig();
    expect(c1).toBe(c2);
  });
});
