# Publishing this fork to npm (`@u2giants/1password-mcp`)

This fork is published to npm under the **`@u2giants`** scope so the Windows
setup scripts can launch it with `npx -y @u2giants/1password-mcp`, exactly the
way they launch the other npm-based MCP servers.

> This file documents the **fork's** release process. It is intentionally NOT
> part of the upstream PR to `CakeRepository/1Password-MCP`.

## How publishing works now: token-free (OIDC Trusted Publishing)

Publishing is fully automated by GitHub Actions using npm
**Trusted Publishing** (OIDC). **There is no npm token to manage or rotate** —
the runner proves its identity to npm via a short-lived OIDC credential.

You release by pushing a `v*` git tag from the `publish/u2giants-scope` branch.
The [`.github/workflows/release.yml`](.github/workflows/release.yml) workflow
then builds, tests, and publishes to npm automatically — including
**provenance**, which Trusted Publishing generates for you.

Everything happens on the **`publish/u2giants-scope`** branch. Do **not**
publish from `master` — `master`'s `package.json` is named
`@takescake/1password-mcp` because it backs the upstream PR. (The workflow also
refuses to publish anything not named `@u2giants/1password-mcp`, as a safety
net.)

## Release a new version

From the repo root, on the `publish/u2giants-scope` branch:

```powershell
git checkout publish/u2giants-scope
git pull

# 1. Bump the version in ALL of: package.json, server.json (top-level
#    "version" AND packages[0].version), and src/config.ts (SERVER_VERSION).
#    The helper keeps all of them in sync:
node scripts/bump-version.mjs patch     # 2.4.2 -> 2.4.3
#   or an exact version:  node scripts/bump-version.mjs 2.4.3
#   or:                   node scripts/bump-version.mjs minor   (new features)

# 2. Review, commit, tag, and push the tag:
git diff
git commit -am "release: version 2.4.3"
git tag v2.4.3
git push origin publish/u2giants-scope --follow-tags
```

Pushing the `v2.4.3` tag triggers `release.yml`, which:

1. Checks out the tagged commit.
2. Sets up Node 20 and upgrades npm to a version that supports Trusted
   Publishing (`npm install -g npm@latest`, needs npm >= 11.5.0).
3. Verifies the package name is `@u2giants/1password-mcp` and that all four
   version locations and the tag agree.
4. Runs `npm ci`, `npm run build`, `npm test`.
5. Runs `npm publish --access public` — authenticated via OIDC, no secret.

`--access public` keeps the scoped package public (free). Provenance is added
automatically; do not pass `--provenance` by hand.

Watch the run at:
<https://github.com/u2giants/1Password-MCP/actions>

Confirm it landed:

```powershell
npm view @u2giants/1password-mcp version    # should show the new version
```

## One-time setup on npmjs.com (already done — recorded here)

Trusted Publishing was configured once on npmjs.com for the
`@u2giants/1password-mcp` package, under **Settings → Trusted Publisher**, with:

- **Publisher:** GitHub Actions
- **Organization or user:** `u2giants`
- **Repository:** `1Password-MCP`
- **Workflow filename:** `release.yml`
- **Environment:** *(left blank — the workflow uses no GitHub Environment)*

The package's **Publishing access** is set to allow Trusted Publishing. If you
ever turn on "Require two-factor authentication and disallow tokens", make sure
the "or automation/Trusted Publishing" option stays enabled so OIDC publishes
are not blocked.

If you change the workflow **filename**, the repo name, or the user, you must
update this Trusted Publisher entry to match, or publishes will be rejected.

## After publishing

Nothing else to do. `npx -y @u2giants/1password-mcp` on any machine picks up the
new version automatically (npm serves the latest). The **consuming side is
unchanged** — the Windows setup scripts (`setup-claude-mcps.ps1`,
`setup-codex-mcps.ps1`) still launch the server with
`npx -y @u2giants/1password-mcp`. Just restart Claude Desktop / Claude Code /
Codex so they relaunch the server.

## Troubleshooting

- **"Unable to authenticate" / 401 during publish** — the Trusted Publisher
  entry on npm doesn't match. Check user `u2giants`, repo `1Password-MCP`,
  workflow `release.yml`, and that the package's Publishing access allows
  Trusted Publishing.
- **"npm version does not support Trusted Publishing"** — the upgrade step
  failed; the job needs npm >= 11.5.0.
- **Workflow didn't trigger** — confirm you pushed the tag (`--follow-tags` or
  `git push origin v2.4.3`) and that it matches `v*`.
- **Name guard failed** — you tagged a commit whose `package.json` isn't
  `@u2giants/1password-mcp` (e.g. you tagged `master`). Tag from
  `publish/u2giants-scope`.

## Where things live

- **This server's code (the fork):** <https://github.com/u2giants/1Password-MCP>
  - `publish/u2giants-scope` branch → the version published to npm.
  - `feat/item-get-edit-list` branch → the PR back to the original project.
- **npm package:** <https://www.npmjs.com/package/@u2giants/1password-mcp>
- **Upstream project:** <https://github.com/CakeRepository/1Password-MCP>
- **The Windows setup scripts** (`setup-claude-mcps.ps1`, `setup-codex-mcps.ps1`)
  live in Dropbox, not in a git repo. They reference `@u2giants/1password-mcp`.
