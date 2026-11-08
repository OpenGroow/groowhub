# Publishing a Template

Official Templates are distributed through GitHub Releases and registered in
`index.json`.

## Releasing a package

Releasing is merging: a reviewed PR that bumps `version` releases that version
when it lands on `main`. There is no tag to push and no second PR.

1. In your PR, bump `version` in the package's `package.json`
   (`packages/<name>/` for a Template, `packages/publisher/<id>/` for a Publisher).
2. A code owner reviews and merges it.
3. The **Release** workflow sees that the index entry does not point at the
   new version (`tools/pending-releases.mjs`), builds the package, creates the
   tag and the GitHub Release on the merged commit, writes the new `tag`,
   `asset` and `digest` into the index and commits it to `main`. The new
   version is then installable.

A merge that does not change a version releases nothing. Tags are created by
the workflow only, and they cannot be deleted or moved: a version whose tag
exists without a release (a mistake) is burned, bump to the next one.

| Kind | Folder | Tag | Index | Build |
|---|---|---|---|---|
| Template | `packages/<name>` | `<name>@<version>` | `index.json` | `npm pack` |
| Publisher | `packages/publisher/<id>` | `publisher-<id>@<version>` | `publishers.json` | `groowhub pack publisher` |

The `publisher-` prefix is reserved: no Template may be named `publisher-<x>`.
For a Publisher, the index commit also refreshes the entry's `name`, `icon`
(from `manifest.json`) and `description` (from `package.json`).

A package's **first** index entry (`id`, `name`, `description`, `category` for
a Template, `verification`) is written by a maintainer in a reviewed PR, with
the tag of the version to release and the placeholder digest
`sha256:000...0`; merging it releases that version. The workflow only moves an
existing entry: it never adds one nor grants a trust level, and it skips a
package that has none.

If a run stops between the release and the index commit, run **Release**
again (Actions, Release, Run workflow): it reuses the existing release.

## Publisher packages

Publisher packages (Postiz, ...) are not Templates: they hold code that the
OpenGroow core runs (ADR-072 in the OpenGroow repository). They live in
`packages/publisher/<id>/` (`manifest.json`, `data/capabilities.json`,
`data/channel-options.json`, `src/index.ts` whose default export is the plugin)
and are listed in their own index, `publishers.json`.

The plugin imports only *types* from
`@opengroow/publisher-sdk`, so it builds without the SDK. The SDK is not
published: `pnpm typecheck` reads it from a checkout of the OpenGroow
repository, in `.sdk/` (CI) or next to this one (`../OpenGroow`). `pnpm test`
runs the plugins' tests; the **Validate** workflow checks the folders and `publishers.json` with
`@opengroow/groowhub-cli validate publisher` / `validate index --kind publisher`.

## Validation

Every package and `index.json` are validated with
[`@opengroow/groowhub-cli`](https://www.npmjs.com/package/@opengroow/groowhub-cli),
a published bundle of the product's manifest reader, by hand
(`npx @opengroow/groowhub-cli validate template <folder> --tag <name>@<version>`) and by the
**Validate** workflow on every pull request and push to `main`. The workflow pins the
validator version: bump it when the manifest format changes. It also runs a
[gitleaks](https://github.com/gitleaks/gitleaks) scan of the whole history.

## Repository settings (trust root)

The index decides what installs on users' deployments, so:

- mandatory 2FA for the organization;
- `main` protected: pull requests only, required status checks (`Validate`),
  required review from code owners (see `.github/CODEOWNERS`, set the real
  team), no force-push;
- Settings, Actions, General: workflow permissions "Read repository contents"
  by default;
- a GitHub App for releases, installed on this repository only, with
  "Contents: read and write": its id in the variable `RELEASE_APP_ID`, its
  private key in the secret `RELEASE_APP_PRIVATE_KEY`, and the App added as a
  bypass actor of the `main` ruleset so the **Release** workflow can commit
  the index. It is the only credential the workflows hold;
- a ruleset on tags `*@*` forbidding deletion and update, so a released
  version can never be moved.

## Hub template in the OpenGroow repository

A copy of this repository's layout is kept next to the product code
(`hub-template/` in the OpenGroow repository) so that the workflows stay in
step with the installer. Copy its contents (not a `.git`) into the hub
repository.
