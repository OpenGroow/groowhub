#!/usr/bin/env node
/**
 * Points a package's entry in index.json at a new release (run by the release
 * workflow, which then opens a PR with the result).
 *
 *   node tools/update-index.mjs --index index.json --package packages/seo \
 *     --repository OpenGroow/groowhub --tag seo@1.2.0 --file dist/opengroow-seo-1.2.0.tgz
 *
 * It rewrites `repository`, `tag`, `asset` and `digest` (sha256 of the file).
 * For a Publisher package (`publishers.json`) it also copies the display fields
 * from the package itself, so the index never drifts from it: `name` and `icon`
 * from manifest.json, `description` from package.json. The trust fields
 * (`id`, `category`, `verification`) are added by a maintainer in a reviewed
 * PR, because the index decides what installs on users' deployments. A package
 * without an entry is refused.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

/** @param {{ packages: Array<Record<string, unknown>> }} index */
export function updateIndex(index, { id, repository, tag, asset, digest, display = {} }) {
  if (!index.packages.some((entry) => entry.id === id)) {
    throw new Error(`The index has no entry for ${id}: add one (name, description, category, verification) in a reviewed PR first`);
  }
  return {
    ...index,
    packages: index.packages.map((entry) => (entry.id === id ? { ...entry, ...display, repository, tag, asset, digest } : entry)),
  };
}

function main(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) flags[argv[i]] = argv[i + 1];
  for (const required of ["--index", "--package", "--repository", "--tag", "--file"]) {
    if (!flags[required]) throw new Error(`Missing ${required}`);
  }
  const pkg = JSON.parse(readFileSync(join(flags["--package"], "package.json"), "utf-8"));
  const id = pkg.name;
  /** @type {Record<string, string>} */
  const display = {};
  if (basename(flags["--index"]) === "publishers.json") {
    const manifest = JSON.parse(readFileSync(join(flags["--package"], "manifest.json"), "utf-8"));
    for (const [key, value] of [["name", manifest.name], ["description", pkg.description], ["icon", manifest.icon]]) {
      if (typeof value === "string" && value) display[key] = value;
    }
  }
  const digest = `sha256:${createHash("sha256").update(readFileSync(flags["--file"])).digest("hex")}`;
  const index = JSON.parse(readFileSync(flags["--index"], "utf-8"));
  const updated = updateIndex(index, {
    id,
    repository: flags["--repository"],
    tag: flags["--tag"],
    asset: basename(flags["--file"]),
    digest,
    display,
  });
  writeFileSync(flags["--index"], `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`${id} -> ${flags["--tag"]} ${digest}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
