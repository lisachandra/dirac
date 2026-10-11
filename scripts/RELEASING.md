# Releasing Dirac

Dirac uses one local, resumable publisher for the VS Code extension and CLI. GitHub Actions do not build or publish stable releases.

## One-time setup

Install and authenticate the GitHub CLI:

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth status --hostname github.com
```

The publishing shell also needs the existing registry authentication:

- `VSCE_PAT` for VS Marketplace
- `OVSX_PAT` for Open VSX
- npm authentication accepted by `npm publish`

## Start a release

From a clean `master` checkout:

```bash
scripts/publish.sh patch
# or: minor / major
```

Patch releases keep the existing automatic Git-derived notes. The publisher also freezes a compact `feat` → `perf` → `fix` summary into `release-notes/<version>.json` for the in-product upgrade view.

Minor and major releases require curated notes. If the target document is missing, the same `scripts/publish.sh minor` or `major` command invokes the installed Dirac CLI with the repository's `release-notes` skill, writes a draft, and stops before changing versions, building, tagging, or publishing. Review and commit that document, then rerun the identical publish command. The publisher rejects malformed or stale notes if product files changed after the analyzed commit.

The script calculates one target version and persists it in `.scratch-release/vX.Y.Z/`. It then:

1. verifies or generates the bundled release-note document;
2. updates extension, CLI, lockfile, and Homebrew formula versions;
3. builds one local VSIX and one local npm tarball;
4. commits the release metadata and creates annotated stable/CLI tags;
5. atomically pushes the exact release source and tags;
6. creates a draft GitHub Release from the same curated notes;
7. publishes the same retained VSIX to VS Marketplace and Open VSX;
8. publishes the same retained CLI tarball to npm;
9. verifies all registries; and
10. publishes the GitHub Release last, which sends subscriber notifications.

GitHub provides source archives automatically. Stable Releases do not attach a second CI-built copy of the binaries.

A build-only check remains available:

```bash
scripts/publish.sh patch --dry-run
```

## Resume or verify a release

If any command fails or is interrupted, rerun the exact version:

```bash
scripts/publish.sh --resume v0.4.33
```

Resume never calculates a newer version. It checks source versions, tags, GitHub Release state, VS Marketplace, Open VSX, npm, and the Homebrew tarball SHA. Existing correct state is skipped; only missing work is attempted.

Common recovery behavior:

- A retained artifact is reused after a timeout or registry failure.
- A registry that already reports the version is not published again.
- A draft GitHub Release remains unannounced until every registry verifies.
- A fully completed release produces a read-only audit and exits successfully.
- A tag or published artifact that conflicts with the expected release stops the script instead of being overwritten.

Release state and artifacts remain under `.scratch-release/vX.Y.Z/` after failure. After success, large artifacts are removed and the small manifest/notes remain for local auditability. The state directory is ignored by Git.

Do not rerun `patch` after a partial release; use `--resume` for the exact version. Published package versions and release tags are immutable. If a published artifact is faulty, create a new patch release.

## Legacy paths

`scripts/publish-extension.sh` is deprecated. `.github/workflows/release-extension.yml` is a legacy manual workflow and is not part of the stable release process; do not dispatch it for releases made by `scripts/publish.sh`.
