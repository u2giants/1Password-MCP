# 1Password MCP Server

[![CI](https://github.com/u2giants/1Password-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/u2giants/1Password-MCP/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@u2giants/1password-mcp)](https://www.npmjs.com/package/@u2giants/1password-mcp)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

A community-built [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that connects MCP-compatible AI clients (Claude Desktop, VS Code Copilot, OpenAI Codex, Gemini, etc.) to **1Password** vaults via a [Service Account](https://developer.1password.com/docs/service-accounts/).

> **Not an official 1Password product.** This is a community project — a fork of
> [CakeRepository/1Password-MCP](https://github.com/CakeRepository/1Password-MCP)
> published to npm under the `@u2giants` scope. New developers/AI sessions:
> read [AGENTS.md](AGENTS.md) first.

---

## Features

### Tools (13)

| Tool | Description |
|------|-------------|
| `vault_list` | List all accessible vaults |
| `item_lookup` | Search items by title in a vault |
| `item_list` | List all items in a vault (id, title, category, tags, updatedAt) |
| `item_get` | Retrieve a full item (title, category, tags, notes, fields); conceals secret values unless `reveal` is true |
| `item_edit` | Edit an item's title, notes, tags, URL, and fields (upsert/remove); empty `notes` clears notes |
| `item_delete` | Delete an item from a vault |
| `item_archive` | Archive an item (move to archive instead of permanently deleting) |
| `note_create` | Create a Secure Note item with optional tags and custom fields |
| `password_create` | Create a new password/login item |
| `password_read` | Retrieve a password via secret reference (`op://vault/item/field`) or vault/item ID |
| `password_update` | Rotate/update an existing password |
| `password_generate` | Generate a cryptographically secure random password |
| `password_generate_memorable` | Generate a memorable passphrase from ~500 dictionary words |

### Prompts (4)

| Prompt | Description |
|--------|-------------|
| `generate-secure-password` | Guided workflow to generate and store a secure password |
| `credential-rotation` | Step-by-step credential rotation: read, generate, update, verify |
| `vault-audit` | Audit vault contents: list items, categorize, flag concerns |
| `secret-reference-helper` | Construct `op://vault/item/field` references interactively |

### Resources (3)

| Resource URI | Description |
|-------------|-------------|
| `1password://config` | Current server configuration (non-secret) |
| `1password://vaults` | Browsable list of all accessible vaults |
| `1password://vaults/{vaultId}/items` | Browsable list of items in a vault |

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- A [1Password Service Account token](https://developer.1password.com/docs/service-accounts/)

### Claude Desktop / VS Code / IDEs (JSON)

```json
{
  "mcpServers": {
    "1password": {
      "command": "npx",
      "args": ["-y", "@u2giants/1password-mcp"],
      "env": {
        "OP_SERVICE_ACCOUNT_TOKEN": "YOUR_SERVICE_ACCOUNT_TOKEN"
      }
    }
  }
}
```

### macOS Keychain (JSON)

If you do not want to store the service account token directly in your MCP config, macOS users can store it in Keychain and configure the server to read it at startup instead:

```json
{
  "mcpServers": {
    "1password": {
      "command": "npx",
      "args": ["-y", "@u2giants/1password-mcp"],
      "env": {
        "OP_KEYCHAIN_SERVICE": "op-service-account-claude-automation",
        "OP_KEYCHAIN_ACCOUNT": "your-macos-username"
      }
    }
  }
}
```

Precedence is: CLI arguments (`--service-account-token` / `--token`) > `OP_SERVICE_ACCOUNT_TOKEN` > macOS Keychain lookup. `OP_KEYCHAIN_ACCOUNT` is optional if your Keychain service name is already unique enough.

### OpenAI Codex (TOML)

**Option A** (stores the token in config):

```toml
[mcp_servers."1password"]
command = "npx"
args = ["-y", "@u2giants/1password-mcp"]

[mcp_servers."1password".env]
OP_SERVICE_ACCOUNT_TOKEN = "YOUR_SERVICE_ACCOUNT_TOKEN"
```

**Option B** *(recommended: does NOT store the token in Codex config)*:

```toml
[mcp_servers."1password"]
command = "npx"
args = ["-y", "@u2giants/1password-mcp"]
env_vars = ["OP_SERVICE_ACCOUNT_TOKEN"]
```

Then set `OP_SERVICE_ACCOUNT_TOKEN` in your shell/session/CI environment.

> **Note:** `codex mcp add ... --env OP_SERVICE_ACCOUNT_TOKEN=...` writes the token into Codex config. Use `env_vars` if you want the config to reference only the variable name.

On macOS, you can also omit `OP_SERVICE_ACCOUNT_TOKEN` and set `OP_KEYCHAIN_SERVICE` (plus optional `OP_KEYCHAIN_ACCOUNT`) to read the token from Keychain at startup.

### CLI Options

```
--service-account-token <token>   1Password service account token
--log-level <level>               Log level: error, warn, info, debug (default: info)
--integration-name <name>         Custom integration name for 1Password SDK
--integration-version <version>   Custom integration version
```

---

## Security & Privacy

> **Read this before using.**

- **LLM privacy risk** -- Secrets retrieved/created may be sent to your LLM provider and could be retained depending on your provider/account settings.
- **No E2E encryption in MCP** -- Secrets are plaintext inside the MCP workflow and in transit to the model. They are encrypted only once stored in 1Password.
- **Intended use** -- Best for automated/disposable credentials (dev DB creds, bot/service accounts, CI tokens).
- **Avoid high-stakes secrets** -- Do not use for banking, primary personal accounts, or other sensitive credentials. Use dedicated automation vaults.
- **Token security** -- Treat the Service Account Token like a master key. Rotate immediately if exposed.
- **Config files** -- Keep MCP config files out of version control (add to `.gitignore`).
- **Secret references** -- Prefer `op://...` references over copying raw passwords into prompts or files.
- **Least privilege** -- Use dedicated vaults and limited-scope service accounts for automation workflows.
- **Vault convention (u2giants projects)** -- In the maintainer's own projects, automation secrets live in the **`vibe_coding`** vault only -- the single vault the shared service account can read -- referenced as `op://vibe_coding/<item>/<field>`. (Convention only; the server itself works with any vault the token can access.)

---

## Development

```bash
# Clone and install
git clone https://github.com/u2giants/1Password-MCP.git
cd 1Password-MCP
npm install

# Build
npm run build

# Run tests
npm test

# Type-check
npm run lint

# Watch mode (dev)
npm run dev
```

### Project Structure

```
src/
  index.ts              # Server entrypoint
  types.ts              # Shared type definitions
  logger.ts             # Structured logging (stderr)
  config.ts             # CLI args, env vars, constants
  client.ts             # 1Password SDK client singleton
  utils.ts              # Result helpers, password generation
  tools/                # MCP tool handlers (13) + index.ts barrel
    vault-list.ts  item-lookup.ts  item-list.ts  item-get.ts
    item-edit.ts   item-delete.ts  item-archive.ts  note-create.ts
    password-create.ts  password-read.ts  password-update.ts
    password-generate.ts  password-generate-memorable.ts
  prompts/index.ts      # MCP prompt definitions (4)
  resources/index.ts    # MCP resource definitions (3)
scripts/bump-version.mjs  # Keep version in sync across the 4 spots
```

For deeper internals see [docs/architecture.md](docs/architecture.md). For the
canonical operating guide and documentation map, see [AGENTS.md](AGENTS.md).
Contribution guidelines: [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[Apache License 2.0](LICENSE)
