#!/usr/bin/env node
/**
 * Bump the release version in every place it must stay in sync:
 *   - package.json            "version"
 *   - server.json             top-level "version" AND packages[0].version
 *   - src/config.ts           export const SERVER_VERSION = "..."
 *
 * Usage:
 *   node scripts/bump-version.mjs 2.4.3      # set an exact version
 *   node scripts/bump-version.mjs patch      # 2.4.2 -> 2.4.3
 *   node scripts/bump-version.mjs minor      # 2.4.2 -> 2.5.0
 *   node scripts/bump-version.mjs major      # 2.4.2 -> 3.0.0
 *
 * After running: review `git diff`, commit, then tag and push:
 *   git commit -am "release: version <v>"
 *   git tag v<v>
 *   git push origin main --follow-tags
 *
 * The release.yml GitHub Actions workflow publishes to npm on the tag push
 * via Trusted Publishing (OIDC) — no token required.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const serverPath = join(root, "server.json");
const configPath = join(root, "src", "config.ts");

const SEMVER = /^\d+\.\d+\.\d+$/;

function bump(current, kind) {
  const [maj, min, pat] = current.split(".").map(Number);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  return null;
}

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/bump-version.mjs <version|patch|minor|major>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;

let next;
if (SEMVER.test(arg)) {
  next = arg;
} else if (["patch", "minor", "major"].includes(arg)) {
  next = bump(current, arg);
} else {
  console.error(`Invalid argument "${arg}". Use an x.y.z version or patch|minor|major.`);
  process.exit(1);
}

if (!SEMVER.test(next)) {
  console.error(`Computed version "${next}" is not valid semver.`);
  process.exit(1);
}

// package.json
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// server.json (top-level + packages[0])
const server = JSON.parse(readFileSync(serverPath, "utf8"));
server.version = next;
if (Array.isArray(server.packages) && server.packages[0]) {
  server.packages[0].version = next;
} else {
  console.error("server.json has no packages[0] to update.");
  process.exit(1);
}
writeFileSync(serverPath, JSON.stringify(server, null, 2) + "\n");

// src/config.ts
const configSrc = readFileSync(configPath, "utf8");
const re = /export const SERVER_VERSION = "[^"]+";/;
if (!re.test(configSrc)) {
  console.error("Could not find SERVER_VERSION in src/config.ts.");
  process.exit(1);
}
writeFileSync(
  configPath,
  configSrc.replace(re, `export const SERVER_VERSION = "${next}";`),
);

console.log(`Version: ${current} -> ${next}`);
console.log("Updated: package.json, server.json (x2), src/config.ts");
console.log("");
console.log("Next:");
console.log(`  git commit -am "release: version ${next}"`);
console.log(`  git tag v${next}`);
console.log("  git push origin main --follow-tags");
