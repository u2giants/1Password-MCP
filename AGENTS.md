# AGENTS.md — canonical operating guide

This is the **canonical operating guide and documentation router** for this
repository, for both human developers and AI coding sessions. Read this file
first. Do not load every `.md` file — use the
[Documentation map](#documentation-map-what-to-read-for-each-task) to decide what
else to open.

## Project summary

This repo is a **Model Context Protocol (MCP) server for 1Password**, written in
TypeScript and shipped as an npm CLI package. MCP-compatible AI clients (Claude
Desktop, Claude Code, VS Code Copilot, OpenAI Codex, Gemini, etc.) launch it as a
**stdio subprocess** and call its tools/prompts/resources to read and manage
1Password vault items through a 1Password **Service Account**.

- **Who uses it:** developers/automation that need disposable or service-account
  credentials (dev DB creds, bot tokens, CI secrets) surfaced to an AI client.
- **Key moving parts:** the MCP server (`src/`), the 1Password SDK client
  (`src/client.ts`), 13 tools / 4 prompts / 3 resources, and a GitHub Actions
  release pipeline that publishes to npm via OIDC.
- **Outcome that matters:** `npx -y @u2giants/1password-mcp` Just Works for the
  end user, and publishing a new version never requires a hand-managed npm token.

This is a **community fork** of
[`CakeRepository/1Password-MCP`](https://github.com/CakeRepository/1Password-MCP),
not an official 1Password product. It is published to npm under the `@u2giants`
scope. See [Intentional quirks](#intentional-quirks-and-non-obvious-decisions)
for the deliberate two-package-name split between branches.

## Multi-model AI note

There is no universal ignore-file standard across AI coding tools.

`.claudeignore` works for Claude Code.

When using any other AI tool, paste this file as your first message and follow the instructions in the "What to ignore" section.

## Documentation map: what to read for each task

Always start with:

- `AGENTS.md`

Then load additional docs only when relevant:

| Task / question | Read these docs | Usually do not need |
|---|---|---|
| Quick repo orientation | `README.md`, `AGENTS.md` | Deep docs under `docs/` unless task requires them |
| Modify a tool/prompt/resource or other app behavior | `AGENTS.md`, `docs/architecture.md`, the relevant `src/**` file and its test | `PUBLISHING.md`, `docs/deployment` topics unless release behavior changes |
| Add or change configuration, env vars, CLI flags, or runtime settings | `AGENTS.md`, `docs/configuration.md`, `src/config.ts` | Architecture deep-dive unless data flow changes |
| Change local setup, dev scripts, test/lint/debug workflow, or package scripts | `AGENTS.md`, `docs/development.md`, `CONTRIBUTING.md` | `PUBLISHING.md` unless CI/CD changes |
| Change release/publish, GitHub Actions, npm publishing, tags, or rollback | `AGENTS.md`, `PUBLISHING.md`, `.github/workflows/release.yml` | Local-only development docs unless needed |
| Change versioning (bump a release) | `AGENTS.md`, `PUBLISHING.md`, `scripts/bump-version.mjs`, `CHANGELOG.md` | Architecture/config docs unless the change is more than a version bump |
| Investigate a bug or incident | `AGENTS.md`, `docs/architecture.md`, the affected `src/**` file, `HANDOFF.md` if present, [Critical incidents](#critical-incidents) | Unrelated docs |
| Continue unfinished work | `AGENTS.md`, `HANDOFF.md`, docs named inside `HANDOFF.md` | Docs unrelated to the handoff scope |
| Claude Code session | `CLAUDE.md`, then `AGENTS.md` | Other docs unless the task requires them |
| Documentation-only cleanup | `AGENTS.md`, `README.md`, affected docs under `docs/`, `PUBLISHING.md` | Source files except as needed to verify accuracy |

Rules: this map is task-based, distinguishes always-read from task-relevant docs,
and must be updated whenever a doc is added, removed, renamed, or repurposed.
`HANDOFF.md` is required reading **only when it exists** (it does not right now —
see [Pending work](#pending-work)).

## Repository structure

Real paths, grouped by ownership:

```
.                            project root
├── src/                     PROJECT-OWNED — all server source (TypeScript)
│   ├── index.ts             entrypoint: builds McpServer, wires stdio transport
│   ├── config.ts            CLI args, env vars, constants (SERVER_VERSION here)
│   ├── client.ts            1Password SDK client singleton
│   ├── logger.ts            structured logging to STDERR (never stdout)
│   ├── types.ts             shared types
│   ├── utils.ts             result helpers + password generation
│   ├── tools/               13 MCP tool handlers + index.ts barrel
│   ├── prompts/index.ts     4 MCP prompts
│   └── resources/index.ts   3 MCP resources
├── tests/                   PROJECT-OWNED — Vitest unit tests
├── bin/1password-mcp.js     PROJECT-OWNED — published CLI shim (imports dist/)
├── scripts/bump-version.mjs PROJECT-OWNED — version-sync helper
├── .github/workflows/       PROJECT-OWNED — ci.yml, release.yml
├── docs/                    PROJECT-OWNED — architecture/configuration/development
├── *.md                     PROJECT-OWNED — README, AGENTS, CLAUDE, PUBLISHING, CONTRIBUTING, CHANGELOG
├── package.json,
│   server.json,             PROJECT-OWNED — package + MCP-registry manifests
│   tsconfig.json,
│   vitest.config.ts
├── dist/                    BUILD ARTIFACT — `tsc` output, gitignored, not tracked
├── node_modules/            THIRD-PARTY — installed deps, gitignored, not tracked
└── package-lock.json        GENERATED — npm lockfile (tracked; do not hand-edit)
```

There is **no vendored/third-party source and no generated source committed** to
this repo. Dependencies live in `node_modules/` (gitignored) and the compiled
output lives in `dist/` (gitignored). Migrations, Dockerfiles, and deployment
manifests do not exist — this is a CLI library, not a hosted service.

## Prime Directive: custom-code boundary

Our custom code lives here:

- `src/` — all MCP server logic (tools, prompts, resources, config, client)
- `tests/`
- `bin/`, `scripts/`
- `.github/workflows/`
- `docs/` and the root Markdown docs
- `package.json`, `server.json`, `tsconfig.json`, `vitest.config.ts`

Everything else requires justification before touching:

- `dist/` is generated by `tsc` — never hand-edit; rebuild instead.
- `node_modules/` is third-party — never edit; change `package.json` and reinstall.
- `package-lock.json` is generated — change it only via npm.
- The **`master` branch and its `@takescake` naming** are upstream-PR territory —
  do not "fix" them to `@u2giants` (see [Intentional quirks](#intentional-quirks-and-non-obvious-decisions)).

Purpose: prevent project logic from being scattered into generated, third-party,
or upstream-facing files.

## Core modification inventory

No files outside the project-owned areas have been modified. This repository
vendors no third-party or generated source: dependencies live in `node_modules/`
(gitignored) and compiled output in `dist/` (gitignored), neither of which is
tracked or patched.

| File | Change made | Why it was necessary | Risk during upgrades |
|---|---|---|---|
| _(none)_ | — | — | — |

## Task-to-file navigation: what to edit for common changes

This is **not** the documentation map. The documentation map says which docs to
*read*; this says which source/config files to *edit*.

| Task | Files to touch | Files not to touch |
|---|---|---|
| Add or change a tool | `src/tools/<tool>.ts`, register it in `src/tools/index.ts`, add/update `tests/tools.test.ts`; update the tool table in `README.md` | `dist/`, `node_modules/` |
| Add or change a prompt | `src/prompts/index.ts`, `tests/prompts.test.ts`, `README.md` prompt table | `dist/` |
| Add or change a resource | `src/resources/index.ts`, `README.md` resource table | `dist/` |
| Change config, env vars, or CLI flags | `src/config.ts`, `docs/configuration.md`, `tests/config.test.ts` | hard-coded values elsewhere |
| Change 1Password SDK client behavior | `src/client.ts` | tool files (keep SDK wiring centralized) |
| Bump a release version | run `node scripts/bump-version.mjs <version>` (updates `package.json`, `server.json` ×2, `src/config.ts`), then `CHANGELOG.md` | editing the four version spots by hand |
| Change the release/publish flow | `.github/workflows/release.yml`, `PUBLISHING.md` | the npm Trusted Publisher config (lives in npmjs.com UI, not the repo) |
| Change CI (build/test matrix) | `.github/workflows/ci.yml` | `release.yml` unless publishing changes |

## Data model and external identifiers

This server is a **stateless proxy** to the 1Password SDK. It has no database and
persists no data of its own; the "entities" it operates on (vaults, items,
fields) are owned by 1Password and addressed by the SDK or by `op://` secret
references. Do not casually rename or regenerate the identifiers below.

| Entity / System | Identifier | Where defined | Notes |
|---|---|---|---|
| 1Password vault / item / field | `op://<vault>/<item>/<field>` | external (1Password) | Addressed at runtime; no local copy |
| npm package (this fork) | `@u2giants/1password-mcp` | `package.json` `name` | The published artifact |
| MCP registry server name | `io.github.u2giants/1password` | `server.json` `name`, `package.json` `mcpName` | MCP registry identity |
| Runtime server name | `1password-mcp` | `src/config.ts` `SERVER_NAME` | Reported to the MCP client |
| GitHub repo (fork) | `u2giants/1Password-MCP` | `git remote origin` | Source of truth for this fork |
| Upstream repo | `CakeRepository/1Password-MCP` | `git remote upstream` | PR target; `@takescake` package |
| npm Trusted Publisher | user `u2giants` / repo `1Password-MCP` / workflow `release.yml` / no environment | npmjs.com → package Settings → Trusted Publisher | OIDC publish config (no secret) |
| Former npm token (deprecated) | `op://vibe_coding/npm-publish-token` | 1Password `vibe_coding` vault | DEPRECATED tombstone; OIDC replaced it |

## Container and service inventory

**None.** This package runs as a short-lived **stdio subprocess** spawned by the
end user's MCP client; it is not a long-running service and ships no containers,
Compose files, or hosted runtime. There is nothing to list here.

## What to ignore

These exist (or would, after a build/install) but should **not** consume AI
context. They mirror `.claudeignore` / `.cursorignore` and `.gitignore`:

- `node_modules/` — installed third-party dependencies
- `dist/`, `build/` — compiled `tsc` output (build artifacts)
- `coverage/` — test coverage output
- `*.tsbuildinfo` — TypeScript incremental build cache
- `package-lock.json` — large generated lockfile (read only if debugging deps)
- `.mcpregistry*`, `mcp-publisher*` — MCP publisher CLI artifacts (see `.gitignore`)
- `LICENSE` — legal text, not engineering context

## Intentional quirks and non-obvious decisions

### Two package names across branches

Looks like:
The package is named `@u2giants/1password-mcp` on `publish/u2giants-scope` but
`@takescake/1password-mcp` on `master` — looks like a botched rename.

Actually:
It is deliberate. `master` backs the **upstream pull request** to
`CakeRepository/1Password-MCP` and must keep that project's `@takescake` name.
`publish/u2giants-scope` is the **fork's published branch** and uses the
`@u2giants` scope that the owner controls on npm. `feat/item-get-edit-list` is the
feature branch behind the upstream PR.

Why:
The owner cannot publish under `@takescake` (not their scope) but still wants to
contribute changes upstream. Splitting by branch satisfies both.

Do not change because:
Renaming `master` to `@u2giants` would corrupt the upstream PR; renaming
`publish/u2giants-scope` to `@takescake` would make `npm publish` fail (wrong
scope). `release.yml` enforces this with a guard that refuses to publish anything
not named `@u2giants/1password-mcp`.

### Version is duplicated in four places

Looks like:
`package.json`, `server.json` (top-level **and** `packages[0].version`), and
`src/config.ts` (`SERVER_VERSION`) all repeat the same version string.

Actually:
Each serves a different consumer: npm reads `package.json`, the MCP registry
reads `server.json`, and the running server reports `SERVER_VERSION` to clients.

Why:
There is no shared single-source build step that injects the version, and the MCP
registry manifest is a separate artifact from the npm manifest.

Do not change because:
A mismatch makes the server report the wrong version and trips the alignment
guard in `release.yml`. Always bump with `scripts/bump-version.mjs`, which keeps
all four in sync.

### All logging goes to stderr; stdout looks "silent"

Looks like:
The server prints nothing to stdout — logging appears broken.

Actually:
`stdout` is reserved for the MCP JSON-RPC protocol. All logs go to **stderr** via
`src/logger.ts`.

Why:
Writing anything else to stdout corrupts the MCP message stream and breaks the
client connection.

Do not change because:
Any `console.log`/stdout write from server code will break MCP clients. Use
`log()` / `logError()` from `src/logger.ts`.

## Credentials and environment

No secret values are stored in this repo. The runtime variables below are set by
the **end user** in their MCP client config, shell, or (on macOS) Keychain — not
by this project, and not in CI. All are read in `src/config.ts`.

| Variable | Purpose | Stored where | Required at runtime | Required in CI publish |
|---|---|---|---|---|
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password service account token | User MCP config / shell env | yes (unless CLI flag or macOS Keychain used) | no |
| `OP_KEYCHAIN_SERVICE` | macOS Keychain service to read the token from | User env (macOS) | no (macOS alternative to the token var) | no |
| `OP_KEYCHAIN_ACCOUNT` | Optional macOS Keychain account to narrow the lookup | User env (macOS) | no | no |
| `MCP_LOG_LEVEL` | Log level: `error` \| `warn` \| `info` \| `debug` (default `info`) | User env | no | no |
| `MCP_DEBUG` | If set, defaults log level to `debug` | User env | no | no |
| `OP_INTEGRATION_NAME` | Integration name reported to the 1Password SDK (default `1password-mcp`) | User env | no | no |
| `OP_INTEGRATION_VERSION` | Integration version reported to the SDK (default `SERVER_VERSION`) | User env | no | no |

Equivalent CLI flags (override env): `--service-account-token` / `--token`,
`--log-level`, `--integration-name`, `--integration-version`. Token precedence:
CLI flag → `OP_SERVICE_ACCOUNT_TOKEN` → macOS Keychain.

**CI publishing uses no secret at all** — the release workflow authenticates to
npm via OIDC (Trusted Publishing). See [Deployment](#deployment).

## Deployment

There is no server to deploy. "Deployment" here means **publishing the npm
package**; consumers then run it via `npx -y @u2giants/1password-mcp`.

- **Workflow:** `.github/workflows/release.yml` (`name: Release (npm Trusted Publishing)`).
- **Trigger:** pushing a git tag matching `v*` (e.g. `v2.4.3`) from
  `publish/u2giants-scope`. No manual GitHub Release is required.
- **What it does:** checkout → Node 20 → upgrade npm (Trusted Publishing needs
  npm ≥ 11.5.0) → `npm ci` → version/name guards → `npm run build` → `npm test` →
  `npm publish --access public`.
- **Published artifact:** npm package `@u2giants/1password-mcp` on
  `registry.npmjs.org`. There is **no container image**.
- **Tag pattern:** `v<semver>`, matching the version in `package.json`.
- **Auth:** OIDC **Trusted Publishing** — npm config at npmjs.com (user
  `u2giants`, repo `1Password-MCP`, workflow `release.yml`, no environment). No
  `NPM_TOKEN` / `NODE_AUTH_TOKEN`. Provenance is generated automatically.
- **Runtime env vars:** live on the **end user's machine** (MCP client config /
  shell / macOS Keychain). None live in a hosted environment, because there is no
  hosted environment.
- **SSH:** not applicable — there are no servers to SSH into. SSH is never part of
  this project's workflow.
- **Rollback:** npm does not allow republishing an existing version. To roll back,
  publish a higher patch that reverts the change, or deprecate the bad version
  with `npm deprecate @u2giants/1password-mcp@<version> "<reason>"`. Consumers on
  `npx -y` pick up the new `latest` automatically.

Full step-by-step release instructions live in **`PUBLISHING.md`** (the canonical
deploy doc). Do not duplicate them elsewhere.

## Critical incidents

No critical incidents (data loss, broken production deploy, security breach) are
recorded for this fork.

For historical context, `CHANGELOG.md` notes two earlier corrective changes in
the codebase: a runtime-vs-`package.json` version-mismatch fix (2.4.0) and a
security upgrade of `@modelcontextprotocol/sdk` to 1.26.0 addressing
GHSA-345p-7cg4-v4c7 (2.4.0). Neither caused an outage. If a real incident occurs,
add it here using:

```
### [YYYY-MM-DD] Title
What happened: ...
Impact: ...
Root cause: ...
Recovery: ...
Rule added to prevent recurrence: ...
```

## Pending work

| Status | Item | Owner/next action |
|---|---|---|
| open | Revoke the old granular npm publish token (superseded by OIDC) | Human: npmjs.com → Access Tokens → delete the token that expires ~2026-09-20. The `op://vibe_coding/npm-publish-token` 1Password item is already marked DEPRECATED. |
| done | OIDC Trusted Publishing release pipeline (`release.yml`) | Completed in commit `31f5062`; verified by publishing `2.4.3` (Actions run `27994515306`). |
| done | Replace stale `agents.md` with canonical `AGENTS.md` + `docs/` | Completed in this documentation pass. |

No work is mid-flight in the repository, so there is no `HANDOFF.md`. Create one
only if you leave the repo in a partially finished state (see the handoff rule).
