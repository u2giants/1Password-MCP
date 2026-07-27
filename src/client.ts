/**
 * 1Password SDK client singleton.
 */

import { createClient } from "@1password/sdk";
import { getConfig, refreshServiceAccountToken } from "./config.js";
import { log } from "./logger.js";

type OnePasswordClient = Awaited<ReturnType<typeof createClient>>;

let clientPromise: Promise<OnePasswordClient> | undefined;

/** Ensure a service account token is available; throw otherwise. */
export function requireServiceAccountToken(): string {
  const config = getConfig();
  if (config.serviceAccountToken) return config.serviceAccountToken;

  // Re-check configured sources before giving up. This mainly lets a token file
  // recover when it appears or becomes readable after startup. A parent process
  // cannot inject a new environment variable into an already-running child.
  const refreshed = refreshServiceAccountToken();
  if (refreshed) {
    log("info", "Recovered a service account token on retry.");
    return refreshed;
  }

  log("error", "Missing service account token.");
  throw new Error(
    "Service account token is required, and this server started without one. " +
      "Provide it via --service-account-token, OP_SERVICE_ACCOUNT_TOKEN, " +
      "--service-account-token-file / OP_SERVICE_ACCOUNT_TOKEN_FILE, or macOS " +
      "Keychain with OP_KEYCHAIN_SERVICE, then restart the MCP host so the server " +
      "is relaunched with the token in its environment.",
  );
}

/** Get (or lazily create) the 1Password SDK client. */
export async function getClient(): Promise<OnePasswordClient> {
  if (!clientPromise) {
    log("debug", "Initializing 1Password client.");
    const token = requireServiceAccountToken();
    const config = getConfig();
    clientPromise = createClient({
      auth: token,
      integrationName: config.integrationName,
      integrationVersion: config.integrationVersion,
    });
  }
  return clientPromise;
}

/** Reset the client singleton (useful for testing). */
export function resetClient(): void {
  clientPromise = undefined;
}
