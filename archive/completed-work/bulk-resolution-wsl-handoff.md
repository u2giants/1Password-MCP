# HANDOFF — 1Password MCP bulk secret resolution and remaining WSL execution defect

**Repository:** `u2giants/1Password-MCP` — npm package `@u2giants/1password-mcp`
**Branch:** `main` (release branch; do not make releases from an upstream-contribution branch)
**Updated:** 2026-07-23
**Current release:** `v2.6.1`, commit `6cf404d`, published as npm `latest`
**Session state:** Documentation updates are present locally and deliberately **uncommitted**. The user asked only for a detailed documentation update; do not commit or push them unless they explicitly ask.

This handoff is for a developer with no prior knowledge of the server, the incident, or the preceding work. It records both the completed traffic-reduction change and the separate, still-open WSL execution defect.

---

## 1. What this application is

This repository is a Node/TypeScript [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server. MCP clients such as Claude Desktop and Codex start it as a local stdio subprocess and call its tools. The server lets an AI work with 1Password without receiving a secret value in the model conversation.

The important tool is `op_run`. A caller supplies a command plus an `env` map such as `API_KEY: "op://vibe_coding/item/credential"`. The server validates that the reference is from an allowed vault, resolves it with the 1Password SDK, injects the resulting value only into the child process environment, and redacts resolved values from tool output before returning it to the AI. It does **not** return the plaintext secret to the model.

This is a fork of `CakeRepository/1Password-MCP`, published under the scoped package name `@u2giants/1password-mcp`. The owner uses it on Windows workstations and an Ubuntu VPS. Service-account access is scoped to the `vibe_coding` vault; do not put secret values in this repository, documentation, tests, shell output, commits, or pull-request text.

## 2. What we set out to do this session, and why

Several AI sessions can start many MCP servers at once. Separately, a single `op_run` command may need several environment secrets. The prior implementation called the 1Password SDK once per `op://` environment value. That made a command with five values create five serial secret-resolution calls. Repeated sessions and commands can therefore consume the 1Password request allowance even when every call is legitimate.

The chosen minimal-complexity server change was **not** a persistent secret cache, a local broker, a daemon, or cross-process throttling. Instead, `op_run` now collects all secret references needed by one command and gives them to the SDK's `resolveAll` bulk operation once. This reduces the per-command request pattern from one SDK resolution per variable to one bulk SDK request, while keeping plaintext values in memory only for the executing MCP request and child process.

Related but separate work in `C:\repos\ai-devops` prevents startup storms: commit `c7f5b1f` adds a Windows launcher that resolves the shared MCP environment once under an OS mutex and reuses a short-lived, user-bound encrypted cache. That machine-level launcher reduces simultaneous startup refreshes. This repository's `resolveAll` change reduces a **single `op_run` command's** repeated secret work. Neither change is a distributed, account-wide rate limiter.

## 3. Current state and verified evidence

| Area | State | Evidence |
|---|---|---|
| Published package | Complete | `v2.6.1` tag at `6cf404d`; `npm view @u2giants/1password-mcp version` returned `2.6.1`. |
| Release | Complete | GitHub release workflow run `30007241675` completed successfully: <https://github.com/u2giants/1Password-MCP/actions/runs/30007241675>. |
| Bulk resolution implementation | Complete | `src/tools/op-run.ts:229-236` validates the SDK capability, collects `op://` references, and calls `client.secrets.resolveAll(secretReferences)` once. |
| Literal environment values | Preserved | If no environment value begins with `op://`, no 1Password client is initialized for resolution. This is tested so ordinary non-secret `op_run` calls do not create avoidable 1Password traffic. |
| Secret lifecycle | No persistent cache | The resolved map exists only while the `op_run` call is executing. It is used to form the child environment, output is redacted, and the call ends. A later command resolves again. |
| Tests and static checks | Passed for release | The v2.6.1 implementation passed the full suite (120 tests), TypeScript lint, and build before publication. |
| Upstream contribution | Open, not merged | Upstream PR [CakeRepository/1Password-MCP#12](https://github.com/CakeRepository/1Password-MCP/pull/12), branch `feat/op-run-op-check-ref`, includes the generic bulk change in commit `c27a574`. Its existing description explains `op_run` generally but does **not yet explain the bulk-resolution rationale in detail**. |
| Documentation in this checkout | In progress, uncommitted | `AGENTS.md`, `README.md`, `docs/architecture.md`, and `docs/development.md` have detailed local documentation changes. They were made at the user's request and have not been committed or pushed. |
| WSL shell-token execution | Still open | `src/tools/op-run.ts:487` passes `wsl.exe` through Node's `shell` option. Node uses a `-c` convention that `wsl.exe` does not accept. The guard against accidental WSL secret use still works; the explicit WSL path does not execute correctly. |

The `CHANGELOG.md` entry for `2.6.1` is accurate: this release replaces repeated per-reference SDK resolution with one bulk `resolveAll` call for an `op_run` request. It intentionally does not claim a persistent cache or cross-process coordination.

## 4. Everything tried that did not work

1. **Resolving environment references one at a time.** The old loop called the SDK separately for each `op://` environment entry. It was functionally correct but needlessly multiplied serial secret-resolution work for commands that need several credentials. It was replaced by a single `resolveAll` SDK call after all references are collected.
2. **Treating the Windows/WSL incident as failed environment injection.** It was initially believed that `op_run` was not passing variables to child processes. Native Windows children did receive them. The actual failure occurred because bare `bash` resolved to WSL on Windows, and WSL does not inherit the Windows process environment by default.
3. **Assuming mocked unit tests prove real shell behavior.** The `op_run` tests mock process spawning. They correctly cover request construction and safety decisions, but they did not prove that `wsl.exe` accepts the generated command line. A post-release live smoke exposed the `-c` incompatibility.
4. **Using `op run --env-file` with Git-Bash process substitution on Windows.** The native `op.exe` could not use the MSYS `/proc/...` file-descriptor path. The related ai-devops launcher uses a real temporary environment file instead.
5. **Using `argv:["wsl.exe", ...]` as a secret-bearing workaround.** Direct argv execution bypasses the `shell:"wsl"` guard. It must not be combined with secrets until the explicit WSL path is fixed and tested.

## 5. Root causes and key findings

- The 1Password SDK version in this project (`@1password/sdk` `0.3.1`) exposes `SecretsApi.resolveAll(secretReferences)`. `op_run` now uses that API at `src/tools/op-run.ts:236` rather than reintroducing a per-variable loop.
- The optimization is deliberately **per command**. It is a single SDK bulk request for the references in that request. It does not deduplicate across independent MCP subprocesses, sessions, or later commands, and it makes no claim about account-wide traffic control.
- The server validates all references against the configured vault allow-list before resolution. Invalid or non-allow-listed references fail before a child process starts. Keep that ordering if modifying the code.
- The server resolves only values that look like `op://` references. Literal values are copied through as literal environment values and do not require a 1Password SDK client.
- The Windows WSL issue is an execution-boundary issue, not a 1Password permission or injection issue. `wsl.exe` needs an explicit command such as `wsl.exe -e bash -lc <command>`; it cannot be used as Node's generic shell executable because it does not accept Node's `-c` invocation convention.
- The global machine atlas now documents the bare-`bash`/WSL environment boundary at `C:\repos\ai-devops\templates\system\machine-atlas.md:110-116`. The old handoff's claim that this note remained outstanding is obsolete.

## 6. Exact next steps

1. **Finish the documentation-only handoff.** Review the uncommitted Markdown diff in this repository. Verify with `git diff --check` and `git diff -- AGENTS.md README.md docs/architecture.md docs/development.md HANDOFF.md`. It is ready for the user to decide whether to commit it. Do not include secrets in the review output.
2. **If the user authorizes a documentation commit, commit only the Markdown files.** Use the repository's main-only policy, set the author to `Albert Hazan <u2giants@users.noreply.github.com>`, push `main`, and report the resulting SHA. No release/version bump is needed for prose-only changes.
3. **Update upstream PR #12's description if authorized.** Add a concise rationale: commands with several secret env values previously performed serial per-reference SDK reads; this patch collects references and invokes `resolveAll` once; it intentionally does not cache values or coordinate separate MCP processes. Do not represent upstream acceptance or a guaranteed backend network-request count that has not been independently documented.
4. **Fix the remaining WSL execution defect in a separate code change.** In `src/tools/op-run.ts`, special-case the `wsl` shell token rather than passing its executable as `spawn`'s `shell` value. Construct an explicit command path and arguments (for example `wsl.exe -e bash -lc <command>`), preserving the existing WSL secret guard, opt-in forwarding warning, diagnostics, and redaction behavior.
5. **Add two verification layers for that WSL fix.** First, add a unit test asserting the explicit WSL invocation contains no Node-style bare `-c` supplied to `wsl.exe`. Second, run a non-mocked Windows smoke test with a harmless command and no secret. Only after that passes, test the safety guard and the opt-in path with an approved non-sensitive reference. You will know it worked when `shell:"wsl"` executes the harmless command and diagnostics still report WSL accurately.
6. **Keep the traffic-control layers distinct.** If startup requests still spike, inspect the ai-devops launcher/configuration rather than adding a cache or background service here. If individual `op_run` commands use many values, retain the `resolveAll` implementation here. Do not solve either problem by exposing plaintext secrets to the AI.

## 7. Constraints and gotchas

- Secrets belong only in 1Password vault `vibe_coding`. Never print or commit a service-account token, resolved secret, password, or an entire MCP configuration file that might contain one.
- `op_run` is safe because it injects a resolved secret into a subprocess environment and redacts returned output. Do not add a tool that returns a resolved secret directly to the model.
- No persistent secret cache, local broker, daemon, or new installed software was approved for this work. The bulk resolution change is intentionally the lowest-moving-parts solution inside the server.
- The SDK call is one `resolveAll` API call for a command. Phrase its effect as reducing per-variable SDK resolution calls; do not overstate unverified internal 1Password transport behavior.
- Releases happen only from `main`. The upstream contribution branch has different package metadata and must never be tagged or published under the fork's npm package.
- Use `gh` with an explicit repository for fork operations. For the fork release repo: `gh ... -R u2giants/1Password-MCP`. The upstream PR target is `CakeRepository/1Password-MCP`.
- Consumer MCP configurations are managed by Dropbox setup scripts, not hand-edited. Restarting a client causes unpinned `npx -y @u2giants/1password-mcp` consumers to download the current npm package; clear the relevant npx cache only if a client demonstrably holds an old package.
- On Windows, bare `bash` commonly means WSL `bash`, whereas a Git-Bash-hosted coding tool may run a different bash that does inherit the Windows environment. Establish the resolved executable and environment boundary before diagnosing an `op_run` failure.

## 8. Access and environment

- Repository checkout: `C:\repos\1Password-MCP`.
- GitHub CLI and npm publication were authenticated for the v2.6.1 release. The successful release did not require an npm token because it uses GitHub Trusted Publishing.
- The upstream contribution is PR [#12](https://github.com/CakeRepository/1Password-MCP/pull/12), currently open. Its latest relevant commit is `c27a574`.
- The 1Password service-account token is supplied to MCP processes by their client configuration or the related ai-devops launcher. Its value must not be read into transcripts merely to diagnose this work.
- Relevant code: `src/tools/op-run.ts`; tests: `tests/op-run.test.ts`; version: `package.json`, `server.json` (two fields), and `src/config.ts`; release instructions: `PUBLISHING.md`.
- Relevant related implementation: `C:\repos\ai-devops` commit `c7f5b1f`. That project owns shared MCP environment startup consolidation; this project owns `op_run`'s in-process bulk secret resolution.

## 9. Open questions and risks

- **Upstream review:** PR #12 is open and the maintainers may prefer a different abstraction or test arrangement. Do not assume the upstream project will merge it.
- **PR explanation gap:** The current upstream PR body does not yet say why the `resolveAll` change matters. The local repository documentation does. Update the PR body only with user authorization or as part of a requested PR-maintenance task.
- **WSL execution:** The WSL guard prevents accidental secret forwarding, but the opt-in WSL shell mode still fails at runtime. It is not fixed by v2.6.1 and must not be presented as fixed.
- **Serial traffic beyond one command:** `resolveAll` prevents a single command from multiplying SDK calls by number of environment variables. It does not reduce a long sequence of separate `op_run` commands. The user explicitly rejected a broker/cache/daemon, so accept that boundary unless requirements change.
- **Cross-machine traffic:** A local launcher or this server cannot see use of the same service account on another workstation or VPS. Least-privilege service accounts per machine reduce blast radius; an account-wide gate would require centralized coordination and was intentionally not introduced.

## Documentation self-audit — 2026-07-23

1. **Could a developer new to the project continue without a question?** Yes. Sections 1–3 define the product, incident, release, code locations, PR, and exact working-tree state; sections 6–8 give executable next steps and access boundaries.
2. **Does it preserve failed approaches and their causes?** Yes. Section 4 records the serial-resolution design, WSL misdiagnosis, mocked-test gap, and unsafe argv workaround; section 5 records the root causes.
3. **Does each next step have a verification gate and respect scope?** Yes. Section 6 specifies the validation commands, the user-authorization boundary for commit/push/PR editing, and concrete criteria for a later WSL smoke test. No secret values are included.
