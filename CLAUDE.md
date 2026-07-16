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
- `feat/item-get-edit-list` → package `@takescake/1password-mcp` (historical
  record of upstream PR #7, now **closed** — its tools were merged upstream via
  PR #11). **Do not "fix" its package name.**

New upstream contributions are cut from fresh branches off `upstream/master`, not
this one. Open upstream PRs: **#12** (`op_run`/`op_check_ref`) and **#13**
(reveal-default hardening) — see AGENTS.md → "Upstream contributions".

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
  workflow files. To USE a secret in a command/script/API call, prefer the
  `op_run` tool (pass `op://` refs in its `env`; it injects them into the child
  process and redacts them from output) over revealing a secret with
  `item_get`/`password_read` (`reveal: true`) and pasting it — the latter puts
  plaintext into the model context/transcript.
