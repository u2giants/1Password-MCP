# Configuration

> Canonical reference for how this server is configured. For the operating guide,
> start with [`AGENTS.md`](../AGENTS.md). All of this is implemented in
> [`src/config.ts`](../src/config.ts) — change that file (and this doc) together.

There are **no config files and no `.env` files** for this server. Configuration
comes from CLI flags and environment variables, resolved at startup by the end
user's MCP client. Nothing here is a secret committed to the repo.

## Environment variables

| Variable | Purpose | Default | Notes |
|---|---|---|---|
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password Service Account token | — | Primary auth. Required unless a CLI flag or macOS Keychain provides the token. Treat like a master key. |
| `OP_KEYCHAIN_SERVICE` | macOS Keychain service name to read the token from | — | macOS-only alternative to `OP_SERVICE_ACCOUNT_TOKEN`. |
| `OP_KEYCHAIN_ACCOUNT` | macOS Keychain account to narrow the lookup | — | Optional; only used with `OP_KEYCHAIN_SERVICE`. |
| `MCP_LOG_LEVEL` | Log level: `error`, `warn`, `info`, `debug` | `info` | Logs go to stderr. |
| `MCP_DEBUG` | If set (any value), forces log level to `debug` | unset | Convenience switch; `MCP_LOG_LEVEL` and `--log-level` take precedence. |
| `OP_INTEGRATION_NAME` | Integration name reported to the 1Password SDK | `1password-mcp` | Appears in 1Password access logs. |
| `OP_INTEGRATION_VERSION` | Integration version reported to the SDK | `SERVER_VERSION` | Defaults to the running server version. |

## CLI flags

Flags override the corresponding environment variables. Accepted as `--flag value`
or `--flag=value`.

| Flag | Overrides | Purpose |
|---|---|---|
| `--service-account-token` / `--token` | `OP_SERVICE_ACCOUNT_TOKEN` | Provide the token directly |
| `--log-level <level>` | `MCP_LOG_LEVEL` / `MCP_DEBUG` | `error` \| `warn` \| `info` \| `debug` |
| `--integration-name <name>` | `OP_INTEGRATION_NAME` | Custom SDK integration name |
| `--integration-version <version>` | `OP_INTEGRATION_VERSION` | Custom SDK integration version |

## Token resolution order

`src/config.ts` resolves the service account token in this precedence:

1. CLI flag (`--service-account-token` / `--token`)
2. `OP_SERVICE_ACCOUNT_TOKEN`
3. macOS Keychain (`OP_KEYCHAIN_SERVICE`, optionally narrowed by
   `OP_KEYCHAIN_ACCOUNT`) — only attempted on `darwin` when 1 and 2 are absent

The resolved source is recorded as `tokenSource` (`args` | `env` | `keychain` |
`missing`) and logged at startup.

## Vault convention (u2giants)

Across the owner's projects, **all secrets live in the `vibe_coding` 1Password
vault — and only `vibe_coding`** (the single vault the shared service account can
read). Reference them as `op://vibe_coding/<item>/<field>`. This is an operating
convention, not a constraint of the server, which works with any vault the token
can access.

## Feature flags

There are **no feature flags** in this project.

## Where users set these

In the MCP client configuration (`env` block of the server entry), the shell/CI
environment, or macOS Keychain. See the README for client-specific JSON/TOML
examples. **CI publishing needs none of these** — see
[`PUBLISHING.md`](../PUBLISHING.md).
