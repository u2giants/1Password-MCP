# Development

> Local run/test/lint/debug workflow. For the operating guide, start with
> [`AGENTS.md`](../AGENTS.md). For contribution rules and PR process, see
> [`CONTRIBUTING.md`](../CONTRIBUTING.md). For env/CLI config, see
> [`docs/configuration.md`](configuration.md).

## Prerequisites

- Node.js **≥ 18** (CI tests on 18, 20, 22)
- npm (the repo ships a `package-lock.json`; use `npm ci` for reproducible installs)

## Setup

```bash
git clone https://github.com/u2giants/1Password-MCP.git
cd 1Password-MCP
npm install      # or: npm ci  (clean, lockfile-exact)
```

## npm scripts

| Script | Command | What it does |
|---|---|---|
| `npm run build` | `tsc` | Compile `src/` → `dist/` |
| `npm run dev` | `tsc --watch` | Rebuild on change |
| `npm test` | `vitest run` | Run the unit suite once |
| `npm run test:watch` | `vitest` | Watch-mode tests |
| `npm run test:coverage` | `vitest run --coverage` | Coverage report |
| `npm run lint` | `tsc --noEmit` | Type-check only (this is the "lint") |
| `npm run clean` | removes `dist/` | Clear build output |
| `npm run start` | `node dist/index.js` | Run the built server over stdio |

> Note: `lint` is a TypeScript type-check, not ESLint. There is no separate
> linter configured.

## Typical loop

```bash
npm run build && npm test     # before committing
npm run lint                  # strict type-check
```

`prepublishOnly` runs `clean && build && test` automatically on publish, so a
green local `build`+`test` is the gate.

## Running the server locally

The server speaks MCP over stdio, so running it directly just waits for JSON-RPC
on stdin. Two practical ways to exercise it:

1. **Through an MCP client** — point your client at `node /abs/path/dist/index.js`
   (or `npx -y @u2giants/1password-mcp`) with `OP_SERVICE_ACCOUNT_TOKEN` set. This
   requires a real 1Password Service Account token.
2. **Unit tests** — most logic (config resolution, utils, tool/prompt
   registration) is covered without a live token. Prefer adding tests over manual
   stdio poking.

## Debugging

- Set `MCP_DEBUG=1` or `--log-level debug` for verbose startup/diagnostic logs.
- **All logs go to stderr** — stdout is the MCP protocol channel. Never add
  `console.log`/stdout writes in server code; use `log()` / `logError()` from
  `src/logger.ts`.
- Startup logs include `tokenSource` (`args`/`env`/`keychain`/`missing`), which is
  the fastest way to confirm the token was picked up.

## Adding a tool (quick recipe)

1. Create `src/tools/<name>.ts` exporting `register<Name>(server)`.
2. Import and call it in `src/tools/index.ts` (`registerAllTools`).
3. Return errors via `errorResult()` (sets MCP `isError: true`); never throw
   across the protocol boundary.
4. Add tests in `tests/tools.test.ts`.
5. Update the tool table in `README.md`.

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the full code guidelines
(strict TypeScript, no `any`, Conventional Commits).
