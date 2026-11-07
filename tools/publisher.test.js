import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPublisher } from "./build-publisher.mjs";
import { validatePublishers } from "./validate-publishers.mjs";

describe("build-publisher", () => {
  it("packs Postiz with its bundle, manifest and data", () => {
    const out = mkdtempSync(join(tmpdir(), "hub-out-"));
    const file = buildPublisher("packages/publisher/postiz", out);
    const names = execFileSync("tar", ["-tzf", file]).toString();
    for (const f of ["package/dist/plugin.mjs", "package/manifest.json", "package/data/capabilities.json", "package/data/channel-options.json", "package/package.json"]) {
      expect(names).toContain(f);
    }
  });

  it("refuses a package whose name does not follow the manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "hub-bad-"));
    const dir = join(root, "packages/publisher/postiz");
    mkdirSync(dir, { recursive: true });
    cpSync("packages/publisher/postiz", dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@opengroow/other", version: "1.0.0" }));
    expect(validatePublishers(root).join("\n")).toContain("expected publisher-postiz");
  });
});

describe("validate-publishers", () => {
  it("accepts the repository as it is", () => {
    expect(validatePublishers(".")).toEqual([]);
  });

  it("flags an index entry without a folder or with a bad digest", () => {
    const root = mkdtempSync(join(tmpdir(), "hub-idx-"));
    writeFileSync(
      join(root, "publishers.json"),
      JSON.stringify({ schemaVersion: 1, packages: [{ id: "@opengroow/publisher-x", name: "X", description: "d", repository: "a/b", tag: "publisher-x@1.0.0", asset: "a.tgz", digest: "sha256:zz", verification: "official" }] }),
    );
    const problems = validatePublishers(root).join("\n");
    expect(problems).toContain("digest must be sha256");
    expect(problems).toContain("no folder");
  });
});
