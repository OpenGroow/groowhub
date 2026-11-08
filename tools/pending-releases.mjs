#!/usr/bin/env node
/**
 * Lists the packages whose current version is not released yet (run by the
 * release workflow on every push to main).
 *
 *   node tools/pending-releases.mjs [root]
 *
 * Prints a JSON array of { dir, tag, index }. A package is pending when its
 * index entry does not point at the tag of its current version, or still holds
 * the placeholder digest. A package without an index entry is skipped: the
 * entry (trust level included) is added by a maintainer in a reviewed PR.
 *
 * Templates: packages/<name>, tag <name>@<version>, index.json.
 * Publishers: packages/publisher/<id>, tag publisher-<id>@<version>, publishers.json.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER_DIGEST = /^sha256:0{64}$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function folders(root, dir) {
  const path = join(root, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(path, entry.name, "package.json")))
    .map((entry) => entry.name);
}

/** @returns {{ pending: Array<{ dir: string, tag: string, index: string }>, skipped: string[] }} */
export function pendingReleases(root) {
  const candidates = [
    ...folders(root, "packages").map((name) => ({ dir: `packages/${name}`, prefix: name, index: "index.json" })),
    ...folders(root, "packages/publisher").map((id) => ({
      dir: `packages/publisher/${id}`,
      prefix: `publisher-${id}`,
      index: "publishers.json",
    })),
  ];
  const pending = [];
  const skipped = [];
  for (const { dir, prefix, index } of candidates) {
    const pkg = readJson(join(root, dir, "package.json"));
    const tag = `${prefix}@${pkg.version}`;
    const entry = readJson(join(root, index)).packages.find((e) => e.id === pkg.name);
    if (!entry) {
      skipped.push(`${pkg.name} (${dir}): no entry in ${index}`);
      continue;
    }
    if (entry.tag !== tag || PLACEHOLDER_DIGEST.test(entry.digest ?? "")) pending.push({ dir, tag, index });
  }
  return { pending, skipped };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { pending, skipped } = pendingReleases(process.argv[2] ?? ".");
  for (const line of skipped) console.error(`skipped ${line}`);
  console.log(JSON.stringify(pending));
}
