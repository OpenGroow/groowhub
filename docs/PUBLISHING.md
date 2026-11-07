# Publishing a Template

Official Templates are distributed through GitHub Releases and registered in
`index.json`.

## Releasing a package

1. Bump `version` in `packages/<name>/package.json` and merge the change.
2. Push a tag `<name>@<version>` (for example `source@1.2.0`).
3. The **Release** workflow runs `npm pack`, attaches the `.tgz` to a GitHub Release, and opens a PR that
   updates the package's entry in `index.json` (`repository`, `tag`, `asset`,
   `digest`).
4. A code owner reviews and merges that PR. Only then does the new version
   become installable.

A package's **first** entry in `index.json` (`id`, `name`, `description`,
`category`, `verification`) is written by a maintainer in a reviewed PR; the
release workflow only moves an existing entry, it never grants a trust level.

## Publishing a Publisher package

Publisher packages (Postiz, ...) are not Templates: they hold code that the
OpenGroow core runs (ADR-072 in the OpenGroow repository). They live in
`packages/publisher/<id>/` (`manifest.json`, `data/capabilities.json`,
`data/channel-options.json`, `src/index.ts` whose default export is the plugin)
and are listed in their own index, `publishers.json`.

1. Bump `version` in `packages/publisher/<id>/package.json` and merge the change.
2. Push the tag `publisher-<id>@<version>` (for example `publisher-postiz@1.1.0`).
3. The **Release** workflow builds the package with `tools/build-publisher.mjs`
   (bundle + `npm pack`), attaches the `.tgz` to the GitHub Release and opens a PR
   that moves the entry in `publishers.json` (`tag`, `asset`, `digest`).
4. A code owner reviews and merges it.

The first entry in `publishers.json` (including the placeholder digest
`sha256:000...0` and the icon) is written by a maintainer in a reviewed PR,
like for Templates. The plugin imports only *types* from
`@opengroow/publisher-sdk`, so it builds without the SDK. `pnpm test` runs the
plugins' tests and `pnpm run validate:publishers` checks the folders and the
index.

## Validation

Every package and `index.json` are validated with
[`@opengroow/template-validator`](https://www.npmjs.com/package/@opengroow/template-validator),
a published bundle of the product's manifest reader, by hand
(`npx @opengroow/template-validator package <folder> --tag <name>@<version>`) and by the
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
  by default, and "Allow GitHub Actions to create and approve pull requests"
  enabled (the release workflow opens the index PR; PRs opened with
  `GITHUB_TOKEN` do not trigger other workflows, so a maintainer may need to
  push an empty commit or re-run **Validate** on it);
- tag protection (or a ruleset) on `*@*` so only maintainers can release;
- the workflows hold no secret from the OpenGroow repository: they use
  `GITHUB_TOKEN` only.

## Hub template in the OpenGroow repository

A copy of this repository's layout is kept next to the product code
(`hub-template/` in the OpenGroow repository) so that the workflows stay in
step with the installer. Copy its contents (not a `.git`) into the hub
repository.
