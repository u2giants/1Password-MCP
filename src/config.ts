/**
 * Server configuration: CLI arguments, environment variables, constants.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LOG_LEVEL_VALUES, type LogLevel } from "./types.js";

export const SERVER_NAME = "1password-mcp";
export const SERVER_VERSION = "2.7.0";

/** Parse a `--flag value` or `--flag=value` argument from process.argv. */
function getArgValue(name: string): string | undefined {
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === flag && process.argv[i + 1]) return process.argv[i + 1];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

export interface ServerConfig {
  /** Resolved log level string. */
  logLevel: LogLevel;
  /** Numeric log level for fast comparison. */
  logLevelValue: number;
  /** Integration name reported to 1Password SDK. */
  integrationName: string;
  /** Integration version reported to 1Password SDK. */
  integrationVersion: string;
  /** Service account token (may be undefined until first use). */
  serviceAccountToken: string | undefined;
  /** Where the token came from. */
  tokenSource: "args" | "env" | "file" | "keychain" | "missing";
  /** Vault names that `op_run`/`op_check_ref` are permitted to resolve secret references from. */
  allowedVaults: string[];
}

/** Default vault allow-list for op:// reference resolution (the owner's operating convention). */
export const DEFAULT_ALLOWED_VAULTS = ["vibe_coding"];

/** Parse a comma-separated vault allow-list; falls back to the default when unset/blank. */
export function parseAllowedVaults(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [...DEFAULT_ALLOWED_VAULTS];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

let _config: ServerConfig | undefined;

interface MacOsKeychainLookupOptions {
  service?: string;
  account?: string;
  platform?: NodeJS.Platform;
  execFileSyncImpl?: typeof execFileSync;
}

export function readMacOsKeychainToken({
  service,
  account,
  platform = process.platform,
  execFileSyncImpl = execFileSync,
}: MacOsKeychainLookupOptions): string | undefined {
  if (!service || platform !== "darwin") return undefined;

  const args = ["find-generic-password"];
  if (account) args.push("-a", account);
  args.push("-s", service, "-w");

  try {
    const token = execFileSyncImpl("security", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a service-account token from a file on disk.
 *
 * The macOS Keychain fallback has no Windows/Linux equivalent, so a launcher on
 * those platforms can only pass the token through the environment -- and if the
 * process is ever started without it, the server is dead until it is restarted.
 * A file source lets any launcher point at a token on disk instead.
 */
export function readTokenFile(
  path: string | undefined,
  readFileImpl: typeof readFileSync = readFileSync,
): string | undefined {
  if (!path) return undefined;
  try {
    const token = readFileImpl(path, "utf8").toString().trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

export function resolveServiceAccountToken({
  tokenFromArgs,
  tokenFileFromArgs,
  env = process.env,
  readKeychainToken = readMacOsKeychainToken,
  readTokenFileImpl = readTokenFile,
}: {
  tokenFromArgs?: string;
  tokenFileFromArgs?: string;
  env?: NodeJS.ProcessEnv;
  readKeychainToken?: (options: {
    service?: string;
    account?: string;
  }) => string | undefined;
  readTokenFileImpl?: (path: string | undefined) => string | undefined;
} = {}): Pick<ServerConfig, "serviceAccountToken" | "tokenSource"> {
  const tokenFromEnv = env.OP_SERVICE_ACCOUNT_TOKEN;

  let tokenFromFile: string | undefined;
  if (!tokenFromArgs && !tokenFromEnv) {
    tokenFromFile = readTokenFileImpl(
      tokenFileFromArgs ?? env.OP_SERVICE_ACCOUNT_TOKEN_FILE,
    );
  }

  let tokenFromKeychain: string | undefined;
  if (!tokenFromArgs && !tokenFromEnv && !tokenFromFile) {
    tokenFromKeychain = readKeychainToken({
      service: env.OP_KEYCHAIN_SERVICE,
      account: env.OP_KEYCHAIN_ACCOUNT,
    });
  }

  const serviceAccountToken =
    tokenFromArgs ?? tokenFromEnv ?? tokenFromFile ?? tokenFromKeychain;

  const tokenSource: ServerConfig["tokenSource"] = tokenFromArgs
    ? "args"
    : tokenFromEnv
      ? "env"
      : tokenFromFile
        ? "file"
        : tokenFromKeychain
          ? "keychain"
          : "missing";

  return { serviceAccountToken, tokenSource };
}

/** Build and cache the server configuration. */
export function getConfig(): ServerConfig {
  if (_config) return _config;

  const logLevelRaw = (
    getArgValue("log-level") ??
    process.env.MCP_LOG_LEVEL ??
    (process.env.MCP_DEBUG ? "debug" : "info")
  ).toLowerCase() as LogLevel;

  const logLevelValue = LOG_LEVEL_VALUES[logLevelRaw] ?? LOG_LEVEL_VALUES.info;

  const integrationName =
    getArgValue("integration-name") ??
    process.env.OP_INTEGRATION_NAME ??
    SERVER_NAME;

  const integrationVersion =
    getArgValue("integration-version") ??
    process.env.OP_INTEGRATION_VERSION ??
    SERVER_VERSION;

  const tokenFromArgs =
    getArgValue("service-account-token") ?? getArgValue("token");
  const tokenFileFromArgs =
    getArgValue("service-account-token-file") ?? getArgValue("token-file");

  const { serviceAccountToken, tokenSource } = resolveServiceAccountToken({
    tokenFromArgs,
    tokenFileFromArgs,
  });

  const allowedVaults = parseAllowedVaults(
    getArgValue("allowed-vaults") ?? process.env.OP_MCP_ALLOWED_VAULTS,
  );

  _config = {
    logLevel: logLevelRaw,
    logLevelValue,
    integrationName,
    integrationVersion,
    serviceAccountToken,
    tokenSource,
    allowedVaults,
  };

  return _config;
}

/**
 * Re-resolve the service-account token against the CURRENT environment/args/file
 * and update the cached config.
 *
 * getConfig() resolves the token exactly once at startup and caches it forever, so
 * a process that happened to start without a token stayed broken for its entire
 * lifetime -- every call failing with "Service account token is required" until the
 * whole MCP host was restarted. (Seen 2026-07-26: the launcher only exported
 * OP_SERVICE_ACCOUNT_TOKEN on its cache-refresh path, so a reconnect during a fresh
 * cache window started this server tokenless.) Retrying the lookup costs nothing on
 * the happy path and lets the server recover on its own when a token source exists.
 *
 * Returns the token, or undefined if one still cannot be found.
 */
export function refreshServiceAccountToken(): string | undefined {
  const config = getConfig();
  if (config.serviceAccountToken) return config.serviceAccountToken;

  const tokenFromArgs =
    getArgValue("service-account-token") ?? getArgValue("token");
  const tokenFileFromArgs =
    getArgValue("service-account-token-file") ?? getArgValue("token-file");

  const { serviceAccountToken, tokenSource } = resolveServiceAccountToken({
    tokenFromArgs,
    tokenFileFromArgs,
  });

  config.serviceAccountToken = serviceAccountToken;
  config.tokenSource = tokenSource;
  return serviceAccountToken;
}

/** Reset cached config (useful for testing). */
export function resetConfig(): void {
  _config = undefined;
}
