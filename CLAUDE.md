# CLAUDE.md

Claude Code-specific notes. **Read [`AGENTS.md`](AGENTS.md) first** — it is the
canonical operating guide and documentation router. This file only adds
Claude-specific context and does not duplicate it.

## Context / ignore

- `.claudeignore` lists what to skip (`node_modules/`, `dist/`, `coverage/`,
  build/cache artifacts). Keep it in sync with the "What to ignore" section of
  `AGENTS.md` and with `.cursorignore`.
- Use the documentation map in `AGENTS.md` to decide which docs to load — do not
  read every `.md` file.

## Branch awareness (important)

This repo is a fork with a deliberate split:

- `main` → package `@u2giants/1password-mcp` (the published fork; default branch).
  **Do release/publishing work here.**
- `feat/item-get-edit-list` → package `@takescake/1password-mcp` (backs upstream
  PR #7). **Do not "fix" its package name.**

Confirm the branch before editing version/package metadata.

## Commit style

- Conventional Commits (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`).
- Bump versions only via `node scripts/bump-version.mjs <version>` (keeps
  `package.json`, `server.json` ×2, and `src/config.ts` in sync).

## Operations / tools

- Build/test locally with the Bash tool (`npm run build`, `npm test`); the
  PowerShell tool is also available on this Windows host.
- Publishing is automated via GitHub Actions OIDC on a `v*` tag push — there is
  **no npm token to manage**, and you cannot/should not publish manually.
- **SSH is not part of this project** — there are no servers to deploy to.
- Never write secrets (tokens, service account values) into the repo, docs, or
  workflow files.
