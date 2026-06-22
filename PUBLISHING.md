# Publishing this fork to npm (`@u2giants/1password-mcp`)

This fork is published to npm under the **`@u2giants`** scope so the Windows
setup scripts can launch it with `npx -y @u2giants/1password-mcp`, exactly the
way they launch the other npm-based MCP servers.

> This file documents the **fork's** release process. It is intentionally NOT
> part of the upstream PR to `CakeRepository/1Password-MCP`.

## Where to run these

On **any machine that has this repo cloned + Node.js + internet** — simplest is
the **Windows PC in PowerShell** where the repo already lives
(`C:\repos\temp\1Password-MCP`). npm uploads to npmjs.com over the network, so
the machine doesn't matter as long as you're logged in to npm.

## First-time setup (once per machine)

```powershell
npm login          # opens a browser; sign in as the npm user "u2giants"
npm whoami         # must print: u2giants
```

## Release a new version

From the repo root, on the `publish/u2giants-scope` branch:

```powershell
git checkout publish/u2giants-scope

# 1. Bump the version everywhere it appears (keep these three in sync):
#    - package.json      "version"
#    - server.json       "version" AND packages[0].version
#    - src/config.ts     SERVER_VERSION
#    Or use npm to bump package.json automatically:
npm version patch   # 2.4.2 -> 2.4.3  (use "minor" for new features)

# 2. Publish (this auto-runs clean + build + test via prepublishOnly).
#    npm requires two-factor auth to publish, so pass your 6-digit code:
npm publish --access public --otp=123456   # replace 123456 with your authenticator code
```

`--access public` is required — scoped packages are private by default, and
public publishing is free.

### Two-factor authentication (the `--otp` flag)

npm requires 2FA to publish. If you omit `--otp` you'll get
`npm error code E403 ... Two-factor authentication ... is required`. Two ways
to satisfy it:

- **Interactive (one-off):** add `--otp=<6-digit code>` from the authenticator
  app linked to your npm account.
- **Unattended (lets an AI session publish for you):** create a **Granular
  Access Token** at npmjs.com (Access Tokens → Generate → Granular) with
  read/write on the `@u2giants` scope and **"bypass 2FA" enabled**, then store
  it once on the machine:
  `npm config set //registry.npmjs.org/:_authToken=<token>`. After that,
  `npm publish --access public` works with no prompt — so a future AI session
  can do the whole release by following this file.

## After publishing

Nothing else to do. `npx -y @u2giants/1password-mcp` on any machine picks up the
new version automatically (npm serves the latest). Just restart Claude
Desktop / Claude Code / Codex so they relaunch the server.

## Where things live

- **This server's code (the fork):** https://github.com/u2giants/1Password-MCP
  - `publish/u2giants-scope` branch → the version published to npm.
  - `feat/item-get-edit-list` branch → the PR back to the original project.
- **npm package:** https://www.npmjs.com/package/@u2giants/1password-mcp (after first publish)
- **Upstream project:** https://github.com/CakeRepository/1Password-MCP
- **The Windows setup scripts** (`setup-claude-mcps.ps1`, `setup-codex-mcps.ps1`)
  live in Dropbox, not in a git repo. They reference `@u2giants/1password-mcp`.
