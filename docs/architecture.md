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
| Tools | `src/tools/*.ts` + `index.ts` | 13 tool handlers; `registerAllTools()` registers each on the server |
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
- **Secrets are plaintext in transit.** Values retrieved/created flow through the
  MCP channel to the model. There is no end-to-end encryption inside MCP; data is
  encrypted only once stored in 1Password. Intended for disposable/automation
  secrets, not high-stakes credentials. (See README "Security & Privacy".)
- **Strict TypeScript, no `any`.** Errors are returned via `errorResult()` with
  the MCP `isError: true` flag, never thrown across the protocol boundary.
- **Stateless and idempotent startup.** Config and client are cached but
  rebuildable (`resetConfig()` exists for tests).

## Capabilities at a glance

- **13 tools:** `vault_list`, `item_lookup`, `item_list`, `item_get`,
  `item_edit`, `item_delete`, `item_archive`, `note_create`, `password_create`,
  `password_read`, `password_update`, `password_generate`,
  `password_generate_memorable`.
- **4 prompts:** `generate-secure-password`, `credential-rotation`,
  `vault-audit`, `secret-reference-helper`.
- **3 resources:** `1password://config`, `1password://vaults`,
  `1password://vaults/{vaultId}/items`.

The README tables are the user-facing reference for these; this doc covers the
internal wiring.
