# GroowHub

**Extend what your AI agents can do.**

GroowHub is the official Template hub for [OpenGroow](https://github.com/OpenGroow/OpenGroow), the open-source platform for building and managing AI agent teams. Install a Template in one click and get a ready-to-use agent, with its instructions, files, and integrations.

[![Validate](https://github.com/OpenGroow/groowhub/actions/workflows/validate.yml/badge.svg)](https://github.com/OpenGroow/groowhub/actions/workflows/validate.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

**Open source · Extensible · Powered by OpenClaw**

## Available Templates

| Template | Description | Category | Verification |
| --- | --- | --- | --- |
| [`@opengroow/source`](packages/source) | Judges every origin's Sources against a fixed rubric and routes the daily selected Source | system | official |

The full list lives in [`index.json`](index.json).

## What is a Template?

A Template is a reusable, versioned package that adds capabilities to an OpenGroow Project. It can include:

- **Agent instructions** (`CLAW.md`): what the agent does and how it behaves.
- **Workspace**: the files and resources the agent needs.
- **Profiles**: agent-specific configuration.
- **Plugins**: additional tools and integrations.
- **MCP integrations**: connections to external services.

Templates are built for OpenGroow's OpenClaw-based runtime.

## Using GroowHub

GroowHub is built into OpenGroow. No manual installation is needed.

1. Open your OpenGroow dashboard and select a Project.
2. Click **Add Agent**.
3. Choose a Template from GroowHub and install it.

OpenGroow downloads the Template from its GitHub Release and verifies its SHA-256 digest against the registry before extracting it.

To use a fork or another registry, set `OPENGROOW_HUB_REPOSITORY` (default: `OpenGroow/groowhub`).

## Creating Templates

Each Template lives in `packages/<name>/`:

```text
packages/<name>/
├── package.json   # identity, version, configuration
├── CLAW.md        # agent instructions
├── workspace/     # files and resources
├── profiles/      # agent profiles
└── plugins/       # plugins
```

Validate your Template locally:

```bash
npx @opengroow/template-validator package <folder> --tag <name>@<version>
```

See the [Template development guide](https://github.com/OpenGroow/OpenGroow/blob/main/docs/TEMPLATE_DEVELOPMENT.md) for the full package format.

## Contributing

Contributions are welcome: improvements to existing Templates, bug fixes, documentation, and proposals for new Templates.

Anyone can propose a new Template through a pull request that adds `packages/<name>/`. Describe its purpose and capabilities in the PR, and make sure it passes the validator (see [Creating Templates](#creating-templates)). You can open an issue first to discuss the idea.

Every PR is subject to validation and maintainer review. New entries in `index.json` are always added by a maintainer through a reviewed PR, and automated releases can never create trusted entries or assign verification levels, so a contributed Template is not marked `official` unless the maintainers decide so.

Maintainers: see [docs/PUBLISHING.md](docs/PUBLISHING.md) for the release process and repository settings.

## How GroowHub works

GroowHub is a GitHub-based registry. It needs no separate server.

```text
groowhub/
├── index.json              # registry index
├── packages/               # one directory per Template
├── tools/update-index.mjs  # used by the release workflow
└── .github/                # validation, release, secret scan, CODEOWNERS
```

Each registry entry tells OpenGroow where to find a Template and how to verify it:

```json
{
  "id": "@opengroow/source",
  "name": "Source Agent",
  "description": "…",
  "repository": "OpenGroow/groowhub",
  "tag": "source@1.0.0",
  "asset": "opengroow-source-1.0.0.tgz",
  "digest": "sha256:<64 hex>",
  "category": "system",
  "verification": "official"
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique identifier, `@opengroow/<name>` for official Templates |
| `repository` / `tag` / `asset` | Where to download the release archive |
| `digest` | SHA-256 of the archive, checked before extraction |
| `category` | Kind of Template (for example `system`) |
| `verification` | Trust level (for example `official`), set only through a reviewed PR |

## Security & trust

Templates can contain executable capabilities, so releases are controlled:

- **Integrity**: archives are checked against their SHA-256 digest before extraction.
- **Automated validation**: packages and index entries are checked with [`@opengroow/template-validator`](https://www.npmjs.com/package/@opengroow/template-validator) on every PR and push to `main`.
- **Secret scanning**: Git history is scanned with [Gitleaks](https://github.com/gitleaks/gitleaks).
- **Reviewed releases**: index updates require code-owner approval.
- **Controlled trust levels**: a release workflow can never assign or change `verification`.

Digest verification protects integrity, not behavior: it does not guarantee that a Template's code is safe. Only install Templates from sources you trust.

## License

GroowHub is licensed under the [MIT License](LICENSE). OpenGroow itself is distributed separately under AGPL-3.0-only.
