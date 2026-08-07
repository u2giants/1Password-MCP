# fix.md — `op_run` Windows/WSL hardening + diagnostics

**Repo:** `u2giants/1Password-MCP` (`@u2giants/1password-mcp`) · **Baseline:** v2.5.1 (commit `4500321`)
**Target release:** v2.6.0 (additive + clarifying; no breaking change) · **Written:** 2026-07-16

This spec covers **only the changes two independent reviewers agreed on** (Claude + Codex/GPT-5.6)
after a live diagnostic session against `op_run`. Contested ideas are listed under **Non-goals**
so they are not implemented by accident.

---

## 1. Background — what actually happened

A caller passed a secret via `env: {K:"op://…/credential"}` and ran
`argv:["bash","-c","curl -H \"X-API-Key: $K\" …"]`. `$K` was empty and the API rejected the call.
This was **misdiagnosed** as "`op_run`'s `env` injection is broken." It is not.

**Verified root cause — the Windows→WSL environment boundary:**
- On this host `bash` resolves (via PATH) to **WSL** `bash` (`C:\Windows\System32\bash.exe`), proven
  by a child `pwd` returning `/mnt/c/…`. WSL starts an **isolated Linux environment that does not
  inherit the Windows process environment** `op_run` sets (no `WSLENV` forwarding). So the injected
  vars existed on the spawned Windows process but were invisible inside WSL.
- With **native** children the tool is fully correct: `env {PLAIN:"litNative"}` → PowerShell
  `$env:PLAIN.Length` == 9; `env {K:"op://…"}` → `$env:K.Length` == 19 (the real resolved secret
  length, not 0 and not the 64-char literal reference). Resolution works in both `command` and
  `argv` paths. Redaction works (`«REDACTED:K»`). `stdin` and `cwd` work.

**Correction to an earlier claim:** `shell` is **not** ignored. `src/tools/op-run.ts:172` passes
`shell: shell ?? true` to `spawn`, so it *is* honored — but it takes a **free-form name resolved via
PATH**, so `shell:"bash"` (or a bare `bash` executable) silently becomes **WSL bash**. The defect is
**PATH ambiguity**, not an ignored parameter. That reframes work item #1 below.

**The failure mode that made this expensive:** an empty result looked identical to "tool broken,"
and there was no signal (no metadata, no warning, no server instructions) to point at WSL. The
changes below remove every leg of that trap.

---

## 2. Scope

**In (agreed by both reviewers after two rounds):**
1. Stable, unambiguous `shell` selection (kill the bare-`bash`→WSL trap).
2. WSL + resolved secrets → **fail before execution** with explicit overrides (`forwardEnvToWsl` /
   `allowMissingSecretsInWsl`); never silently forward, never run de-authenticated by accident.
3. Diagnostic metadata in every result.
4. Friendlier spawn/`ENOENT` errors.
5. Tighten the `op_run` tool description.
6. Add a server-level `instructions` block (currently none) — high priority — **and** mirror the
   rules in the tool description (other MCP clients may not surface server instructions).
7. Redaction: document the contract, add edge tests, frame it honestly.
8. Add the machine-specific WSL warning to `machine-atlas.md`, and adopt the pre-blame methodology
   principle (establish platform / executable / shell / cwd / env-boundary before blaming a tool).

**Out (contested — see §11 Non-goals):** switching the default `command` shell to PowerShell;
a *blanket* refusal of all WSL runs; returning env-var counts *instead of* names; building
encoding-aware redaction.

---

## 3. Work item 1 — Stable `shell` selection (highest priority)

**Why:** `shell` **is** honored today (verified: `command:"pwd"`, `shell:"bash"` → `/mnt/c/…`, i.e.
WSL bash ran; `command:'echo "P=[$PLAIN]"'`, `shell:"bash"` → `P=[]`, empty not literal, proving a
POSIX shell ran). The defect is that a bare name like `bash` **resolves via PATH to WSL bash** — a
disambiguation problem, not a missing feature. The fix is stable identifiers mapped to resolved
absolute paths so `bash` can never silently mean WSL.

**File:** `src/tools/op-run.ts` (schema ~L100–105; spawn ~L161–175).

**Change:**
- Accept `shell` as **either** a known token **or** an absolute path:
  - `cmd` → `process.env.ComSpec` ?? `C:\Windows\System32\cmd.exe`
  - `powershell` → resolved `powershell.exe` (Windows PowerShell 5.1)
  - `pwsh` → resolved `pwsh.exe` (PowerShell 7+)
  - `git-bash` → resolved Git `bash.exe` (discover via `where`/known install paths; do **not**
    hardcode a single path)
  - `wsl` → `wsl.exe` (explicit; enables WSL handling in item #2)
  - `sh` / `bash` → **only on non-Windows** map to `/bin/sh` / `/bin/bash`
- **Never resolve a bare `bash`/`sh` via PATH on Windows.** If a bare ambiguous name is passed on
  Windows, **error** with guidance ("use `git-bash`, `wsl`, `cmd`, `powershell`, or an absolute
  path"), rather than silently launching WSL.
- If an absolute path is given, use it as-is (back-compat) but still **resolve + report** it.
- Default when `shell` is omitted: **unchanged** (`shell ?? true` → platform default; cmd.exe on
  Windows). Document this; do not repaint it (see Non-goals).
- Report the resolved shell path in the result metadata (item #3).

**Tests:** each token maps to the expected resolved executable; absolute path passes through; bare
`bash` on Windows errors with guidance; omitted `shell` keeps current default.

---

## 4. Work item 2 — WSL detection: fail **before** execution, with explicit overrides

**Why:** both reviewers agree: detect WSL and **never silently forward secrets** into the distro.
Codex convinced Claude of one refinement over an execute-then-warn design: a warning returned *after*
the run is too late — the command **already ran without its secret** and may have caused unintended
side effects (a request that silently hit an endpoint unauthenticated, a partial/destructive action).
So when WSL + resolved secret refs are detected, **fail fast before spawning**, unless the caller
explicitly opts in. This is a *usability guardrail*, not a leak claim — a non-forwarding WSL run
leaks nothing (the secret is simply absent); the risk is running de-authenticated by accident.

**File:** `src/tools/op-run.ts`.

**Change:**
- Detect a WSL target when: `shell` token is `wsl`; **or** `argv[0]` basename ∈ {`wsl`,`wsl.exe`};
  **or** the resolved executable path is `…\System32\bash.exe` or `…\System32\wsl.exe`.
- Two new optional params (both default `false`):
  - **`forwardEnvToWsl: boolean`** — forward injected vars into WSL.
  - **`allowMissingSecretsInWsl: boolean`** — run anyway, accepting that vars won't cross.
- When a WSL target is detected **and** the `env` map contains any **resolved secret ref**
  (`op://…`) **and** neither override is set: **return a structured error before spawning** —
  > "Refusing to run: target is WSL and resolved 1Password secret(s) would NOT be visible inside
  > WSL (Windows env does not cross the WSL boundary), so the command would run de-authenticated.
  > Set `forwardEnvToWsl: true` to forward via WSLENV (widens the secret's exposure into the
  > distro), `allowMissingSecretsInWsl: true` to run anyway, or use a native shell
  > (`cmd`/`powershell`/`git-bash`)."
- When `forwardEnvToWsl: true` **and** WSL target: append each injected var name to `WSLENV`
  (e.g. `NAME/u`) on the child env, preserving any existing `WSLENV`. Add a result `warning` that
  this **widens the secret's exposure into the WSL distro**.
- WSL target with only non-secret `env` (or no `env`): allowed; add an informational `warning` that
  vars won't cross. Never modify `WSLENV` implicitly.

**Tests:** WSL + secret ref + no override → pre-spawn error, nothing ran; `+ allowMissingSecretsInWsl`
→ runs, vars absent, `warning` present; `+ forwardEnvToWsl` → `WSLENV` contains names + exposure
`warning`; WSL + non-secret env → runs with informational warning; native shell → no WSL error/warning.

---

## 5. Work item 3 — Diagnostic metadata in the result

**Why:** the original failure was undebuggable because the result said nothing about *how* it ran.

**File:** `src/tools/op-run.ts` — extend the `jsonResult({...})` at ~L232–241.

**Add fields:**
- `executionMode`: `"shell" | "direct"` (command vs argv)
- `shellUsed`: resolved shell path used (command mode) or `null` (argv mode)
- `executable`: `argv[0]` (argv mode) or `null`
- `platform`: `process.platform`
- `wsl`: boolean (WSL target detected)
- `injectedEnvNames`: `resolvedEnv.map(e => e.name)` — **names only, never values/refs/paths.**
  (Names, not counts: names are caller-chosen and are what a caller needs to self-verify "did `K`
  get injected?" — a bare count can't tell you *which* var failed.)
- `requestedSecretCount` / `resolvedSecretCount`: how many `op://` refs were requested vs.
  successfully resolved, so **partial resolution is obvious**.
- keep existing: `exitCode, signal, timedOut, stdout, stderr, stdoutTruncated, stderrTruncated,
  durationMs`.
- **Document:** callers must not encode sensitive information in variable *names* (names are
  returned in diagnostics); never return references, item/field paths, or values.

**Tests:** metadata reflects executionMode/shellUsed/executable/platform/injectedEnvNames for both a
`command` and an `argv` run; secret values never appear anywhere in the result;
requested vs resolved counts differ when a ref fails to resolve.

---

## 6. Work item 4 — Friendlier spawn / `ENOENT` errors

**Why:** `spawn echo ENOENT` is opaque. Improve it — **without asserting** the target is definitely
a builtin (Codex's nuance; it may simply be absent from PATH).

**File:** `src/tools/op-run.ts` — spawn-error path (~L177–186, surfaced at ~L219–223).

**Change:** when `spawnError.code === "ENOENT"`, wrap the message:
> "Executable '<x>' was not found on PATH. Note: `argv` runs with **no shell**, so shell builtins
> (e.g. `echo`) and `$VAR`/`%VAR%` expansion are unavailable — pass a real executable, or use the
> `command` form with a shell."

Keep the redaction call on the error message (it already runs at L220/L245).

**Tests:** `argv:["definitely-not-a-real-exe"]` → error contains the guidance and the offending name.

---

## 7. Work item 5 — Tighten the `op_run` tool description

**Why:** the description is the most reliably-surfaced doc channel per tool.

**File:** `src/tools/op-run.ts` — top-level description (L76) and per-arg `.describe()` text.

**Add, concisely:**
- `argv` = **direct spawn, no shell**: no `$VAR`/`%VAR%` expansion; element 0 must be a real
  executable on PATH (not a shell builtin).
- `command` = run via a shell chosen by `shell`; on Windows the default is **cmd.exe** (use `%VAR%`);
  pass `shell:"powershell"` for `$env:VAR`.
- **Do not rely on bare `bash` on Windows** — it resolves to WSL, where injected env is not visible;
  use `git-bash` / `wsl` (+ `forward_env_to_wsl`) / a native shell.
- Put secrets in **`env`, not in `command`/`argv` text** — process command lines are observable
  outside the MCP; `op://` inside command *text* is **not** resolved (only `env` values are).
- Redaction is **transcript-output protection**, not a guarantee the secret can't leave by other
  means (files, network, child processes).

---

## 8. Work item 6 — Server-level `instructions` block

**Why:** the MCP currently ships **no** `instructions`. In Claude Code these are injected into the
session at startup (verified — peer servers' instructions appear in-context), so this is a
high-value passive channel that would have prevented the whole misdiagnosis.

**Files:**
- New `src/instructions.ts` exporting `SERVER_INSTRUCTIONS` (a short string).
- `src/index.ts:18` — pass it: `new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, {
  instructions: SERVER_INSTRUCTIONS })`. **Verify** the installed `@modelcontextprotocol/sdk`
  `McpServer`/`ServerOptions` accepts `instructions`; if only the low-level `Server` does, thread it
  through accordingly.

**Content (tight):** what `op_run` is for (use secrets without exposing plaintext); the
argv-vs-command + `%VAR%`/`$env:VAR` rules; the "bare `bash` = WSL, env won't cross" warning; put
secrets in `env`; redaction is output-only. Keep it short — it loads every session.

---

## 9. Work item 7 — Redaction: document contract + edge tests + honest framing

**Current behavior is actually solid** (`src/tools/op-run.ts:51–61`, applied at L216–220 and L245):
each resolved **secret** value is literally (split/join, regex-safe) replaced with `«REDACTED:NAME»`
across stdout, stderr, the spawn-error message, and the catch-path error. Output is
`Buffer.concat`-ed **before** redaction (L205/L213), so **chunk-boundary interleaving is not a risk**
(one of the raised concerns is already handled by design — note this explicitly).

**Do:**
- **Document the contract** (README + tool description + `docs/`): marker format `«REDACTED:NAME»`;
  covers fully-buffered stdout/stderr + error text; only values sourced from `op://` refs are
  redacted (plain `env` pass-throughs are not); empty values are skipped.
- **Add edge tests** to `tests/op-run.test.ts`: secret containing regex/shell metachars; secret
  appearing in **stderr**; empty secret skipped; **error-path** redaction; a secret that is a
  substring of a longer secret.
- **State the limits honestly:** redaction does **not** cover transformed encodings
  (Base64/URL/JSON-escaped) or leaks via files, network, child-process args, or OS process listing.
  Frame it as *transcript-output protection*, not a leak guarantee.

**Do not** build encoding-aware redaction (see Non-goals) — document it as uncovered instead.

---

## 10. Release checklist

1. Bump version in **all four** places (they must match):
   - `package.json` `"version"`
   - `server.json` → top-level `"version"` **and** `packages[0].version` (the "×2")
   - `src/config.ts` `SERVER_VERSION` (L9)
   Suggested: **2.6.0** (additive params + clarifications; no breaking change — default shell
   unchanged).
2. Update `CHANGELOG.md`.
3. `npm run build` (tsc) and `npm test` (vitest) — all green.
4. Manual smoke on the Windows/WSL host (see §12) — the scenario that started this.
5. Publish per `PUBLISHING.md`: push the version tag → Trusted Publishing releases to npm. Do **not**
   hand-publish; do **not** touch Codex config.

---

## 11. Non-goals (contested — deliberately excluded)

- **Default `command` shell → PowerShell.** Rejected: PowerShell has profile/startup surprises and
  different quoting; switching the default is a breaking behavior change. Keep cmd default; make
  `shell` explicit and documented instead.
- **Blanket refusal of all WSL runs.** Rejected: a non-forwarding WSL run leaks nothing (the secret
  is simply absent), so refusing *every* WSL run would block valid workflows. The agreed treatment
  (item #2) is narrower: fail before execution **only** when WSL + a *resolved secret ref* are
  combined (to avoid running de-authenticated by accident), always overridable. WSL with non-secret
  env just warns and runs.
- **Return env-var counts *instead of* names.** Rejected: names are caller-chosen (not secret) and
  are exactly what's needed to self-verify injection; counts can't tell you *which* var failed. (We
  do *also* return requested/resolved secret **counts** so partial resolution is visible — item #3.)
- **Encoding-aware redaction (Base64/URL/JSON).** Rejected as gold-plating for a single-user tool;
  document the gap instead (item #9).

---

## 12. Test / verification plan

- **Unit (vitest):** the per-item tests above. Mock `spawn` where possible; keep 1Password SDK
  resolution mocked (as existing `tests/op-run.test.ts` does).
- **Live smoke on the Windows/WSL host** (the origin machine):
  - `command:"echo [%K%]"`, `env {K:"op://vibe_coding/…/credential"}` → `[«REDACTED:K»]`.
  - `argv:["powershell","-NoProfile","-Command","$env:K.Length"]`, same `env` → the resolved length,
    not 0.
  - `shell:"wsl"` (or bare `bash` on Windows) + `env {K:"op://…"}` → **pre-spawn error** (nothing
    ran); `+ allowMissingSecretsInWsl:true` → runs, `$K` empty, informational `warning`;
    `+ forwardEnvToWsl:true` → var visible inside WSL and exposure `warning` present.
  - `argv:["not-a-real-exe"]` → friendly ENOENT guidance.
- Confirm no secret value ever appears in `stdout`/`stderr`/`injectedEnvNames`/error text.

---

## 13. Open questions

- Does the pinned `@modelcontextprotocol/sdk` expose `instructions` on `McpServer` options, or only
  on the low-level `Server`? (Affects item #6 wiring.)
- `git-bash` discovery: enumerate known install locations, or require an absolute path when not on
  PATH? (Lean: discover common paths, fall back to a clear error.)
