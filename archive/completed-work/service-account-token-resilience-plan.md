# Implementation plan — service-account token resilience

**Repo:** `u2giants/1Password-MCP` (npm `@u2giants/1password-mcp`)
**Created:** 2026-07-26 · **Owner:** Albert Hazan (POP Creations)
**Companion repo:** `u2giants/ai-devops` (the MCP launcher — half of this fix lives there)

> Read the STATUS table first. Most of this work is **already done and pushed**.
> Version 2.7.0 is published. The remaining work starts at **Step 7 (restart and
> live MCP verification)**. Do not re-derive or re-plan the earlier steps.

---

## STATUS

| # | Step | Status | Where |
|---|---|---|---|
| 1 | Root-cause the intermittent "Service account token is required" failure | ✅ done 2026-07-26 | § 6 |
| 2 | Launcher: always inject `OP_SERVICE_ACCOUNT_TOKEN`, scoped to the 1Password MCP | ✅ done 2026-07-26 | ai-devops `81954f8` |
| 3 | Launcher: also pass `OP_SERVICE_ACCOUNT_TOKEN_FILE` (path, not secret) | ✅ done 2026-07-26 | ai-devops `f5b7646` |
| 4 | Server: token-file source + limited retry + better error | ✅ done 2026-07-26 | this repo `83af486` |
| 5 | Server: version bump to 2.7.0, full retry tests, docs, registry metadata | ✅ done 2026-07-27 | this repo `main` |
| 6 | Publish v2.7.0 to npm (tag `v2.7.0`) | ✅ done 2026-07-27 | tag at `a980f6e`; run `30304069536` |
| 7 | Restart Claude Code and verify the MCP comes up with a token | ✅ done 2026-07-27 | verified live: `vault_list` via the MCP returned `vibe_coding` |
| 8 | Update docs/memory to say the fix is live | ✅ done 2026-07-27 | memory `onepassword-mcp-token-race.md` + its index line |

**✅ THIS PLAN IS COMPLETE (2026-07-27). No open steps.** All 8 steps are done:
2.7.0 is published to npm (`npm view @u2giants/1password-mcp version` → `2.7.0`), the
MCP was verified live from a restarted session (`vault_list` returned `vibe_coding`),
and the memory entry records the fix as live.

Keep this file as the record of WHY the code looks the way it does (§ 6 root causes,
§ 7 rejected approaches, § 8 locked decisions) — it is referenced from `AGENTS.md`.
Delete it only if this token-resolution design is replaced outright.

**One correction worth carrying forward** (made in `a980f6e`, reflected in § 6/§ 8):
the retry in `requireServiceAccountToken()` recovers a **token FILE** that appears or
becomes readable after startup. It does **not** rescue an env-only setup — a parent
cannot inject an environment variable into an already-running child, so env-only
configs still require a restart. Do not describe the server as generally "self-healing".

> **End-of-step drift check (mandatory).** When you finish a step, re-read the
> remaining steps below through the end of this plan and report any drift — anything
> you did or learned that changes a later step's assumptions, commands, versions, file
> paths, or decisions. Then update this file's STATUS table and the affected step text
> before moving on. A plan goes stale the moment someone executes part of it, and the
> person who executed it owns the update.

---

# Part 1 — Why

## 1. The ultimate goal — what we are actually trying to achieve

**In plain business English:** Albert's AI sessions read passwords, API keys and
tokens out of 1Password through this MCP server. Sometimes that server would start
up "broken" and every single 1Password request would fail for the rest of the
session, with an error that made it look like the 1Password account itself was
misconfigured. It wasn't — the credential was fine. The server had simply started
without it and had no way to recover.

**When this is done:** the launcher reliably gives the 1Password MCP its credential
on every start. The server also supports a cross-platform token file and retries its
configured sources once, so it can recover if that file appears or becomes readable
after startup. Environment-only processes still need a relaunch because a parent
cannot add an environment variable to an already-running child.

> **If a step in this plan conflicts with that goal, THE GOAL WINS — stop and flag
> it.** For example: if publishing the release turns out to break other consumers of
> this package, do not force the publish through just because Step 6 says so.

## 2. What this application is

`@u2giants/1password-mcp` is a **Model Context Protocol (MCP) server**: a small
Node process that an AI client (Claude Code, Claude Desktop, Codex, VS Code) starts
and talks to over stdio, giving the AI tools to read and write a **1Password** vault
via a 1Password **Service Account**.

- **Repo:** `C:\repos\1password-mcp` → https://github.com/u2giants/1Password-MCP
  (note the capital `P` in the GitHub URL; the npm name is all lowercase).
- **Branch policy:** `main` only.
- **Stack:** TypeScript → compiled with `tsc`; tested with `vitest`.
- **Published to:** the public npm registry as `@u2giants/1password-mcp`.
- **It is a fork** of `CakeRepository/1Password-MCP`, published under the
  `@u2giants` scope. Read `AGENTS.md` in this repo first for repo conventions.
- **How it actually runs on Albert's machines:** Claude Code's
  `~/.claude/settings.json` starts it as
  `cmd /c <ai-devops launcher> cmd /c npx -y @u2giants/1password-mcp`.
  **Because it runs via `npx`, the machine pulls the package from the public npm
  registry — code merged to `main` has NO effect until it is published.** That single
  fact is why Step 6 exists.
- **The only vault in play** is `vibe_coding` (the service account can reach no other).

**The launcher (the other half of this story):** every MCP on Albert's machines is
started through `~/.config/ai-devops/mcp-launch.cmd`, which runs
`C:\repos\ai-devops\bin\mcp-secret-launch.ps1`. That script reads
`op://`-style secret references from `~/.config/ai-devops/mcp.env`, resolves them
once via the 1Password CLI, and stores them in a **DPAPI-encrypted cache**
(`~/.config/ai-devops/mcp-secrets.dpapi.json`) with a **15-minute freshness window**.
It then injects those values into each MCP child process. Its purpose is to stop
every MCP launch from burning 1Password service-account requests.

## 3. What triggered this work

**Observed 2026-07-26, mid-session**, during unrelated DAM work. After an MCP
reconnect or hidden process restart, every 1Password MCP
tool call (`vault_list`, `item_get`, `item_edit`, `op_run`, …) began failing with:

```
Service account token is required. Provide it via --service-account-token,
OP_SERVICE_ACCOUNT_TOKEN, or macOS Keychain with OP_KEYCHAIN_SERVICE.
```

It had worked earlier in the same session. Nothing had been rotated or reconfigured.
The error is misleading: it reads as "you configured this wrong", so the natural
(wrong) reaction is to go hunting for a bad or expired token.

**How to reproduce the underlying condition** (you do not need to reproduce it to
implement this plan — the root cause is already proven in § 6):
1. Ensure `mcp-secrets.dpapi.json` was written less than 15 minutes ago (start any
   other MCP that uses the launcher).
2. Start the 1Password MCP through the launcher **as it was before `81954f8`**.
3. The child process comes up with no `OP_SERVICE_ACCOUNT_TOKEN` in its environment,
   and every call fails for the life of that process.

**Key diagnostic that points at the real cause:** the `op` CLI kept working the whole
time (`op vault list` succeeded), because `OP_SERVICE_ACCOUNT_TOKEN` is present in the
ordinary shell environment. Only the MCP **child process** lacked it. The credential
was never the problem.

## 4. Scope — in and out

**In scope**
- Making the launcher reliably provide the token at every server start.
- Letting the server recover when a configured token file becomes available late.
- Giving the server a credential source that works on Windows/Linux (not just macOS).
- Publishing the fix so the machines actually get it.

**NOT in scope (do not do these)**
- Rotating, re-issuing, or changing the 1Password service-account token. *(Albert's
  standing rule: never rotate an existing credential without approval, and never
  suggest rotating the service-account token.)*
- Changing which vault is allowed (`vibe_coding` stays the only one).
- Redesigning the launcher's DPAPI caching or its 15-minute window.
- Adding a token source for any MCP other than the 1Password one.
- Touching the other MCP servers (supabase, trigger, nas, devops, recall-ai).
- Any change to 1Password tool behaviour, tool list, or the `op_run` redaction contract.

---

# Part 2 — What we already know

## 5. Current state of the code

**Everything in Steps 1–5 is committed AND pushed. CI is green.** Verify rather than
redo:

```bash
git -C C:/repos/1password-mcp log --oneline -3        # expect eb38c01, 83af486
git -C C:/repos/ai-devops   log --oneline -3 -- bin/mcp-secret-launch.ps1   # expect f5b7646, 81954f8
npm view @u2giants/1password-mcp version              # expect 2.7.0
node -p "require('./package.json').version"           # in this repo: expect 2.7.0
```

### This repo (`1password-mcp`), commits `83af486` + `eb38c01`

| File | What changed |
|---|---|
| `src/config.ts:93` | **NEW** `readTokenFile(path, readFileImpl)` — reads + trims a token from disk, returns `undefined` on empty/unreadable. |
| `src/config.ts:106-153` | `resolveServiceAccountToken()` gained `tokenFileFromArgs` + `readTokenFileImpl`; precedence is now **args → env → file → macOS keychain**. |
| `src/config.ts:36` | `tokenSource` union gained `"file"`. |
| `src/config.ts:179-185` | `getConfig()` reads `--service-account-token-file` / `--token-file`. |
| `src/config.ts:218` | **NEW** `refreshServiceAccountToken()` — re-resolves against current args/env/file and updates the cached config. |
| `src/client.ts:14-36` | `requireServiceAccountToken()` now calls `refreshServiceAccountToken()` once before throwing; error message rewritten. |
| `tests/config.test.ts` | Token-file, flag-alias, and full client retry tests (see § 10). |
| `README.md` | Documents precedence + the token-file option. |
| `package.json`, `server.json`, `src/config.ts:10` | Version **2.7.0** (all three must stay in sync). |

**State:** on `main`, pushed, CI green (`gh run list --repo u2giants/1Password-MCP`).
**Published to npm** — npm `latest` is **2.7.0**.

### The launcher repo (`ai-devops`), commits `81954f8` + `f5b7646`

`C:\repos\ai-devops\bin\mcp-secret-launch.ps1`, after `Import-Cache` (~line 75-95):

```powershell
if (($CommandArgs -join ' ') -match '1password-mcp') {
  if (-not (Test-Path -LiteralPath $tokenFile)) { throw "Missing 1Password token file: $tokenFile" }
  $opToken = (Get-Content -Raw -LiteralPath $tokenFile).Trim()
  if ([string]::IsNullOrEmpty($opToken)) { throw "1Password token file is empty: $tokenFile" }
  [Environment]::SetEnvironmentVariable('OP_SERVICE_ACCOUNT_TOKEN', $opToken, 'Process')
  [Environment]::SetEnvironmentVariable('OP_SERVICE_ACCOUNT_TOKEN_FILE', $tokenFile, 'Process')
}
```

where `$tokenFile` = `~/.config/ai-devops/op-service-account`.
**State:** on `main`, pushed. This half is already live for any MCP restart.

## 6. Key findings and root cause

**There was one incident-causing launcher defect and one server resilience gap.**
The launcher fix is required for the observed incident. The server change is useful
defense for token-file users, but it cannot repair a missing environment variable in
an already-running process.

### Defect A — the launcher only exported the token on one code path

`mcp-secret-launch.ps1` injects **only the variables listed in
`~/.config/ai-devops/mcp.env`**. Those are:
`SUPABASE_ACCESS_TOKEN, DEVOPS_MCP_TOKEN, NAS_MCP_TOKEN, TRIGGER_ACCESS_TOKEN,
RECALL_AI_MCP_TOKEN, ZAI_API_KEY, ZAI_GLM_MODEL, ZAI_ANTHROPIC_BASE_URL`.

**`OP_SERVICE_ACCOUNT_TOKEN` is NOT in that list**, so it never enters the DPAPI cache.
The script set it in exactly one place — `Ensure-Cache`, line 51 — which runs **only
when the cache is stale**:

```powershell
if (-not $fresh) {
  $env:OP_SERVICE_ACCOUNT_TOKEN = (Get-Content -Raw -LiteralPath $tokenFile).Trim()
  & op run --no-masking --env-file=$envFile -- pwsh ... -Mode Capture
}
```

So whether the 1Password MCP got a credential was **a race with the 15-minute cache**:
- cache **stale** at launch → refresh path runs → token set → child inherits it → works;
- cache **fresh** at launch (e.g. a reconnect moments after another MCP refreshed it)
  → refresh path skipped → token never set → **child starts with nothing**.

Evidence gathered at the time: token file present (866 bytes); `mcp.env` has no
`OP_SERVICE_ACCOUNT_TOKEN` entry; cache file 6 minutes old (i.e. fresh) while the MCP
was failing.

### Resilience gap B — the server had no late token-file recovery

In `src/config.ts`, `getConfig()` begins `if (_config) return _config;` — **the token
is resolved once and cached.** There was no retry, so even a configured token file
that appeared or became readable later could not recover the process.

The only non-env fallback was `readMacOsKeychainToken()`, which returns
`undefined` unless `platform === 'darwin'`. **On Windows there was no fallback at
all** — even though the token was sitting readable on disk at
`~/.config/ai-devops/op-service-account` the entire time.

The error text compounded it by listing three ways to *provide* a token, implying
misconfiguration, rather than saying "this process started without one."

## 7. Approaches considered and REJECTED

| Approach | Why rejected |
|---|---|
| **Add `OP_SERVICE_ACCOUNT_TOKEN=op://…` to `mcp.env`** so the cache carries it | **Circular.** The launcher needs that very token to resolve `op://` references in the first place. Cannot bootstrap itself. |
| **Always set `OP_SERVICE_ACCOUNT_TOKEN` for every MCP child** (simplest one-liner) | **Security regression.** It would hand the master vault credential to every MCP process — supabase, trigger, recall-ai, nas, devops — including third-party code, for no benefit. The injection is deliberately scoped with `-match '1password-mcp'`. |
| **Hard-code `~/.config/ai-devops/op-service-account` inside the npm package** | This is a **public package**; baking one user's machine path into it is wrong. Hence a generic `OP_SERVICE_ACCOUNT_TOKEN_FILE` / `--service-account-token-file` that any launcher can point anywhere. |
| **Shorten or remove the 15-minute DPAPI cache window** | Treats the symptom, and the cache exists on purpose — to cap 1Password service-account request usage (see ai-devops `dc72619`). Would trade one problem for a quota problem. |
| **Just restart Claude Code when it happens** | The band-aid we were living with. Albert's standing rule is root-cause fixes, no band-aids. |
| **Fix only the launcher** (where this session initially stopped) | Fixes the observed incident, but leaves no cross-platform file source and no recovery when a configured file becomes available late. The server work is defense in depth, not the primary root-cause fix. |

### A failed attempt worth not repeating (test methodology)

Verifying the launcher fix took three tries. Two false results:
1. **Probe containing `&&`/`||`:** `mcp-launch.cmd` re-expands arguments with `%*`, so
   `cmd.exe` **split the command line at `&&`** — the marker argument never reached the
   launcher, producing a false "TOKEN_MISSING". **Use a probe with no shell metacharacters.**
2. **Probe starting with `pwsh -NoProfile`:** the script's own `param()` binder tried to
   interpret `-NoProfile` and died with *"A positional parameter cannot be found that
   accepts argument 'pwsh'"*. The production form starts with `cmd`, so **shape the probe
   like production**: `cmd /c <exe> ...`.
3. **Ambient contamination:** the test shell already had `OP_SERVICE_ACCOUNT_TOKEN` set,
   so children inherited it and *both* cases reported PRESENT. **Clear the variable in
   the test process first** (see § 9 Step 7 for the working recipe).

## 8. Design decisions already made

**LOCKED — do not relitigate:**
- **L1.** Token precedence is **args → env → file → macOS keychain**. Env stays ahead of
  file for backwards compatibility with every existing config.
- **L2.** The launcher injects the credential **only** for the `1password-mcp` child
  (matched on the joined command line). Scope is a security decision.
- **L3.** The launcher passes `OP_SERVICE_ACCOUNT_TOKEN_FILE` as a **path, not a secret**.
- **L4.** `refreshServiceAccountToken()` retries configured sources **once per failing
  call** and mutates the cached config. It can recover a late file, but cannot receive
  a new environment variable from the parent. No polling, timers, or background refresh.
- **L5.** Version **2.7.0** — a minor bump, because this adds a feature (new token source)
  and is fully backwards compatible.
- **L6.** The macOS Keychain path is kept as-is. Not deprecated, not changed.
- **L7.** The service-account token is **never** rotated as part of this work.

**OPEN — implementer's judgment:**
- **O1.** Whether to also emit a one-time startup log line naming the resolved
  `tokenSource` (helps future diagnosis; slight noise). Not required for done.
- **O2.** Whether `AGENTS.md` in this repo should link this plan (recommended; see Step 8).

---

# Part 3 — How to build it

## 9. The plan

### Steps 1–5 — ✅ ALREADY DONE

Do not redo. Confirm with the commands in § 5. If any check disagrees with the STATUS
table, **stop and reconcile before continuing** — someone else has been working here
(this repo saw concurrent releases on 2026-07-26; see § 11 G4).

---

### Step 6 — Publish v2.7.0 to npm ✅ **DONE 2026-07-27**

Albert approved the public release in chat. Tag `v2.7.0` points to `a980f6e`.
GitHub Actions run `30304069536` completed successfully, and npm reports both
`version` and the `latest` tag as `2.7.0`.

**Why this is gated:** publishing to the public npm registry is outward-facing and
effectively irreversible (npm heavily restricts unpublishing). An AI session must not
do it unprompted. **Ask, get a clear yes, then proceed.**

**What to do** — releases are tag-triggered (`.github/workflows/release.yml`, `on: push:
tags: v*`) and use **npm Trusted Publishing via OIDC**, so there is **no `NPM_TOKEN` to
find**:

```bash
git -C C:/repos/1password-mcp checkout main
git -C C:/repos/1password-mcp pull --ff-only origin main
git -C C:/repos/1password-mcp tag v2.7.0
git -C C:/repos/1password-mcp push origin v2.7.0
```

**Preconditions (check all three first):**
- `package.json`, `server.json` (top level **and** `packages[0]`) and
  `src/config.ts:10 SERVER_VERSION` all read `2.7.0` — the workflow has a validation
  step that fails the release if they disagree.
- The tag is created **from `main`**, at or after commit `eb38c01`.
- CI on `main` is green.

**Verification gate — you'll know it worked when:**
```bash
gh run list --repo u2giants/1Password-MCP --workflow release.yml --limit 1   # completed / success
npm view @u2giants/1password-mcp version                                     # prints 2.7.0
```

---

### Step 7 — Restart and verify the MCP comes up with a credential ⬜

Depends on Step 6. **A running MCP cannot pick up either fix** — the launcher change
only applies at process start, and the npm package is only re-fetched on a fresh `npx`.

1. Ask Albert to **restart Claude Code** (this is a human action; there is no way for a
   session to restart its own MCP host).
2. Verify the MCP is alive by calling the `vault_list` tool. Expect the single vault
   `vibe_coding`. Failure mode to watch for: the old error string, which would mean the
   restart did not pick up the new package.

**Optional deeper check** (launcher-level, no restart needed) — this is the recipe that
finally worked, with the three traps from § 7 avoided:

```powershell
# tokenprobe.ps1 (write to a scratch dir)
# if ([Environment]::GetEnvironmentVariable('OP_SERVICE_ACCOUNT_TOKEN')) { 'TOKEN_PRESENT' } else { 'TOKEN_MISSING' }

$cmdw='C:\Users\ahazan2\.config\ai-devops\mcp-launch.cmd'; $probe='<path>\tokenprobe.ps1'
$saved=[Environment]::GetEnvironmentVariable('OP_SERVICE_ACCOUNT_TOKEN','Process')
try {
  [Environment]::SetEnvironmentVariable('OP_SERVICE_ACCOUNT_TOKEN',$null,'Process')  # kill ambient contamination
  & $cmdw cmd /c pwsh -File $probe "@u2giants/1password-mcp"   # expect TOKEN_PRESENT
  & $cmdw cmd /c pwsh -File $probe "@some/other-mcp"           # expect TOKEN_MISSING
} finally { [Environment]::SetEnvironmentVariable('OP_SERVICE_ACCOUNT_TOKEN',$saved,'Process') }
```

**Verification gate:** `TOKEN_PRESENT` for the 1Password child, `TOKEN_MISSING` for any
other child (proving decision **L2** still holds), and a successful `vault_list`.

---

### Step 8 — De-stale the docs ⬜

Depends on Step 7 passing.
1. Update this file's **STATUS table** (Steps 6–8 → ✅ with the date).
2. Update the memory entry `onepassword-mcp-token-race.md` (in Albert's Claude memory
   directory) — it currently says the fix is committed but **not published**; change it
   to say 2.7.0 is live and the required npm version.
3. ~~**O2:** add a link to this plan from this repo's `AGENTS.md`.~~ **✅ DONE
   2026-07-26** in the same commit that added this plan — see the
   "Service-account token handling" row of the AGENTS.md documentation map. Decision
   **O2 is therefore closed.** Nothing to do here.
4. `docs/configuration.md`, `docs/development.md`, and `server.json` were corrected
   on 2026-07-27 to include the token-file source and its limited recovery behavior.

**Verification gate:** a fresh reader of `AGENTS.md` can find this plan (already true),
and the memory entry no longer claims the fix is unpublished.

## 10. Tests required

**Already added** in `tests/config.test.ts` (all passing):
1. `resolves token from a token file when env/args are absent` — asserts
   `tokenSource === "file"` and that the macOS keychain reader is **not** called.
2. `prefers env token over the token file` — asserts env wins, file reader not called.
3. `reports missing when no source yields a token` — asserts `tokenSource === "missing"`.
4. `readTokenFile trims content and swallows unreadable paths` — trims whitespace,
   returns `undefined` for blank content, for a throwing reader (ENOENT), and for
   `undefined` path.
5. `refreshServiceAccountToken recovers a token after a tokenless start` — the
   direct refresh test: starts with no token, then changes the process environment and
   asserts the resolver updates its cached state. This simulates an in-process change;
   a parent cannot make this change from outside a running child.
6. `reads a token through the --service-account-token-file CLI flag` and its
   `--token-file` alias — prove both public flags reach the real configuration path.
7. `the client retry recovers when a configured token file appears later` — proves
   the full `requireServiceAccountToken()` path, not only the resolver helper.

**Must stay green** (whole suite, run from this repo):
```bash
npm test        # vitest run — 128 tests / 8 files as of 2026-07-27
npx tsc --noEmit
npm run build
```

**No further tests are required for Steps 6–8** — they are release and verification steps,
covered by the gates above.

## 11. Constraints, standing rules, and gotchas in force

**Standing rules (Albert's, apply even if unstated elsewhere):**
- **R1.** Never rotate or replace the 1Password service-account token; never suggest
  rotating it.
- **R2.** Never write a secret **value** into a file, doc, commit, log, or chat. Reference
  secrets by 1Password **location** only. Prefer `op_run` with `op://` references.
- **R3.** No band-aids — root-cause fixes only. No silent failures: a fallback must fail
  loudly (hence the launcher `throw`s on a missing/empty token file).
- **R4.** Nothing machine-specific hard-coded into the published package.
- **R5.** Commit identity must be `Albert Hazan <u2giants@users.noreply.github.com>`.
  Check with `git var GIT_COMMITTER_IDENT` before the first commit in a repo.
- **R6.** `main`-only for this repo. Every task ends pushed with CI green.

**Gotchas specific to THIS work:**
- **G1.** `npx -y @u2giants/1password-mcp` pulls from the **public npm registry**.
  Merging to `main` changes nothing on the machine — only a publish does. This is the
  single most important fact in this plan.
- **G2.** A running MCP process **cannot** pick up either fix. A Claude Code restart is
  mandatory, and only Albert can do it.
- **G3.** The three keep-all-in-sync version locations: `package.json`, `server.json`
  (top level **and** `packages[0]`), `src/config.ts` `SERVER_VERSION`. Use
  `node scripts/bump-version.mjs <version>`; the release workflow validates them.
- **G4.** **This repo gets concurrent work.** On 2026-07-26 another session released
  2.6.1 while this change was in flight, causing a rebase conflict on exactly those
  version fields. Resolution: take upstream's version, keep your code, then re-bump.
  Always `git pull --rebase` before tagging.
- **G5.** Test-probe traps — no shell metacharacters (`&&`, `||`) through
  `mcp-launch.cmd`; start the probe with `cmd`, not `pwsh -NoProfile`; clear the
  ambient `OP_SERVICE_ACCOUNT_TOKEN` first. See § 7.
- **G6.** If the MCP is down while you work, the **`op` CLI still works** —
  `OP_SERVICE_ACCOUNT_TOKEN` is in the ordinary shell environment. Use
  `op read "op://vibe_coding/<item>/<field>"`, `op item edit …`. Do not conclude that
  1Password is unavailable.
- **G7.** On Windows, never route `op_run`/probes through bare `bash`/`sh` — PATH may
  select WSL, which does not inherit the injected environment. Use `cmd`, `powershell`,
  or `git-bash` explicitly.

## 12. Access and environment

- **Machine:** `al8960ofc`, Windows 11, user `ahazan2`, PowerShell 7 primary.
  ⚠ In Git Bash on this machine `$HOME` resolves to `Z:` (a NAS share), **not**
  `C:\Users\ahazan2`. Use explicit paths.
- **Repos:** `C:\repos\1password-mcp` (this one), `C:\repos\ai-devops` (launcher).
- **Authenticated CLIs** (verify with a real call before claiming otherwise): `gh`,
  `op`, `npm`, `supabase`, `gcloud`, `az`, `vercel`.
- **Release auth:** none needed — npm **Trusted Publishing via OIDC**. Do not hunt for
  an `NPM_TOKEN`; there isn't one.
- **1Password:** vault `vibe_coding` is the only reachable vault. The service-account
  token file is `~/.config/ai-devops/op-service-account` (**path only — never read its
  contents into a transcript**).
- **Launcher config:** `~/.config/ai-devops/mcp.env` (references),
  `~/.config/ai-devops/mcp-secrets.dpapi.json` (encrypted cache, 15-min window).
- **MCP registration:** `C:\Users\ahazan2\.claude\settings.json`, server key
  `1password`.
- **Run locally:** `npm ci && npm run build && npm test` in `C:\repos\1password-mcp`.

---

# Part 4 — Landing it

## 13. Definition of done + risks and open questions

**Definition of done — every box ticked:**
- [x] Root cause proven for both defects, written down (§ 6).
- [x] Launcher fix committed + pushed (`ai-devops` `81954f8`, `f5b7646`).
- [x] Server fix committed + pushed (`1password-mcp` `83af486`, `eb38c01`).
- [x] Token-file, both CLI aliases, and full client retry covered; full suite green
  (128 tests); `tsc --noEmit` clean; build clean.
- [x] CI green on `main`.
- [x] Albert explicitly approved the npm publish on 2026-07-27.
- [x] `v2.7.0` tag pushed; release run `30304069536` succeeded; npm `latest` = `2.7.0`.
- [ ] Claude Code restarted; `vault_list` succeeds through the MCP.
- [ ] Scoping re-verified: 1Password child `TOKEN_PRESENT`, other child `TOKEN_MISSING`.
- [ ] STATUS table, memory entry, and `AGENTS.md` link updated (Step 8).

**Risks and rollback**
| Risk | Likelihood | Mitigation / rollback |
|---|---|---|
| Publishing a bad 2.7.0 to a public registry | Low — CI green, 128 tests | Cannot unpublish; roll **forward** with 2.7.1. Consumers can pin 2.6.1. |
| Change is backwards-incompatible for other users | Very low | Purely additive: new optional arg/env, new fallback below existing sources, no signature removed. L1 keeps env ahead of file. |
| Token file readable by the wrong process | Low | The file already existed with restricted ACLs; the launcher passes only its **path**, and only to the 1Password child (L2/L3). |
| Another session releases concurrently again | Medium (happened once) | `git pull --rebase` before tagging; re-check the three version locations (G3/G4). |
| Restart doesn't pick up the new version | Low | `npx` may serve a cached copy; force with `npx -y @u2giants/1password-mcp@2.7.0` or clear the `_npx` cache under `%LOCALAPPDATA%\npm-cache\_npx`. |

**Open questions**
- **Q1 resolved 2026-07-27:** Albert approved publishing 2.7.0. Release run
  `30304069536` succeeded and npm `latest` now points to 2.7.0.
- **Q2 (non-blocking, O1):** log the resolved `tokenSource` once at startup? Decide by
  whether future diagnosis is worth one extra log line.
- **Q3 (non-blocking):** should `mcp.env`-driven MCPs get the same late-file recovery
  option for *their* tokens? Out of scope here; raise separately if another MCP shows
  the same need.

---

## Self-audit (required by the implementation-plan-writer standard)

**1. Could a brand-new AI session with no project knowledge execute this without asking
anything?** Yes. § 2 defines the app, repos, branch, stack and the `npx`-from-registry
mechanic; § 5 gives exact commands to confirm what is already done; § 9 gives every
remaining step with concrete commands and verification gates; § 12 lists paths, machine
quirks and auth. Publishing approval is recorded as resolved in Step 6 and § 13.
The next fresh session can start directly at Step 7.

**2. Does it carry every piece of background, nuance and reasoning?** Yes. Both defects
are documented with `file:line` evidence (§ 6); six rejected approaches with reasons and
three failed test methodologies are recorded (§ 7); locked vs open decisions are labeled
L1–L7 / O1–O2 (§ 8); the concurrent-release conflict and its resolution is captured as
G4; the misleading-error and working-`op`-CLI diagnostics are in § 3 and G6.

**3. Is the ultimate goal clear enough to make a correct judgment call if a step is
wrong?** Yes. § 1 states it in plain business English before any technical detail, and
carries the explicit instruction that the goal outranks the steps, with a worked example
(do not force the publish if it would break other consumers).

*Audit result: all comprehensiveness-checklist items pass. Re-run this audit after any
material edit to the plan.*
