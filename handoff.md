# HANDOFF — `op_run` Windows/WSL hardening

**Repo:** `u2giants/1Password-MCP` (npm `@u2giants/1password-mcp`, **main-only**) · **Updated:** 2026-07-16
**Status:** ✅ **v2.6.0 implemented, released to npm, verified live.** One open defect (§5) + one small
outstanding task (§6).

> For a developer with **zero** prior knowledge of this project or this session. Read §0 → §6, then
> the spec **[`fix.md`](fix.md)**. You should not need to ask anyone a question.

---

## 0. What this project is (read first if you've never seen it)

This repo is a **Model Context Protocol (MCP) server**. An MCP server is a small process an AI
client (Claude Desktop, Claude Code, OpenAI Codex) launches over stdio; it exposes "tools" the AI
can call. This one exposes **1Password**: listing vaults/items, reading/creating passwords, and —
the important one — **`op_run`**.

**`op_run` exists to solve one problem:** an AI needs to *use* a secret (an API key, a DB password)
in a command **without** the plaintext ever entering the AI's context/transcript. Instead of reading
a secret and pasting it into a command, the caller passes a **`op://vault/item/field` reference in
`op_run`'s `env` map**. The server resolves it via the 1Password SDK, injects it into the child
process's environment only, and **redacts** the resolved value out of returned stdout/stderr/errors
(replaced with `«REDACTED:NAME»`).

**Who consumes it:** the owner's Windows workstation (Claude Desktop + Codex) and the Ubuntu VPS
`hetz` (Codex). All launch it unpinned via `npx -y @u2giants/1password-mcp` — see §8.

**Owner/context:** Albert Hazan (`u2giants` on GitHub). This is a **fork** — see §9 for the fork
traps, which are easy to trip on.

## 1. Prerequisites / access you need

- **Node 20+** and npm. (CI builds on Node 20; the release job needs npm ≥ 11.5.0 for Trusted Publishing.)
- **A 1Password service account token.** The server is useless without it. Supplied as
  `OP_SERVICE_ACCOUNT_TOKEN` (env), or `--service-account-token` / `--token` CLI args, or on macOS
  via `OP_KEYCHAIN_SERVICE`/`OP_KEYCHAIN_ACCOUNT` keychain lookup. See `src/config.ts`
  (`resolveServiceAccountToken`). On the owner's machines the token is already set in the client
  configs (§8).
- **Vault allow-list — a common trip-up.** `op_run`/`op_check_ref` will only resolve `op://` refs
  from allow-listed vaults. It **defaults to `["vibe_coding"]`** (`DEFAULT_ALLOWED_VAULTS`,
  `src/config.ts:41`). A ref from any other vault fails with *"not in the allowed vault list"* and the
  ref is not echoed back. Override with `--allowed-vaults a,b` or `OP_MCP_ALLOWED_VAULTS=a,b`.
- **To exercise it live** you need it wired into an MCP client (§8), not just `npm test`.

## 2. Why this work exists (the incident that started it)

An AI caller injected a 1Password secret via `op_run`'s `env` and ran it through `bash`:
`argv:["bash","-c","curl -H \"X-API-Key: $K\" …"]`. `$K` was empty, the API rejected the call, and it
was **wrongly diagnosed as "op_run's env injection is broken."**

**That was false.** Real cause: on Windows, `bash` resolves via PATH to **WSL** bash
(`C:\Windows\System32\bash.exe`; proven because a child's `pwd` returns `/mnt/c/…`). WSL starts an
isolated Linux environment that **does not inherit the Windows process environment** (no `WSLENV`
forwarding), so the injected vars were invisible inside WSL and the command ran **de-authenticated**.
Native children (cmd, PowerShell, node, curl.exe) received the env and resolved secrets correctly all
along. Full proof in `fix.md` §1.

**The expensive part wasn't the bug — it was that nothing surfaced it.** An empty result looked
identical to "tool broken": no diagnostics, no warning, no server instructions. v2.6.0 removes every
leg of that trap.

## 3. What shipped (v2.6.0)

Tag `v2.6.0` → commit `be7fe7d` → GitHub Actions → npm Trusted Publishing (OIDC, no token).
npm `latest` = **2.6.0**. CI ran build + tests green on a clean checkout.

All 8 `fix.md` items landed:
1. **Unambiguous shell selection** — tokens `cmd`/`powershell`/`pwsh`/`git-bash`/`wsl` resolved to
   absolute paths; **bare `bash`/`sh` on Windows is rejected** (that's how it silently became WSL).
   Default shell unchanged (cmd.exe on Windows).
2. **WSL guard** — WSL target + a resolved `op://` secret → **fails before spawning**, unless
   `forwardEnvToWsl:true` or `allowMissingSecretsInWsl:true`. `WSLENV` is never touched implicitly.
3. **Execution diagnostics** on every result — `executionMode`, `shellUsed`, `executable`, `platform`,
   `wsl`, `injectedEnvNames` (names only), `requestedSecretCount`, `resolvedSecretCount`.
4. Friendlier `ENOENT` for `argv`. 5. Tightened tool/param descriptions.
6. **Server-level `instructions`** (`src/instructions.ts`) so every session learns the rules passively.
7. Redaction contract documented + edge-tested (longest-value-first; `op://` refs stripped from errors).
8. `machine-atlas.md` note — **not done, see §6** (that file isn't in this repo).

> ⚠️ **Do NOT re-litigate the settled decisions.** `fix.md` §11 "Non-goals" lists four ideas that were
> considered and **deliberately rejected** after a two-round review: (a) changing the default shell to
> PowerShell, (b) a *blanket* refusal of all WSL runs, (c) returning env-var **counts instead of**
> names, (d) encoding-aware redaction (Base64/URL/JSON). Read that section before "improving" any of them.

## 4. Verified live (2026-07-16, real MCP on the Windows/WSL host)

| Scenario | Result |
|---|---|
| `command:"echo [%K%]"` + `env {K:"op://…"}` | `[«REDACTED:K»]` + full diagnostics ✅ |
| bare `shell:"bash"` on Windows | **rejected**, and *before* resolving the secret (`resolvedSecretCount: 0`) ✅ |
| `shell:"wsl"` + resolved secret, no override | **refused before spawning**, with guidance ✅ |
| `+ allowMissingSecretsInWsl:true` | guard steps aside, correct warning ✅ (but §5) |
| `+ forwardEnvToWsl:true` | WSLENV forwarded, exposure warning ✅ (but §5) |
| `argv:["not-a-real-exe-xyz"]` | friendly ENOENT explaining argv has no shell ✅ |

**The original trap is now impossible.** Unit tests: **120/120** green (local + CI).
The full live-smoke procedure is `fix.md` §12. To re-run it you must have the version you're testing
actually loaded in a client (§8) — `npm test` alone will NOT catch §5-class bugs.

---

## 5. OPEN DEFECT — the `wsl` shell token cannot execute

**Repro** (via any MCP client with this server loaded):
```jsonc
op_run { "command": "echo hi", "shell": "wsl",
         "env": { "K": "op://vibe_coding/<any item>/credential" },
         "allowMissingSecretsInWsl": true }
```
**Symptom:** exit code `4294967295`, UTF-16 stdout:
```
Invalid command line argument: -c
Please use 'wsl.exe --help' to get a list of supported arguments.
```

**Cause:** we hand the resolved `wsl.exe` path to Node's `spawn(command, { shell: <path> })`. Node's
shell convention appends `-c "<command>"` for non-cmd shells, but **`wsl.exe` does not accept `-c`** —
it wants `-e <cmd>` or `-- <cmd>`, and needs a real shell *inside* the distro.

**Blast radius: LOW but real.** The **safety guard is unaffected and works** (the point is to steer
callers away from WSL). What's broken is the **opt-in escape path**: a caller who explicitly sets
`allowMissingSecretsInWsl` or `forwardEnvToWsl` gets a confusing wsl.exe usage error instead of their
command. `cmd`, `powershell`, `pwsh`, `git-bash`, and all `argv` runs are unaffected.

**Why 120 passing tests missed it:** `tests/op-run.test.ts` **mocks `spawn`**, so it asserts the
*arguments we build*, not that `wsl.exe` accepts them. Codex (which wrote the code) never executed
anything — its runner couldn't launch a shell — so nothing touched the real binary until the
post-release live smoke.

**Proposed fix (2.6.1):** special-case the `wsl` token — do **not** route it through Node's `shell`
option. Build an explicit argv, e.g. `wsl.exe -e bash -lc "<command>"` (or `wsl.exe -- bash -c …`),
while preserving the guard, WSLENV forwarding, warnings, and diagnostics (`executionMode` stays
`"shell"`, `shellUsed` stays the resolved `wsl.exe`). Add a test asserting the built argv contains no
bare `-c` for the wsl token, and ideally **one non-mocked smoke test** that really runs a trivial
command through each resolvable shell — that class of test is what was missing.

**Workaround until fixed:** use `shell:"git-bash"` for POSIX work, or
`argv:["wsl.exe","-e","bash","-c","…"]` directly — **note `argv` bypasses the WSL guard, so do not
combine that with secrets.**

## 6. Also outstanding

- **`machine-atlas.md` note** (`fix.md` item 8): add "on Windows, bare `bash` = WSL; injected env does
  not cross the boundary." That file is **not in this repo** — it lives with the owner's global AI
  config (`~/.claude/`, synced via the `ai-devops` hub). Add it there, not here. Codex correctly
  skipped it rather than creating a stray file.

## 7. Where things live

- `src/tools/op-run.ts` — the tool: shell resolution, WSL detection/guard, `diagnostics()`,
  `redact()` (longest-value-first), `safeMessage()` (strips `op://` refs from errors).
- `src/instructions.ts` → wired in `src/index.ts` (`@modelcontextprotocol/sdk` v1.26.0 accepts
  `instructions` on `McpServer` options directly).
- `src/config.ts` — `SERVER_VERSION`, token resolution, `DEFAULT_ALLOWED_VAULTS` (L41).
- `tests/op-run.test.ts` (29 tests, **spawn is mocked**), `tests/instructions.test.ts`.
- `fix.md` — the authoritative spec (implemented) incl. **Non-goals** (§11) and the live-smoke plan (§12).
- `PUBLISHING.md` — release process. `CHANGELOG.md` — history.

## 8. Build / test / release / consume

- **Build:** `npm run build` (tsc). **Test:** `npm test` (vitest).
- **Version lives in FOUR places and they must match** (CI enforces it): `package.json` `"version"`,
  `server.json` top-level `"version"` **and** `packages[0].version`, `src/config.ts` `SERVER_VERSION`.
  Helper keeps them in sync: `node scripts/bump-version.mjs patch|minor|<exact>`.
- **Release:** bump → commit → `git tag vX.Y.Z` → `git push origin main --follow-tags`. The tag
  triggers `.github/workflows/release.yml` → OIDC Trusted Publishing (**no npm token exists to
  rotate**). Confirm: `npm view @u2giants/1password-mcp version`.
- **Consumers need NO install** — all launch it unpinned, so they pick up `latest` on restart:
  - Windows Claude Desktop (**MSIX path**):
    `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`
    (there is also a stale-looking `%APPDATA%\Claude\claude_desktop_config.json`).
  - Windows Codex: `~\.codex\config.toml` → `[mcp_servers."1password"]`.
  - VPS `hetz`: `/root/.codex/config.toml`, `command = "/usr/bin/npx"`. Not a global npm install,
    not a container — so **no Ansible/Coolify involvement**.
  - **Never hand-edit these configs** — the owner's rule; they're generated by Dropbox setup scripts
    (`setup-claude-mcps.ps1` / `setup-codex-mcps.ps1`). Nothing needed anyway: none are version-pinned.
  - If a stale version launches, clear the npx cache (`~/.npm/_npx`, or
    `%LOCALAPPDATA%\npm-cache\_npx`).
- **After publishing, restart the client** — that's the only way the new server code loads.

## 9. Environment traps (all cost time this session — do not rediscover)

- **`gh` targets the WRONG repo by default.** This repo has an `upstream` remote
  (`CakeRepository/1Password-MCP`), so `gh run list` 404s. **Always pass `-R u2giants/1Password-MCP`.**
- **Never tag from `feat/item-get-edit-list`** — that branch's `package.json` is named
  `@takescake/1password-mcp` (it backs an upstream PR). Release only from `main`; the workflow has a
  name guard that will reject it anyway.
- **On this Windows host, `bash` is WSL**, not Git Bash. The Claude Code "Bash tool" uses **Git Bash**
  (which *does* inherit Windows env) — a different `bash`. Don't conflate them.
- **The `codex` on PATH is a BROKEN install.** `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` has
  `codex.exe` but is **missing `codex-windows-sandbox-setup.exe` and `codex-command-runner.exe`**, so
  any sandboxed `codex` run fails with `program not found` and silently does nothing. The **complete**
  install is `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe` — invoke that directly. (Caused by
  running the PowerShell installer; unrepaired as of 2026-07-16.)
- **Codex model/CLI coupling:** the account's default model (`gpt-5.6-sol`) needs a recent CLI; older
  models are rejected on ChatGPT-account auth. If Codex errors on the model, update the CLI via the
  **native PowerShell** installer (`irm https://chatgpt.com/codex/install.ps1 | iex`) — `codex update`
  from Git Bash fails on an msys `tar` vs `C:` path clash.
- **Line endings:** git warns LF→CRLF on commit here. Harmless.

## 10. What we tried that did NOT work (don't repeat)

- **Concluding `op_run`'s `env` was broken.** Wrong — WSL was dropping it. A single `pwd` returning
  `/mnt/c/…` would have ended the misdiagnosis in one step. **Establish platform / resolved
  executable / shell / cwd / env-boundary BEFORE blaming a tool.**
- **Claiming the `shell` param was ignored.** Also wrong — `shell: shell ?? true` honored it; bare
  `bash` merely resolved to WSL. The evidence that settles it: with `shell:"bash"`, `$PLAIN` expanded
  to **empty** (`P=[]`), not to the literal `$PLAIN` — proving a POSIX shell ran. Don't "add shell
  support"; it was always there. The fix was **disambiguation**.
- **`argv:["echo", …]`** → `spawn echo ENOENT`. `argv` is a direct spawn with no shell; `echo` is a
  cmd builtin, not an executable.
- **`op run --env-file <(echo …)`** (process substitution) → the native `op.exe` fails on
  `/proc/<pid>/fd` msys paths. Write a **real** temp env-file instead.
- **Trusting an exit code as proof of work.** A `nohup … &` inside an already-backgrounded task
  reported "completed, exit 0" having changed nothing. **Verify the working tree**, not the exit code.
- **Trusting green unit tests as proof of behavior.** 120 passing tests + a clean CI run did not catch
  §5, because `spawn` is mocked. **Live-smoke anything that touches a real binary.**
- **Truncating investigative output.** A `grep -rl … | head -5` hid the very config file being looked
  for and nearly produced a false "it's not installed there" conclusion. Don't `head` a search whose
  absence you intend to treat as evidence.
- **`grep -A4` on `~/.codex/config.toml`** dumps the **plaintext 1Password service-account token**
  into the transcript. That token is stored unencrypted there. Extract only `command`/`args` lines.
