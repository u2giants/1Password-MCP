# HANDOFF — `op_run` Windows/WSL hardening + diagnostics

**Repo:** `u2giants/1Password-MCP` (`@u2giants/1password-mcp`, main-only) · **Date:** 2026-07-16
**Baseline:** v2.5.1 (commit `4500321`) · **Status:** spec written, **no code changed yet**

> Written for a developer with zero prior context on this session. Read this, then the
> implementation spec: **[`fix.md`](fix.md)** is the authoritative, step-by-step work plan.

---

## 1. What this is / the goal

Harden the `op_run` tool for the Windows/WSL host it runs on and make its behavior self-diagnosing,
based on a live investigation reviewed by two independent AIs (Claude + Codex/GPT-5.6). The full,
agreed-upon, prioritized implementation plan — with exact files, line anchors, tests, and a release
checklist — is in **[`fix.md`](fix.md)**. This handoff is the orientation around it.

## 2. Why (the triggering incident)

A caller injected a 1Password secret via `op_run`'s `env` map and ran it through `bash` — the value
arrived empty and the call was **wrongly concluded to be an `op_run` bug**. It is not a bug. Real
cause: on this host **`bash` = WSL bash**, and WSL does not inherit the Windows process environment
`op_run` sets (no `WSLENV` forwarding), so injected vars (secrets included) are invisible inside WSL.
Native children (cmd, PowerShell, node, curl.exe) get the env and resolved secrets correctly, and
output redaction works (`«REDACTED:NAME»`). See `fix.md` §1 for the proof.

## 3. Current state

- **Nothing in the code has changed.** `op_run` works correctly for native children today.
- The gaps are: no signal that a run went through WSL, a PATH-ambiguous `shell` param that lets bare
  `bash` silently mean WSL, thin error messages, no result metadata, no server `instructions` block,
  and an undocumented redaction contract. All are addressed in `fix.md` (7 work items).
- Target release: **v2.6.0** (additive + clarifying; no breaking change).

## 4. Where things live (key files)

- `src/tools/op-run.ts` — the tool. Schema ~L100–117; spawn ~L161–175 (`shell: shell ?? true` at
  L172 — proves `shell` is honored, the issue is PATH ambiguity); result `jsonResult` ~L232–241;
  `redact()` L51–61; spawn-error path L177–186 / L219–223.
- `src/index.ts:18` — `new McpServer(...)`; server `instructions` get added here (item #6).
- `src/config.ts:9` — `SERVER_VERSION` (one of the four version-bump locations).
- `server.json` — version appears **twice** (top-level + `packages[0].version`).
- `package.json` — `"version"` (currently 2.5.1).
- `tests/op-run.test.ts` — existing op_run tests; new edge tests go here.
- `PUBLISHING.md` — release-by-tag (Trusted Publishing) process.

## 5. How to build / test / release

- Build: `npm run build` (tsc). Test: `npm test` (vitest).
- Release: bump version in **all four** places (they must match — see `fix.md` §10), update
  `CHANGELOG.md`, then push the version tag; CI publishes via Trusted Publishing. Do **not**
  hand-publish. Do **not** touch Codex config.

## 6. The plan

**[`fix.md`](fix.md)** — 7 agreed work items, in priority order: (1) stable `shell` enum, (2) WSL
detect + warn + opt-in `forward_env_to_wsl`, (3) result metadata, (4) friendlier ENOENT, (5) tool
description, (6) server `instructions`, (7) redaction docs + edge tests. It also lists **Non-goals**
(contested ideas deliberately excluded: PowerShell-as-default, hard-refusing WSL, counts-not-names,
encoding-aware redaction) and a live smoke-test plan.

## 7. What we tried that did NOT work (don't repeat)

- **Concluding `op_run`'s `env` is broken.** Wrong. It was WSL dropping the env. A single `pwd`
  (returning `/mnt/c/…`) would have revealed it immediately — always confirm the exec environment
  before blaming the tool.
- **`argv:["echo", …]`** → `spawn echo ENOENT`: `argv` is a direct spawn with **no shell**, and
  `echo` is a cmd builtin, not an executable. Use the `command` form or a real exe.
- **`op run --env-file <(echo …)`** (process substitution) via Git Bash → native `op.exe` fails on
  `/proc/<pid>/fd` msys paths. Use a real temp env-file instead.
- **`codex update` from Git Bash** → failed on an msys `tar` vs `C:` path clash. The official
  PowerShell installer (`irm https://chatgpt.com/codex/install.ps1 | iex`) run in **native**
  PowerShell works (this is how Codex was updated 0.142.5 → 0.144.5 to get its review).

## 8. Gotchas / environment

- This host's `bash` is **WSL**, not Git Bash. The separate Claude Code "Bash tool" uses **Git
  Bash** (which *does* inherit Windows env) — a different `bash`. Don't conflate them.
- `command` form → cmd.exe (`%VAR%`, output has `\r\n`). `argv` form → direct spawn, no expansion.
- `op://` is only resolved for **values in the `env` map**, never inside command text.
- Vault allow-list defaults to `vibe_coding` (`src/config.ts:41`).

## 9. Definition of done / next steps

- [ ] Implement `fix.md` items 1–7 with their tests; `npm run build` + `npm test` green.
- [ ] Live smoke on this host per `fix.md` §12 (the original scenario now surfaces a `warning` and
      metadata instead of a silent empty result).
- [ ] Bump version ×4, update `CHANGELOG.md`, tag-push release (v2.6.0).
- [ ] Confirm no secret value ever appears in `stdout`/`stderr`/`injectedEnv`/error text.
- **Open questions** (in `fix.md` §13): does the pinned MCP SDK expose `instructions` on `McpServer`
  or only the low-level `Server`? How should `git-bash` be discovered when not on PATH?
