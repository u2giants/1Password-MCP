# HANDOFF — `op_run` Windows/WSL hardening

**Repo:** `u2giants/1Password-MCP` (`@u2giants/1password-mcp`, main-only) · **Updated:** 2026-07-16
**Status:** ✅ **v2.6.0 implemented, released to npm, and verified live.** One open defect below.

> Written for a developer with zero prior context. The implementation spec is
> **[`fix.md`](fix.md)** — it is now **fully implemented** (all 8 items) and shipped. This handoff
> records what shipped, what was proven live, and the one bug that remains.

---

## 1. What shipped (v2.6.0)

Released via tag `v2.6.0` → commit `be7fe7d` → GitHub Actions → npm Trusted Publishing (OIDC).
npm `latest` = **2.6.0**. CI ran build + tests green on a clean checkout.

All 8 `fix.md` items landed: stable shell tokens, WSL fail-before-execution guard, safe execution
diagnostics, friendlier ENOENT, tightened tool description, server-level `instructions`, documented
+ tested redaction contract. (Item 8's `machine-atlas.md` note was correctly skipped — that file
lives in another repo. **Still outstanding — see §4.**)

## 2. Why it exists (the incident)

A caller injected a 1Password secret via `op_run`'s `env` and ran it through `bash`. The value
arrived empty and this was **wrongly diagnosed as an `op_run` bug**. Real cause: on Windows,
`bash` resolves via PATH to **WSL bash**, and WSL does not inherit the Windows process environment
(no `WSLENV` forwarding) — so the secret was invisible inside WSL and the command ran
de-authenticated. `op_run` was never broken. See `fix.md` §1 for the proof.

## 3. Verified live (2026-07-16, on the Windows/WSL host, against the real MCP)

| Scenario | Result |
|---|---|
| `command:"echo [%K%]"` + `env {K:"op://…"}` | `[«REDACTED:K»]` + full diagnostics ✅ |
| bare `shell:"bash"` on Windows | **rejected** before resolving the secret (`resolvedSecretCount: 0`) ✅ |
| `shell:"wsl"` + resolved secret, no override | **refused before spawning** with the guidance message ✅ |
| `+ allowMissingSecretsInWsl:true` | guard steps aside, correct warning ✅ (but see §4) |
| `+ forwardEnvToWsl:true` | WSLENV forwarded, exposure warning ✅ (but see §4) |
| `argv:["not-a-real-exe-xyz"]` | friendly ENOENT explaining argv has no shell ✅ |

**The original trap is now impossible.** Unit tests: 120/120 green (local + CI).

---

## 4. OPEN DEFECT — the `wsl` shell token cannot execute (found by live smoke)

**Symptom:** any `command` run with `shell:"wsl"` fails with:
```
Invalid command line argument: -c
Please use 'wsl.exe --help' to get a list of supported arguments.
```
(exit code 4294967295, UTF-16 stdout).

**Cause:** we hand the resolved `wsl.exe` path to Node's `spawn(command, { shell: <path> })`.
Node's shell convention appends `-c "<command>"` for non-cmd shells, but **`wsl.exe` does not
accept `-c`** — it wants `-e <cmd>` or `-- <cmd>`, and needs an actual shell inside the distro.

**Blast radius: LOW but real.** The *safety* guard is unaffected and works (the whole point is to
steer callers away from WSL). What's broken is the **opt-in escape path**: a caller who explicitly
sets `allowMissingSecretsInWsl` or `forwardEnvToWsl` gets a confusing wsl.exe usage error instead of
their command running. `git-bash`, `cmd`, `powershell`, `pwsh`, and all `argv` runs are unaffected.

**Why tests missed it:** the vitest suite mocks `spawn`, so it asserts the *arguments* we build, not
that `wsl.exe` accepts them. Codex never executed anything (its runner couldn't launch a shell), so
nothing exercised the real binary until the post-release live smoke.

**Proposed fix (2.6.1):** special-case the `wsl` token — do **not** route it through Node's `shell`
option. Build an explicit argv instead, e.g. `wsl.exe -e bash -lc "<command>"` (or `wsl.exe --
bash -c …`), while preserving the existing guard, WSLENV forwarding, warnings, and diagnostics
(`executionMode` should stay `"shell"`, `shellUsed` the resolved `wsl.exe`). Add a test that asserts
the built argv contains no bare `-c` for the wsl token. Ideally add one non-mocked smoke test that
actually runs a trivial command through each resolvable shell.

**Workaround until fixed:** use `git-bash` for POSIX work, or pass `argv:["wsl.exe","-e","bash","-c","…"]`
directly (note: `argv` bypasses the WSL guard, so don't combine it with secrets).

## 5. Also outstanding

- **`machine-atlas.md` note** (`fix.md` item 8): add the "bare `bash` on Windows = WSL; injected env
  does not cross" warning. That file is **not in this repo** — it lives with the global AI config
  (`~/.claude/` / the `ai-devops` hub), so it must be added there, not here.

## 6. Where things live

- `src/tools/op-run.ts` — the tool. Shell resolution + WSL guard + diagnostics + `redact()`.
- `src/instructions.ts` → wired in `src/index.ts` (SDK v1.26.0 supports `instructions` directly).
- `tests/op-run.test.ts` (29 tests), `tests/instructions.test.ts`.
- Version lives in **four** places that must match: `package.json`, `server.json` (top-level **and**
  `packages[0].version`), `src/config.ts` `SERVER_VERSION`. Helper: `node scripts/bump-version.mjs`.
- `PUBLISHING.md` — release = push a `v*` tag from `main`; Actions publishes via OIDC. No npm token.

## 7. Build / test / release

- `npm run build` (tsc), `npm test` (vitest).
- Release: bump ×4 → commit → `git tag vX.Y.Z` → `git push origin main --follow-tags`. Then
  `npm view @u2giants/1password-mcp version` to confirm.
- Consumers need **no install** — Windows (Claude Desktop MSIX config + `~/.codex/config.toml`) and
  the Ubuntu VPS `hetz` (`/root/.codex/config.toml`) all launch `npx -y @u2giants/1password-mcp`
  unpinned, so they pick up `latest` on restart. If npx serves a stale copy, clear the `_npx` cache.

## 8. What we tried that did NOT work (don't repeat)

- **Concluding `op_run`'s `env` was broken.** Wrong — it was WSL dropping the env. One `pwd`
  (returning `/mnt/c/…`) would have revealed it. **Establish platform / resolved executable / shell /
  cwd / env-boundary before blaming a tool.**
- **Claiming `shell` was ignored.** Also wrong — `shell: shell ?? true` honored it; bare `bash` just
  resolved to WSL. Evidence that settles it: `$PLAIN` expanded to empty (`P=[]`), not literal.
- **`argv:["echo",…]`** → `spawn echo ENOENT`: argv is a direct spawn, no shell; `echo` is a cmd
  builtin.
- **`op run --env-file <(echo …)`** (process substitution) → native `op.exe` fails on `/proc/<pid>/fd`
  msys paths. Use a real temp env-file.
- **`codex update` from Git Bash** → msys `tar` vs `C:` path clash. Use the PowerShell installer in
  **native** PowerShell.
- **Trusting an exit code as proof of work.** A `nohup … &` inside an already-backgrounded task
  reported "completed, exit 0" having done nothing. Always verify the working tree.
- **Trusting green unit tests as proof of behavior.** They mock `spawn`; the `wsl -c` defect in §4
  survived 120 passing tests and a full CI run.
