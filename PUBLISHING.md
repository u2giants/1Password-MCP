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

# 2. Authenticate with the npm access token, then publish
#    (publish auto-runs clean + build + test via prepublishOnly):
npm config set //registry.npmjs.org/:_authToken=<npm-token>
npm publish --access public
```

`--access public` is required — scoped packages are private by default, and
public publishing is free.

### Authentication: access token (OTP is no longer supported)

npm no longer accepts interactive OTP codes for publishing — use an **access
token**. Create one at npmjs.com → avatar → **Access Tokens** → **Generate New
Token** → **Granular Access Token** with **Read and write** on the `@u2giants`
scope (or "All packages" for the very first publish, since the package doesn't
exist yet to be selected). A classic **Automation** token also works and is
simplest for a first publish.

Authenticate with it before publishing:

```powershell
npm config set //registry.npmjs.org/:_authToken=<npm-token>
```

### Storing the token in 1Password (so any AI session can publish)

The token is kept in 1Password instead of permanently in `~/.npmrc`. It lives in
the **`vibe_coding`** vault (the only vault the OP service account can read), as
a Password item titled **`npm-publish-token`**, with the token in the password
field. Secret reference:

```
op://vibe_coding/npm-publish-token/password
```

A future AI session publishes by:

1. Reading the token via the 1Password MCP (`password_read` on the reference above).
2. `npm config set //registry.npmjs.org/:_authToken=<value>`
3. `npm publish --access public`

To rotate: generate a new npm token, update the `npm-publish-token` item in
1Password, done — nothing else references the old value.

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
