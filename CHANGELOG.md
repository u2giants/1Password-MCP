# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.6.1] - 2026-07-23

### Changed

- `op_run` now sends every `op://` environment reference required by one command
  through the 1Password SDK's single bulk `resolveAll` request, instead of one
  request per reference. This reduces startup and command-time vault traffic
  without caching secret values.

## [2.6.0] - 2026-07-16

### Added

- Stable `op_run` shell tokens (`cmd`, `powershell`, `pwsh`, `git-bash`, `wsl`;
  plus `sh`/`bash` outside Windows) resolved to absolute executable paths, while
  preserving absolute-path shells and the existing platform default.
- Pre-execution WSL guard for resolved secrets, with explicit
  `forwardEnvToWsl` and `allowMissingSecretsInWsl` overrides. Forwarding appends
  injected names to the child `WSLENV`; it is never enabled implicitly.
- Safe result diagnostics describing execution mode, resolved shell/executable,
  platform, WSL detection, injected variable names, and requested/resolved
  secret counts.
- Server-level MCP instructions covering safe `op_run` usage and Windows/WSL
  boundaries.
- Redaction edge-case coverage for literal metacharacters, stderr, empty values,
  error paths, and overlapping secret values.

### Changed

- Windows rejects PATH-ambiguous bare `bash`/`sh` instead of silently selecting
  WSL; Git Bash is discovered from validated PATH/install locations and fails
  with clear guidance when unavailable.
- `argv` ENOENT errors now explain that direct execution has no shell, builtins,
  or variable expansion without claiming that every missing executable is a
  builtin.
- `op_run` descriptions and documentation now distinguish direct and shell
  execution and define redaction as transcript-output protection, including its
  encoding/file/network/process limitations.

## [2.5.1] - 2026-07-08

### Added

- **`op_run` tool** — execute a local command with `op://vault/item/field`
  secret references resolved into environment variables, without the
  plaintext ever being returned to the caller/model. This is the MCP
  equivalent of `op run -- <command>`: the resolved secret exists only in
  the child process's environment and server memory; every resolved value
  is redacted (`«REDACTED:ENV_NAME»`) from `stdout`/`stderr`/error messages
  before the result is returned, and is never logged. Supports `command`
  (shell) or `argv` (direct exec, no shell), `cwd`, mixed literal/`op://`
  `env` values, `timeout_ms`, and `stdin`.
- **`op_check_ref` tool** — validate an `op://vault/item/field` reference
  and return only non-secret metadata (vault, item title, field label/type)
  confirming it resolves. Lets an agent sanity-check a reference before
  passing it to `op_run` without ever seeing the value.
- **`OP_MCP_ALLOWED_VAULTS`** env var / `--allowed-vaults` flag — restricts
  which vaults `op_run`/`op_check_ref` may resolve `op://` references from
  (default: `vibe_coding`, matching the owner's existing vault convention).

### Changed

- **`password_read` and `item_get` now default `reveal` to `false`.**
  Previously `password_read` defaulted to revealing the plaintext value;
  both tools now return metadata only unless the caller explicitly passes
  `reveal: true`. Tool descriptions now point agents at `op_run` as the
  preferred way to use a secret in a command without exposing it in the
  model's context/transcript.

## [2.4.3] - 2026-06-22

### Changed

- **Token-free publishing (OIDC)** — Releases now publish to npm via GitHub
  Actions Trusted Publishing instead of a stored npm token. Pushing a `v*` tag
  from `main` triggers `release.yml`, which authenticates with
  a short-lived OIDC credential and generates provenance automatically. No npm
  token is created, stored, or rotated.
- **Docs** — `AGENTS.md` is now the canonical operating guide and documentation
  router; added `docs/architecture.md`, `docs/configuration.md`,
  `docs/development.md`, `CLAUDE.md`, and `scripts/bump-version.mjs`.

> No functional changes to the server runtime; the published code is unchanged
> from 2.4.2 apart from the version bump.

## [2.4.2] - 2026-04-25

### Changed

- **Publish workflow hardening** — Publish now runs on releases/manual dispatch, validates cross-file version alignment, validates release tag/version match, and skips if the npm version already exists.

## [2.4.1] - 2026-03-15

### Changed

- **CI/CD Automation** — Enabled automated NPM publishing on push to `master` branch.

## [2.4.0] - 2026-03-15

### Fixed

- **Server version alignment** — Fixed a mismatch where the runtime MCP server reported a different version than `package.json`.
- **Security: SDK upgrade** — Upgraded `@modelcontextprotocol/sdk` to v1.26.0 to address GHSA-345p-7cg4-v4c7.

### Added

- **Agents guide** — Created `agents.md` with instructions for publishing and managing the server.

### Changed

- **CI/CD Pipeline** — Updated GitHub Actions to correctly target the `master` branch.

## [2.0.0] - 2026-02-06

### Added

- **TypeScript** — Full conversion from JavaScript to strict TypeScript with declarations.
- **Modular architecture** — Split single-file server into logical modules (`logger`, `config`, `client`, `tools/`, `prompts/`, `resources/`).
- **MCP Prompts** — Added 4 interactive prompts: `generate-secure-password`, `credential-rotation`, `vault-audit`, `secret-reference-helper`.
- **MCP Resources** — Added browsable resources: `1password://vaults`, `1password://vaults/{vaultId}/items`, `1password://config`.
- **Tool descriptions** — All tools now include human-readable descriptions for better LLM tool selection.
- **`item_delete` tool** — Complete CRUD: create, read, update, and delete items.
- **`isError` flag** — All error responses now set the MCP `isError: true` flag for protocol compliance.
- **Expanded word list** — `password_generate_memorable` uses ~500 words (EFF-inspired) for better entropy.
- **Rejection sampling** — `password_generate` uses unbiased random character selection.
- **Unit tests** — Comprehensive test suite with Vitest.
- **CI/CD** — GitHub Actions workflows for build, test, and npm publish.
- **Apache 2.0 License**.
- **CONTRIBUTING.md** guide.

### Fixed

- Version mismatch between `package.json` and reported MCP server version.
- Modulo bias in `password_generate` random character selection.
- Duplicate "brazil" entry in memorable password word list.

### Changed

- Minimum Node.js version remains >=18.
- Package entrypoint now points to compiled `dist/` output.

## [1.0.5] - 2025-01-01

### Added

- Initial release with 7 tools: `vault_list`, `item_lookup`, `password_create`, `password_read`, `password_update`, `password_generate`, `password_generate_memorable`.
