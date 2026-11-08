import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pendingReleases } from "./pending-releases.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const PLACEHOLDER = `sha256:${"0".repeat(64)}`;

function hub({ templates = {}, publishers = {}, index = [], publisherIndex = [] }) {
  const root = mkdtempSync(join(tmpdir(), "hub-"));
  const write = (path, value) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(value));
  };
  for (const [name, pkg] of Object.entries(templates)) write(`packages/${name}/package.json`, pkg);
  for (const [id, pkg] of Object.entries(publishers)) write(`packages/publisher/${id}/package.json`, pkg);
  write("index.json", { schemaVersion: 1, packages: index });
  write("publishers.json", { schemaVersion: 1, packages: publisherIndex });
  return root;
}

describe("pendingReleases", () => {
  it("is empty when every index entry points at the current version", () => {
    const root = hub({
      templates: { source: { name: "@opengroow/source", version: "1.0.1" } },
      publishers: { postiz: { name: "@opengroow/publisher-postiz", version: "1.0.1" } },
      index: [{ id: "@opengroow/source", tag: "source@1.0.1", digest: DIGEST }],
      publisherIndex: [{ id: "@opengroow/publisher-postiz", tag: "publisher-postiz@1.0.1", digest: DIGEST }],
    });
    expect(pendingReleases(root)).toEqual({ pending: [], skipped: [] });
  });

  it("releases a bumped version and a placeholder digest, with the right tag and index", () => {
    const root = hub({
      templates: { source: { name: "@opengroow/source", version: "1.0.2" } },
      publishers: { postiz: { name: "@opengroow/publisher-postiz", version: "1.0.1" } },
      index: [{ id: "@opengroow/source", tag: "source@1.0.1", digest: DIGEST }],
      publisherIndex: [{ id: "@opengroow/publisher-postiz", tag: "publisher-postiz@1.0.1", digest: PLACEHOLDER }],
    });
    expect(pendingReleases(root).pending).toEqual([
      { dir: "packages/source", tag: "source@1.0.2", index: "index.json" },
      { dir: "packages/publisher/postiz", tag: "publisher-postiz@1.0.1", index: "publishers.json" },
    ]);
  });

  it("skips a package without an index entry and ignores the publisher folder itself", () => {
    const root = hub({ publishers: { next: { name: "@opengroow/publisher-next", version: "0.1.0" } } });
    expect(pendingReleases(root)).toEqual({
      pending: [],
      skipped: ["@opengroow/publisher-next (packages/publisher/next): no entry in publishers.json"],
    });
  });
});
