# Bundled release notes

Each published Dirac extension includes an immutable `release-notes/<version>.json` document used by the in-product upgrade experience.

- Patch documents are generated deterministically by `scripts/publish.sh` from Conventional Commit subjects, ordered `feat`, `perf`, then `fix`.
- Minor and major documents are curated with the workspace `release-notes` skill and must be reviewed and committed before publication.
- The same document renders the curated portion of the GitHub Release.
- Server-provided welcome messages may supplement bundled notes, but the bundle is the offline source of truth.

Run releases through the existing entry point:

```bash
./scripts/publish.sh patch
./scripts/publish.sh minor
./scripts/publish.sh major
```

On the first minor or major invocation, the publisher generates a draft document and stops before changing versions or publishing. Review and commit the document, then rerun the same command.
