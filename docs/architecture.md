# Architecture

> System design for the 1Password MCP server. For the operating guide and the
> documentation map, start with [`AGENTS.md`](../AGENTS.md).

## What this is

A single-process **MCP (Model Context Protocol) server** exposed as a CLI. An MCP
client (Claude Desktop/Code, Codex, etc.) spawns it as a child process and talks
to it over **stdio** using JSON-RPC. The server translates MCP tool/prompt/
resource calls into 1Password operations via the official `@1password/sdk`.

It is **stateless**: it holds no database and persists nothing between calls. The
only long-lived object is a cached SDK client (`src/client.ts`) and a cached
config object (`src/config.ts`).

## Components

| Component | File | Responsibility |
|---|---|---|
| Entrypoint | `src/index.ts` | Build `McpServer`, register capabilities, connect `StdioServerTransport`, install global error handlers |
| Config | `src/config.ts` | Resolve CLI flags / env vars / macOS Keychain into a cached `ServerConfig`; expose `SERVER_NAME`, `SERVER_VERSION` |
| SDK client | `src/client.ts` | Lazily create and cache the authenticated 1Password SDK client |
| Logger | `src/logger.ts` | Structured logging to **stderr only** (stdout is reserved for MCP) |
| Tools | `src/tools/*.ts` + `index.ts` | 15 tool handlers; `registerAllTools()` registers each on the server. Includes `op_run` (spawns a child process with `op://` refs resolved into its env) and `op_check_ref` (resolves a ref to metadata only). |
| Secret refs | `src/secret-ref.ts` | `isSecretRef` / `parseSecretRef` / `assertVaultAllowed` — shared `op://vault/item/field` parsing + vault allow-list guard used by `op_run` and `op_check_ref` |
| Prompts | `src/prompts/index.ts` | 4 guided prompts (`registerAllPrompts()`) |
| Resources | `src/resources/index.ts` | 3 browsable resources (`registerAllResources()`) |
| Utils | `src/utils.ts` | `errorResult()` and other result helpers; cryptographically secure password generation |
| Types | `src/types.ts` | Shared types and log-level tables |

## Data flow

```
MCP client
  │  (spawns child process: npx -y @u2giants/1password-mcp)
  ▼
src/index.ts ── getConfig() ──► resolve token (CLI flag → env → macOS Keychain)
  │
  │  JSON-RPC over stdio (stdout = protocol, stderr = logs)
  ▼
tool / prompt / resource handler
  │
  ▼
src/client.ts ── @1password/sdk ──► 1Password Service Account API
  │
  ▼
result (errorResult() on failure, isError flag set) ──► back over stdio
```

## Key constraints

- **stdout is sacred.** Only MCP protocol bytes may go to stdout. All diagnostics
  go to stderr via `src/logger.ts`. A stray `console.log` breaks clients.
- **Secrets are plaintext in transit *for retrieval tools*.** Values returned by
  `item_get`/`password_read` (with `reveal`) flow through the MCP channel to the
  model. There is no end-to-end encryption inside MCP; data is encrypted only once
  stored in 1Password. Intended for disposable/automation secrets, not high-stakes
  credentials. (See README "Security & Privacy".)
- **`op_run` is the "use without revealing" path.** To USE a secret in a command/
  API call, `op_run` resolves `op://` refs found in `env` values into a child
  process's environment. It literally replaces every non-empty resolved value
  with `«REDACTED:NAME»` in fully buffered stdout, stderr, and returned error
  text; buffering before redaction also covers values split across stream chunks.
  Plain env values are not redacted. This is transcript-output protection, not a
  leak guarantee: transformed encodings, files, network traffic, process args,
  child processes, and OS process listings are outside the contract. Ref
  resolution for `op_run`/`op_check_ref` is constrained to
  `OP_MCP_ALLOWED_VAULTS` (default `vibe_coding`).
- **Execution boundaries are explicit.** `op_run`'s `argv` form directly spawns
  a real executable with no shell expansion; `command` uses an explicitly
  resolved shell (or the unchanged platform default). On Windows, ambiguous bare
  `bash`/`sh` is rejected. WSL targets with resolved secrets fail before spawn
  unless the caller explicitly forwards names through `WSLENV` or accepts that
  the values will be absent. `WSLENV` is never modified implicitly.
- **Strict TypeScript, no `any`.** Errors are returned via `errorResult()` with
  the MCP `isError: true` flag, never thrown across the protocol boundary.
- **Stateless and idempotent startup.** Config and client are cached but
  rebuildable (`resetConfig()` exists for tests).

## Capabilities at a glance

- **15 tools:** `vault_list`, `item_lookup`, `item_list`, `item_get`,
  `item_edit`, `item_delete`, `item_archive`, `note_create`, `password_create`,
  `password_read`, `password_update`, `password_generate`,
  `password_generate_memorable`, `op_run`, `op_check_ref`.
- **4 prompts:** `generate-secure-password`, `credential-rotation`,
  `vault-audit`, `secret-reference-helper`.
- **3 resources:** `1password://config`, `1password://vaults`,
  `1password://vaults/{vaultId}/items`.

The README tables are the user-facing reference for these; this doc covers the
internal wiring.
