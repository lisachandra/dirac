#!/bin/bash

# Unified, resumable local release publisher for Dirac (extension + CLI).
#
# Start a release:
#   ./scripts/publish.sh patch
#   ./scripts/publish.sh minor
#   ./scripts/publish.sh major
#
# Resume or verify one exact release:
#   ./scripts/publish.sh --resume v0.4.33
#
# Build and publication happen locally. GitHub Actions are not involved.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

REPOSITORY="dirac-run/dirac"
DEFAULT_BRANCH="master"
EXTENSION_ID="dirac-run.dirac"
NPM_PACKAGE="dirac-cli"
STATE_ROOT=".scratch-release"
MUTATED_FILES=(package.json package-lock.json cli/package.json cli/dirac.rb)
# The publisher may need an uncommitted repair to resume a failed release; do not include it in the release metadata commit.
RESUME_ALLOWED_FILES=("${MUTATED_FILES[@]}" scripts/publish.sh)

MODE=""
BUMP_TYPE=""
RESUME_TAG=""
DRY_RUN=false
VERSION=""
RELEASE_TAG=""
CLI_TAG=""
STATE_DIR=""
MANIFEST_FILE=""
RELEASE_NOTES_FILE=""
CLI_RELEASE_NOTES_FILE=""
BUNDLED_RELEASE_NOTES_FILE=""
VSIX_FILE=""
NPM_TARBALL=""
BASE_COMMIT=""
RELEASE_COMMIT=""
PREVIOUS_TAG=""
PREVIOUS_CLI_TAG=""

function log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

function log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

function log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

function log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

function die() {
    log_error "$1"
    exit 1
}

function usage() {
    cat <<'EOF'
Usage:
  ./scripts/publish.sh {patch|minor|major} [--dry-run]
  ./scripts/publish.sh --resume vX.Y.Z
EOF
}

function parse_args() {
    if [ "$#" -eq 0 ]; then
        usage
        exit 1
    fi

    while [ "$#" -gt 0 ]; do
        case "$1" in
            patch|minor|major)
                [ -z "$MODE" ] || die "Choose either a version bump or --resume, not both."
                MODE="new"
                BUMP_TYPE="$1"
                ;;
            --resume)
                [ -z "$MODE" ] || die "Choose either a version bump or --resume, not both."
                [ "$#" -ge 2 ] || die "--resume requires an exact tag such as v0.4.33."
                MODE="resume"
                RESUME_TAG="$2"
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                die "Unknown argument: $1"
                ;;
        esac
        shift
    done

    [ -n "$MODE" ] || die "Missing version bump or --resume."
    if [ "$MODE" = "resume" ] && [ "$DRY_RUN" = true ]; then
        die "--dry-run cannot be combined with --resume. Resume is already idempotent and verifies before mutating."
    fi
    if [ "$MODE" = "resume" ] && ! [[ "$RESUME_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        die "Invalid release tag '$RESUME_TAG'. Expected vX.Y.Z."
    fi
}

function require_commands() {
    local commands=(git node npm npx gh)
    local command
    for command in "${commands[@]}"; do
        command -v "$command" >/dev/null 2>&1 || die "Required command not found: $command"
    done
}

function assert_repository_root() {
    [ -f package.json ] && [ -f package-lock.json ] && [ -d cli ] && [ -d .git ] \
        || die "Run this script from the Dirac repository root."
}

function compute_new_version() {
    node -e '
const [version, bumpType] = process.argv.slice(1)
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
if (!match) throw new Error(`Cannot bump non-standard semver version: ${version}`)
let major = Number(match[1])
let minor = Number(match[2])
let patch = Number(match[3])
if (bumpType === "major") { major += 1; minor = 0; patch = 0 }
else if (bumpType === "minor") { minor += 1; patch = 0 }
else if (bumpType === "patch") { patch += 1 }
else throw new Error(`Unknown bump type: ${bumpType}`)
process.stdout.write(`${major}.${minor}.${patch}`)
' "$1" "$2"
}

function configure_release_paths() {
    VERSION="$1"
    RELEASE_TAG="v${VERSION}"
    CLI_TAG="v${VERSION}-cli"
    STATE_DIR="${STATE_ROOT}/${RELEASE_TAG}"
    MANIFEST_FILE="${STATE_DIR}/manifest.json"
    RELEASE_NOTES_FILE="${STATE_DIR}/release-notes.md"
    CLI_RELEASE_NOTES_FILE="${STATE_DIR}/cli-release-notes.md"
    BUNDLED_RELEASE_NOTES_FILE="release-notes/${VERSION}.json"
    VSIX_FILE="${STATE_DIR}/dirac-${VERSION}.vsix"
    NPM_TARBALL="${STATE_DIR}/dirac-cli-${VERSION}.tgz"
}

function manifest_get() {
    local key="$1"
    MANIFEST_PATH="$MANIFEST_FILE" MANIFEST_KEY="$key" node <<'NODE'
const fs = require("node:fs")
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"))
const value = manifest[process.env.MANIFEST_KEY]
process.stdout.write(value === undefined || value === null ? "" : String(value))
NODE
}

function manifest_set() {
    local key="$1"
    local value="$2"
    MANIFEST_PATH="$MANIFEST_FILE" MANIFEST_KEY="$key" MANIFEST_VALUE="$value" node <<'NODE'
const fs = require("node:fs")
const path = process.env.MANIFEST_PATH
const temporaryPath = `${path}.tmp.${process.pid}`
const manifest = JSON.parse(fs.readFileSync(path, "utf8"))
manifest[process.env.MANIFEST_KEY] = process.env.MANIFEST_VALUE
fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`)
fs.renameSync(temporaryPath, path)
NODE
}

function manifest_flag_is_true() {
    [ "$(manifest_get "$1")" = "true" ]
}

function publication_was_already_accepted() {
    [[ "$1" == *"already exists"* || "$1" == *"already published"* || "$1" == *"previously published"* ]]
}

function create_manifest() {
    [ ! -e "$STATE_DIR" ] || die "Release state already exists without a usable manifest: $STATE_DIR"
    mkdir -p "$STATE_ROOT"
    local temporary_state_dir="${STATE_DIR}.tmp.$$"
    mkdir "$temporary_state_dir"
    VERSION_VALUE="$VERSION" BASE_VALUE="$BASE_COMMIT" RELEASE_VALUE="$RELEASE_COMMIT" \
        PREVIOUS_VALUE="$PREVIOUS_TAG" PREVIOUS_CLI_VALUE="$PREVIOUS_CLI_TAG" \
        MANIFEST_PATH="${temporary_state_dir}/manifest.json" node <<'NODE'
const fs = require("node:fs")
const manifest = {
  version: process.env.VERSION_VALUE,
  releaseTag: `v${process.env.VERSION_VALUE}`,
  cliTag: `v${process.env.VERSION_VALUE}-cli`,
  baseCommit: process.env.BASE_VALUE,
  releaseCommit: process.env.RELEASE_VALUE,
  previousTag: process.env.PREVIOUS_VALUE,
  previousCliTag: process.env.PREVIOUS_CLI_VALUE,
  vsixSha256: "",
  npmTarballSha256: "",
  vsMarketplaceAccepted: "false",
  openVsxAccepted: "false",
  npmAccepted: "false",
  completed: "false"
}
fs.writeFileSync(process.env.MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
NODE
    mv "$temporary_state_dir" "$STATE_DIR"
}

function load_manifest() {
    [ -f "$MANIFEST_FILE" ] || die "Release manifest not found: $MANIFEST_FILE"
    [ "$(manifest_get version)" = "$VERSION" ] \
        || die "Release manifest does not belong to ${RELEASE_TAG}."
    BASE_COMMIT="$(manifest_get baseCommit)"
    RELEASE_COMMIT="$(manifest_get releaseCommit)"
    PREVIOUS_TAG="$(manifest_get previousTag)"
    PREVIOUS_CLI_TAG="$(manifest_get previousCliTag)"
}

function incomplete_release_tag() {
    [ -d "$STATE_ROOT" ] || return 0
    local manifest completed tag
    while IFS= read -r manifest; do
        completed=$(MANIFEST_PATH="$manifest" node -p \
            "String(JSON.parse(require('node:fs').readFileSync(process.env.MANIFEST_PATH, 'utf8')).completed)")
        [ "$completed" = "true" ] && continue
        tag=$(MANIFEST_PATH="$manifest" node -p \
            "JSON.parse(require('node:fs').readFileSync(process.env.MANIFEST_PATH, 'utf8')).releaseTag")
        printf '%s' "$tag"
        return 0
    done < <(find "$STATE_ROOT" -mindepth 2 -maxdepth 2 -name manifest.json \
        ! -path '*.tmp.*/*' -print | sort)
}

function sha256_file() {
    node -e '
const fs = require("node:fs")
const crypto = require("node:crypto")
const data = fs.readFileSync(process.argv[1])
process.stdout.write(crypto.createHash("sha256").update(data).digest("hex"))
' "$1"
}

function write_versions() {
    VERSION_TO_WRITE="$VERSION" node <<'NODE'
const fs = require("node:fs")
const version = process.env.VERSION_TO_WRITE

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"))
}

function writeJson(path, value, indent) {
  const temporaryPath = `${path}.scratch-release-tmp.${process.pid}`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, indent)}\n`)
  fs.renameSync(temporaryPath, path)
}

const rootPackage = readJson("package.json")
const cliPackage = readJson("cli/package.json")
const lockfile = readJson("package-lock.json")
rootPackage.version = version
cliPackage.version = version
lockfile.version = version
if (lockfile.packages?.[""]) lockfile.packages[""].version = version
if (lockfile.packages?.cli) lockfile.packages.cli.version = version
if (lockfile.dependencies?.["dirac-cli"]) lockfile.dependencies["dirac-cli"].version = version
writeJson("package.json", rootPackage, 4)
writeJson("cli/package.json", cliPackage, "\t")
writeJson("package-lock.json", lockfile, 4)
NODE
}

function write_homebrew_formula() {
    local sha256="$1"
    VERSION_TO_WRITE="$VERSION" SHA_TO_WRITE="$sha256" node <<'NODE'
const fs = require("node:fs")
const version = process.env.VERSION_TO_WRITE
const sha = process.env.SHA_TO_WRITE
const path = "cli/dirac.rb"
const temporaryPath = `${path}.scratch-release-tmp.${process.pid}`
let formula = fs.readFileSync(path, "utf8")
formula = formula.replace(
  /url "https:\/\/registry\.npmjs\.org\/dirac-cli\/-\/dirac-cli-[^"]+\.tgz"/,
  `url "https://registry.npmjs.org/dirac-cli/-/dirac-cli-${version}.tgz"`
)
formula = formula.replace(/sha256 "[a-f0-9]+"/, `sha256 "${sha}"`)
fs.writeFileSync(temporaryPath, formula)
fs.renameSync(temporaryPath, path)
NODE
}

function assert_clean_worktree() {
    [ -z "$(git status --porcelain)" ] || die "Working tree is dirty. Commit or stash changes before starting a release."
}

function assert_only_release_or_publisher_files_changed() {
    local status path allowed allowed_file
    while IFS= read -r status; do
        [ -n "$status" ] || continue
        path="${status:3}"
        if [ "$path" = "$BUNDLED_RELEASE_NOTES_FILE" ] && [ -z "$RELEASE_COMMIT" ]; then
            continue
        fi
        allowed=false
        for allowed_file in "${RESUME_ALLOWED_FILES[@]}"; do
            if [ "$path" = "$allowed_file" ]; then
                allowed=true
                break
            fi
        done
        [ "$allowed" = true ] || die "Unexpected working-tree change while resuming: $path"
    done < <(git status --porcelain)
}

function sync_remote_metadata() {
    log_step "Refreshing origin/master and release tags..."
    git fetch origin \
        "+refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}" \
        "refs/tags/*:refs/tags/*"
}

function local_tag_commit() {
    git rev-parse -q --verify "refs/tags/$1" >/dev/null 2>&1 || return 1
    git rev-list -n 1 "$1"
}

function remote_tag_commit() {
    local tag="$1"
    local refs peeled direct
    refs=$(git ls-remote origin "refs/tags/${tag}" "refs/tags/${tag}^{}") \
        || die "Could not read remote tag ${tag}."
    peeled=$(printf '%s\n' "$refs" | awk '$2 ~ /\^\{\}$/ { print $1; exit }')
    if [ -n "$peeled" ]; then
        printf '%s' "$peeled"
        return 0
    fi
    direct=$(printf '%s\n' "$refs" | awk '$2 !~ /\^\{\}$/ { print $1; exit }')
    [ -n "$direct" ] || return 1
    printf '%s' "$direct"
}

function discover_previous_tag() {
    local source_ref="$1"
    local target_tag="$2"
    local kind="$3"
    local tag
    while IFS= read -r tag; do
        [ "$tag" != "$target_tag" ] || continue
        if [ "$kind" = "stable" ] && [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            printf '%s' "$tag"
            return 0
        fi
        if [ "$kind" = "cli" ] && [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-cli$ ]]; then
            printf '%s' "$tag"
            return 0
        fi
    done < <(git tag --merged "$source_ref" --sort=-version:refname)
    return 0
}

function generate_release_notes() {
    local output_file="$1"
    local title="$2"
    local previous_tag="$3"
    local target_tag="$4"
    local source_ref="$5"
    local changes

    if [ -n "$previous_tag" ]; then
        changes=$(git log "${previous_tag}..${source_ref}" --pretty=format:"- %s" --no-merges \
            | grep -iE '^- (feat|fix|perf|docs|revert)[:(]' || true)
    else
        changes=$(git log "$source_ref" --pretty=format:"- %s" --no-merges \
            | grep -iE '^- (feat|fix|perf|docs|revert)[:(]' \
            | head -50 || true)
    fi

    {
        echo "## ${title}"
        echo ""
        if [ -n "$changes" ]; then
            printf '%s\n' "$changes"
        else
            echo "- (no user-facing changes)"
        fi
        echo ""
        if [ -n "$previous_tag" ]; then
            echo "**Full Changelog**: https://github.com/${REPOSITORY}/compare/${previous_tag}...${target_tag}"
        fi
    } > "$output_file"
}

function validate_curated_release_notes() {
    node scripts/release-notes.mjs validate-curated \
        --input "$BUNDLED_RELEASE_NOTES_FILE" \
        --version "$VERSION" \
        --kind "$BUMP_TYPE" \
        --previous-tag "$PREVIOUS_TAG" \
        --head "$BASE_COMMIT"
}

function validate_patch_release_notes() {
    node scripts/release-notes.mjs validate-patch \
        --input "$BUNDLED_RELEASE_NOTES_FILE" \
        --document-path "$BUNDLED_RELEASE_NOTES_FILE" \
        --version "$VERSION" \
        --previous-tag "$PREVIOUS_TAG" \
        --head "$BASE_COMMIT"
}

function infer_release_kind() {
    local previous_tag="$1"
    local version="$2"
    node - "$previous_tag" "$version" <<'NODE'
const previousTag = process.argv[2]
const targetVersion = process.argv[3]
const previousMatch = /^v(\d+)\.(\d+)\.(\d+)$/.exec(previousTag)
const targetMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(targetVersion)
if (!previousMatch || !targetMatch) process.exit(1)
const previous = previousMatch.slice(1).map(Number)
const target = targetMatch.slice(1).map(Number)
let kind
if (target[0] > previous[0] && target[1] === 0 && target[2] === 0) kind = "major"
else if (target[0] === previous[0] && target[1] > previous[1] && target[2] === 0) kind = "minor"
else if (target[0] === previous[0] && target[1] === previous[1] && target[2] > previous[2]) kind = "patch"
else process.exit(1)
process.stdout.write(kind)
NODE
}

function validate_committed_bundled_release_notes() {
    [ -n "$RELEASE_COMMIT" ] || return
    if ! git cat-file -e "${RELEASE_COMMIT}:${BUNDLED_RELEASE_NOTES_FILE}" 2>/dev/null; then
        log_warn "Release commit ${RELEASE_COMMIT} predates bundled release notes; skipping bundled-note validation."
        return
    fi

    local temporary_notes
    temporary_notes=$(mktemp)
    git show "${RELEASE_COMMIT}:${BUNDLED_RELEASE_NOTES_FILE}" > "$temporary_notes"
    log_step "Validating bundled release notes in ${RELEASE_COMMIT}..."
    if [ "$BUMP_TYPE" = "patch" ]; then
        if ! node scripts/release-notes.mjs validate-patch \
            --input "$temporary_notes" \
            --document-path "$BUNDLED_RELEASE_NOTES_FILE" \
            --version "$VERSION" \
            --previous-tag "$PREVIOUS_TAG" \
            --head "$BASE_COMMIT"; then
            rm -f "$temporary_notes"
            die "Committed bundled release notes are invalid for ${RELEASE_TAG}."
        fi
    else
        if ! node scripts/release-notes.mjs validate-curated \
            --input "$temporary_notes" \
            --document-path "$BUNDLED_RELEASE_NOTES_FILE" \
            --version "$VERSION" \
            --kind "$BUMP_TYPE" \
            --previous-tag "$PREVIOUS_TAG" \
            --head "$BASE_COMMIT"; then
            rm -f "$temporary_notes"
            die "Committed bundled release notes are invalid for ${RELEASE_TAG}."
        fi
    fi
    rm -f "$temporary_notes"
}

function generate_curated_release_notes_draft() {
    command -v dirac >/dev/null 2>&1 \
        || die "Curated notes for ${RELEASE_TAG} are missing and the 'dirac' CLI is not installed. Create ${BUNDLED_RELEASE_NOTES_FILE} manually or install Dirac."

    local prompt
    prompt=$(cat <<EOF
Activate the release-notes skill and prepare curated user-facing release notes for ${RELEASE_TAG}.
Analyze every user-facing change in ${PREVIOUS_TAG}..${BASE_COMMIT}.
Write exactly ${BUNDLED_RELEASE_NOTES_FILE} with:
- version: ${VERSION}
- kind: ${BUMP_TYPE}
- sourceTag: ${PREVIOUS_TAG}
- analyzedCommit: ${BASE_COMMIT}
Modify no other file. Use subagents for independent product areas.
EOF
)

    log_step "Generating curated release-note draft for ${RELEASE_TAG} with Dirac..."
    if ! dirac task --act --yolo --subagents --no-index --cwd "$PWD" "$prompt"; then
        die "Dirac could not generate curated release notes. No release metadata or artifacts were created."
    fi
    [ -f "$BUNDLED_RELEASE_NOTES_FILE" ] \
        || die "Dirac completed without creating ${BUNDLED_RELEASE_NOTES_FILE}."

    local status changed_path
    while IFS= read -r status; do
        [ -n "$status" ] || continue
        changed_path="${status:3}"
        [ "$changed_path" = "$BUNDLED_RELEASE_NOTES_FILE" ] \
            || die "Release-note generation changed an unexpected file: ${changed_path}"
    done < <(git status --porcelain)

    validate_curated_release_notes
    echo ""
    log_info "Created curated release-note draft: ${BUNDLED_RELEASE_NOTES_FILE}"
    echo "Review and edit the draft, commit it, then rerun: ./scripts/publish.sh ${BUMP_TYPE}"
    exit 1
}

function ensure_curated_release_notes_ready() {
    case "$BUMP_TYPE" in
        minor|major)
            if [ ! -f "$BUNDLED_RELEASE_NOTES_FILE" ]; then
                generate_curated_release_notes_draft
            fi
            validate_curated_release_notes
            ;;
    esac
}

function ensure_bundled_release_notes() {
    if [ -f "$BUNDLED_RELEASE_NOTES_FILE" ]; then
        if [ "$BUMP_TYPE" = "patch" ]; then
            validate_patch_release_notes
        fi
        return
    fi
    if [ -n "$RELEASE_COMMIT" ]; then
        return
    fi
    [ "$BUMP_TYPE" = "patch" ] \
        || die "Missing bundled release notes: ${BUNDLED_RELEASE_NOTES_FILE}"

    log_step "Generating bundled patch notes for ${RELEASE_TAG}..."
    node scripts/release-notes.mjs generate-patch \
        --version "$VERSION" \
        --previous-tag "$PREVIOUS_TAG" \
        --source-ref "$BASE_COMMIT" \
        --output "$BUNDLED_RELEASE_NOTES_FILE"
    validate_patch_release_notes
}

function ensure_release_notes() {
    local source_ref="${RELEASE_COMMIT:-$BASE_COMMIT}"
    local bundled_notes_input="$BUNDLED_RELEASE_NOTES_FILE"
    if [ -n "$RELEASE_COMMIT" ] && git cat-file -e "${RELEASE_COMMIT}:${BUNDLED_RELEASE_NOTES_FILE}" 2>/dev/null; then
        bundled_notes_input="${STATE_DIR}/bundled-release-notes.json"
        git show "${RELEASE_COMMIT}:${BUNDLED_RELEASE_NOTES_FILE}" > "$bundled_notes_input"
    fi
    if [ ! -f "$RELEASE_NOTES_FILE" ]; then
        local bundled_kind=""
        if [ -f "$bundled_notes_input" ]; then
            bundled_kind=$(BUNDLED_NOTES_PATH="$bundled_notes_input" node -p \
                "JSON.parse(require('node:fs').readFileSync(process.env.BUNDLED_NOTES_PATH, 'utf8')).kind || ''")
        fi
        if [ "$bundled_kind" = "minor" ] || [ "$bundled_kind" = "major" ]; then
            node scripts/release-notes.mjs render \
                --input "$bundled_notes_input" \
                --output "$RELEASE_NOTES_FILE" \
                --version "$VERSION" \
                --previous-tag "$PREVIOUS_TAG" \
                --repository "$REPOSITORY"
        else
            generate_release_notes "$RELEASE_NOTES_FILE" "Highlights" "$PREVIOUS_TAG" "$RELEASE_TAG" "$source_ref"
        fi
    fi
    if [ ! -f "$CLI_RELEASE_NOTES_FILE" ]; then
        generate_release_notes "$CLI_RELEASE_NOTES_FILE" "CLI changes" "$PREVIOUS_CLI_TAG" "$CLI_TAG" "$source_ref"
    fi
}

function package_version_at_ref() {
    local ref="$1"
    local path="$2"
    git show "${ref}:${path}" | node -e '
let input = ""
process.stdin.on("data", chunk => input += chunk)
process.stdin.on("end", () => process.stdout.write(JSON.parse(input).version || ""))
'
}

function version_snapshot_matches() {
    local ref="$1"
    local root_version cli_version formula_version
    root_version=$(package_version_at_ref "$ref" package.json) || return 1
    cli_version=$(package_version_at_ref "$ref" cli/package.json) || return 1
    REF_TO_CHECK="$ref" EXPECTED_VERSION="$VERSION" node <<'NODE' || return 1
const { execFileSync } = require("node:child_process")
const ref = process.env.REF_TO_CHECK
const expected = process.env.EXPECTED_VERSION
const input = execFileSync("git", ["show", `${ref}:package-lock.json`], { encoding: "utf8" })
const lock = JSON.parse(input)
const versions = [lock.version, lock.packages?.[""]?.version, lock.packages?.cli?.version].filter(Boolean)
process.exit(versions.every(version => version === expected) ? 0 : 1)
NODE
    formula_version=$(git show "${ref}:cli/dirac.rb" | sed -n 's#.*dirac-cli-\([0-9][0-9.]*\)\.tgz.*#\1#p' | head -1)
    [ "$root_version" = "$VERSION" ] \
        && [ "$cli_version" = "$VERSION" ] \
        && [ "$formula_version" = "$VERSION" ]
}

function formula_sha_at_ref() {
    git show "$1:cli/dirac.rb" | sed -n 's/.*sha256 "\([a-f0-9]*\)".*/\1/p' | head -1
}

function find_release_commit() {
    local commit
    if commit=$(local_tag_commit "$RELEASE_TAG"); then
        printf '%s' "$commit"
        return 0
    fi

    commit=$(git log --all --format='%H' --extended-regexp \
        --grep="^chore: bump version to ${RELEASE_TAG}$" -n 1)
    if [ -n "$commit" ] && [ "$(package_version_at_ref "$commit" package.json)" = "$VERSION" ]; then
        printf '%s' "$commit"
        return 0
    fi
    return 1
}

function verify_retained_artifact() {
    local path="$1"
    local manifest_key="$2"
    local expected actual
    [ -f "$path" ] || return 1
    expected=$(manifest_get "$manifest_key")
    [ -n "$expected" ] || return 1
    actual=$(sha256_file "$path")
    if [ "$actual" != "$expected" ]; then
        die "Retained artifact checksum changed: $path"
    fi
    return 0
}

function assert_build_checkout() {
    local expected_ref="${RELEASE_COMMIT:-$BASE_COMMIT}"
    [ "$(git rev-parse HEAD)" = "$expected_ref" ] \
        || die "An artifact is missing, but HEAD is not the release source ${expected_ref}. Restore that release checkout and rerun --resume."
    assert_only_release_or_publisher_files_changed
}

function ensure_vsix() {
    if verify_retained_artifact "$VSIX_FILE" vsixSha256; then
        log_info "Reusing retained VSIX: $VSIX_FILE"
        return
    fi

    local expected_sha actual_sha
    expected_sha=$(manifest_get vsixSha256)
    assert_build_checkout
    log_step "Building extension package locally..."
    rm -f "$VSIX_FILE"
    npx @vscode/vsce package --allow-missing-repository --out "$VSIX_FILE"
    [ -f "$VSIX_FILE" ] || die "Expected extension package was not created: $VSIX_FILE"
    actual_sha=$(sha256_file "$VSIX_FILE")
    if [ -n "$expected_sha" ] && [ "$actual_sha" != "$expected_sha" ]; then
        die "Rebuilt VSIX does not match the retained release checksum. Restore the original artifact."
    fi
    [ -n "$expected_sha" ] || manifest_set vsixSha256 "$actual_sha"
}

function ensure_npm_tarball() {
    local expected_sha actual_sha committed_formula_sha
    expected_sha=$(manifest_get npmTarballSha256)

    if verify_retained_artifact "$NPM_TARBALL" npmTarballSha256; then
        actual_sha=$(sha256_file "$NPM_TARBALL")
        log_info "Reusing retained npm tarball: $NPM_TARBALL"
    else
        assert_build_checkout
        log_step "Building CLI npm package locally..."
        rm -f "$NPM_TARBALL"
        npm run compile-standalone-npm
        npm pack ./dist-standalone --pack-destination "$STATE_DIR"
        [ -f "$NPM_TARBALL" ] || die "Expected CLI package was not created: $NPM_TARBALL"
        actual_sha=$(sha256_file "$NPM_TARBALL")
        if [ -n "$expected_sha" ] && [ "$actual_sha" != "$expected_sha" ]; then
            die "Rebuilt npm tarball does not match the retained release checksum. Restore the original artifact."
        fi
        [ -n "$expected_sha" ] || manifest_set npmTarballSha256 "$actual_sha"
    fi

    if [ -z "$RELEASE_COMMIT" ]; then
        write_homebrew_formula "$actual_sha"
        return
    fi

    committed_formula_sha=$(formula_sha_at_ref "$RELEASE_COMMIT")
    [ "$actual_sha" = "$committed_formula_sha" ] \
        || die "CLI tarball does not match the Homebrew SHA in release commit ${RELEASE_COMMIT}."
}

function ensure_release_commit() {
    if [ -n "$RELEASE_COMMIT" ]; then
        version_snapshot_matches "$RELEASE_COMMIT" \
            || die "Release commit ${RELEASE_COMMIT} does not contain a consistent ${VERSION} version snapshot."
        return
    fi

    if [ "$(git rev-parse HEAD)" != "$BASE_COMMIT" ]; then
        local subject parent
        subject=$(git log -1 --format='%s' HEAD)
        parent=$(git rev-parse HEAD^ 2>/dev/null || true)
        if [ "$subject" = "chore: bump version to ${RELEASE_TAG}" ] && [ "$parent" = "$BASE_COMMIT" ] \
            && version_snapshot_matches HEAD; then
            RELEASE_COMMIT=$(git rev-parse HEAD)
            manifest_set releaseCommit "$RELEASE_COMMIT"
            return
        fi
        die "HEAD moved since ${RELEASE_TAG} preparation began. Resume from the release checkout instead."
    fi

    assert_only_release_or_publisher_files_changed
    git add "${MUTATED_FILES[@]}" "$BUNDLED_RELEASE_NOTES_FILE"
    git diff --cached --quiet && die "No release metadata changes are available to commit."
    log_step "Committing release metadata..."
    git commit -m "chore: bump version to ${RELEASE_TAG}"
    RELEASE_COMMIT=$(git rev-parse HEAD)
    manifest_set releaseCommit "$RELEASE_COMMIT"
    version_snapshot_matches "$RELEASE_COMMIT" \
        || die "Created release commit does not contain a consistent ${VERSION} version snapshot."
}

function ensure_local_tag() {
    local tag="$1"
    local notes_file="$2"
    local existing
    if existing=$(local_tag_commit "$tag"); then
        [ "$existing" = "$RELEASE_COMMIT" ] \
            || die "Local tag ${tag} points to ${existing}, expected ${RELEASE_COMMIT}."
        return
    fi
    log_step "Creating annotated tag ${tag}..."
    git tag -a "$tag" "$RELEASE_COMMIT" -F "$notes_file"
}

function ensure_local_tags() {
    validate_committed_bundled_release_notes
    ensure_release_notes
    ensure_local_tag "$RELEASE_TAG" "$RELEASE_NOTES_FILE"
    ensure_local_tag "$CLI_TAG" "$CLI_RELEASE_NOTES_FILE"
}

function ensure_remote_refs() {
    local remote_branch remote_release_tag remote_cli_tag
    local refspecs=()

    remote_branch=$(git rev-parse "refs/remotes/origin/${DEFAULT_BRANCH}")
    if [ "$remote_branch" != "$RELEASE_COMMIT" ]; then
        if git merge-base --is-ancestor "$RELEASE_COMMIT" "$remote_branch"; then
            log_info "Remote ${DEFAULT_BRANCH} already contains release commit ${RELEASE_COMMIT}."
        elif git merge-base --is-ancestor "$remote_branch" "$RELEASE_COMMIT"; then
            refspecs+=("${RELEASE_COMMIT}:refs/heads/${DEFAULT_BRANCH}")
        else
            die "origin/${DEFAULT_BRANCH} diverged from release commit ${RELEASE_COMMIT}; refusing to push."
        fi
    fi

    if remote_release_tag=$(remote_tag_commit "$RELEASE_TAG"); then
        [ "$remote_release_tag" = "$RELEASE_COMMIT" ] \
            || die "Remote tag ${RELEASE_TAG} points to ${remote_release_tag}, expected ${RELEASE_COMMIT}."
    else
        refspecs+=("refs/tags/${RELEASE_TAG}:refs/tags/${RELEASE_TAG}")
    fi

    if remote_cli_tag=$(remote_tag_commit "$CLI_TAG"); then
        [ "$remote_cli_tag" = "$RELEASE_COMMIT" ] \
            || die "Remote tag ${CLI_TAG} points to ${remote_cli_tag}, expected ${RELEASE_COMMIT}."
    else
        refspecs+=("refs/tags/${CLI_TAG}:refs/tags/${CLI_TAG}")
    fi

    if [ "${#refspecs[@]}" -eq 0 ]; then
        log_info "GitHub source branch and tags are already correct."
        return
    fi

    log_step "Atomically pushing release source and tags..."
    git push --atomic origin "${refspecs[@]}"
    sync_remote_metadata
}

function github_release_state() {
    local json
    if json=$(gh release view "$RELEASE_TAG" --repo "$REPOSITORY" \
        --json tagName,isDraft,isPrerelease,url 2>/dev/null); then
        RELEASE_JSON="$json" node <<'NODE'
const release = JSON.parse(process.env.RELEASE_JSON)
if (release.isPrerelease) process.stdout.write("prerelease")
else if (release.isDraft) process.stdout.write("draft")
else process.stdout.write("public")
NODE
        return
    fi

    gh api "repos/${REPOSITORY}" --silent >/dev/null \
        || die "Cannot access ${REPOSITORY} through gh. Run 'gh auth status' and try again."
    printf 'missing'
}

function require_gh_authentication() {
    gh auth status --hostname github.com >/dev/null 2>&1 \
        || die "GitHub CLI is not authenticated. Run: gh auth login --hostname github.com"
}

function ensure_draft_release() {
    local state
    state=$(github_release_state)
    case "$state" in
        draft|public)
            log_info "GitHub Release ${RELEASE_TAG} already exists (${state})."
            ;;
        prerelease)
            die "GitHub Release ${RELEASE_TAG} unexpectedly exists as a prerelease."
            ;;
        missing)
            local args=(release create "$RELEASE_TAG" --repo "$REPOSITORY" --verify-tag --draft
                --generate-notes --title "Dirac ${RELEASE_TAG}" --notes-file "$RELEASE_NOTES_FILE")
            if [ -n "$PREVIOUS_TAG" ]; then
                args+=(--notes-start-tag "$PREVIOUS_TAG")
            fi
            log_step "Creating draft GitHub Release ${RELEASE_TAG}..."
            gh "${args[@]}"
            ;;
        *)
            die "Unknown GitHub Release state: $state"
            ;;
    esac
}

function marketplace_has_version() {
    local json
    json=$(npx @vscode/vsce show "$EXTENSION_ID" --json) \
        || die "Could not query VS Marketplace."
    EXPECTED_VERSION="$VERSION" node -e '
const extension = JSON.parse(require("node:fs").readFileSync(0, "utf8"))
const expected = process.env.EXPECTED_VERSION
process.exit((extension.versions || []).some(version => version.version === expected) ? 0 : 1)
' <<< "$json"
}

function open_vsx_has_version() {
    EXPECTED_VERSION="$VERSION" node --input-type=module <<'NODE'
const version = process.env.EXPECTED_VERSION
const response = await fetch(`https://open-vsx.org/api/dirac-run/dirac/${version}`)
if (response.status === 404) process.exit(1)
if (!response.ok) throw new Error(`Open VSX query failed: HTTP ${response.status}`)
const extension = await response.json()
process.exit(extension.version === version ? 0 : 1)
NODE
}

function npm_has_version() {
    local json
    json=$(npm view "$NPM_PACKAGE" versions --json) || die "Could not query npm."
    EXPECTED_VERSION="$VERSION" node -e '
const versions = JSON.parse(require("node:fs").readFileSync(0, "utf8"))
const list = Array.isArray(versions) ? versions : [versions]
process.exit(list.includes(process.env.EXPECTED_VERSION) ? 0 : 1)
' <<< "$json"
}


function remote_release_refs_match() {
    local branch stable cli
    branch=$(git rev-parse "refs/remotes/origin/${DEFAULT_BRANCH}") || return 1
    git merge-base --is-ancestor "$RELEASE_COMMIT" "$branch" || return 1
    stable=$(remote_tag_commit "$RELEASE_TAG") || return 1
    cli=$(remote_tag_commit "$CLI_TAG") || return 1
    [ "$stable" = "$RELEASE_COMMIT" ] && [ "$cli" = "$RELEASE_COMMIT" ]
}

function release_is_complete() {
    local complete=true state
    log_step "Auditing ${RELEASE_TAG}..."

    if ! version_snapshot_matches "$RELEASE_COMMIT"; then
        log_warn "Version snapshot is incomplete."
        complete=false
    fi
    if ! remote_release_refs_match; then
        log_warn "Remote source refs are incomplete."
        complete=false
    fi
    if ! manifest_flag_is_true vsMarketplaceAccepted; then
        log_warn "VS Marketplace publication acceptance is not recorded."
        complete=false
    fi
    if ! manifest_flag_is_true openVsxAccepted; then
        log_warn "Open VSX publication acceptance is not recorded."
        complete=false
    fi
    if ! manifest_flag_is_true npmAccepted; then
        log_warn "npm publication acceptance is not recorded."
        complete=false
    fi
    state=$(github_release_state)
    if [ "$state" != "public" ]; then
        log_warn "GitHub Release is ${state}."
        complete=false
    fi

    [ "$complete" = true ]
}


function publish_missing_registries() {
    local publish_output

    if manifest_flag_is_true vsMarketplaceAccepted; then
        log_info "VS Marketplace accepted ${VERSION}; skipping."
    elif marketplace_has_version; then
        manifest_set vsMarketplaceAccepted true
        log_info "VS Marketplace already has ${VERSION}; skipping."
    else
        [ -n "${VSCE_PAT:-}" ] || die "VSCE_PAT is required because VS Marketplace is missing ${VERSION}."
        ensure_vsix
        log_step "Publishing retained VSIX to VS Marketplace..."
        if publish_output=$(npx @vscode/vsce publish --packagePath "$VSIX_FILE" -p "$VSCE_PAT" 2>&1); then
            printf '%s\n' "$publish_output"
        elif publication_was_already_accepted "$publish_output"; then
            log_info "VS Marketplace already accepted ${VERSION}."
        else
            printf '%s\n' "$publish_output" >&2
            die "Could not publish retained VSIX to VS Marketplace."
        fi
        manifest_set vsMarketplaceAccepted true
    fi

    if manifest_flag_is_true openVsxAccepted; then
        log_info "Open VSX accepted ${VERSION}; skipping."
    elif open_vsx_has_version; then
        manifest_set openVsxAccepted true
        log_info "Open VSX already has ${VERSION}; skipping."
    else
        [ -n "${OVSX_PAT:-}" ] || die "OVSX_PAT is required because Open VSX is missing ${VERSION}."
        ensure_vsix
        log_step "Publishing retained VSIX to Open VSX..."
        if publish_output=$(npx --yes ovsx@1.1.0 publish "$VSIX_FILE" -p "$OVSX_PAT" 2>&1); then
            printf '%s\n' "$publish_output"
        elif publication_was_already_accepted "$publish_output"; then
            log_info "Open VSX already accepted ${VERSION}."
        else
            printf '%s\n' "$publish_output" >&2
            die "Could not publish retained VSIX to Open VSX."
        fi
        manifest_set openVsxAccepted true
    fi

    if manifest_flag_is_true npmAccepted; then
        log_info "npm accepted ${NPM_PACKAGE}@${VERSION}; skipping."
    elif npm_has_version; then
        manifest_set npmAccepted true
        log_info "npm already has ${NPM_PACKAGE}@${VERSION}; skipping."
    else
        ensure_npm_tarball
        log_step "Publishing retained CLI tarball to npm..."
        if npm publish "$NPM_TARBALL"; then
            manifest_set npmAccepted true
        elif npm_has_version; then
            manifest_set npmAccepted true
            log_info "npm already accepted ${NPM_PACKAGE}@${VERSION}."
        else
            die "Could not publish retained CLI tarball to npm."
        fi
    fi
}

function publish_github_release() {
    local state
    state=$(github_release_state)
    case "$state" in
        public)
            log_info "GitHub Release ${RELEASE_TAG} is already public; skipping."
            ;;
        draft)
            log_step "Publishing GitHub Release ${RELEASE_TAG}..."
            gh release edit "$RELEASE_TAG" --repo "$REPOSITORY" --draft=false
            ;;
        *)
            die "Cannot publish GitHub Release ${RELEASE_TAG}; current state is ${state}."
            ;;
    esac
}

function reconstruct_resume_state() {
    RELEASE_COMMIT=$(find_release_commit) \
        || die "Cannot find the release commit for ${RELEASE_TAG}. Start that version with patch/minor/major or restore its release state."
    version_snapshot_matches "$RELEASE_COMMIT" \
        || die "Found commit ${RELEASE_COMMIT}, but its ${VERSION} version snapshot is inconsistent."
    BASE_COMMIT=$(git rev-parse "${RELEASE_COMMIT}^")
    PREVIOUS_TAG=$(discover_previous_tag "$RELEASE_COMMIT" "$RELEASE_TAG" stable)
    PREVIOUS_CLI_TAG=$(discover_previous_tag "$RELEASE_COMMIT" "$CLI_TAG" cli)

    log_info "Reconstructing local recovery state for ${RELEASE_TAG}."
    create_manifest
}

function initialize_new_release() {
    local incomplete_tag
    incomplete_tag=$(incomplete_release_tag)
    if [ -n "$incomplete_tag" ]; then
        die "Incomplete release state exists for ${incomplete_tag}. Use: scripts/publish.sh --resume ${incomplete_tag}"
    fi
    assert_clean_worktree
    [ "$(git branch --show-current)" = "$DEFAULT_BRANCH" ] \
        || die "New releases must start from the ${DEFAULT_BRANCH} branch."

    local old_version old_cli_version
    old_version=$(node -p "require('./package.json').version")
    old_cli_version=$(node -p "require('./cli/package.json').version")
    [ "$old_version" = "$old_cli_version" ] \
        || die "Extension (${old_version}) and CLI (${old_cli_version}) versions are out of sync."

    configure_release_paths "$(compute_new_version "$old_version" "$BUMP_TYPE")"
    [ ! -e "$STATE_DIR" ] \
        || die "Release state already exists for ${RELEASE_TAG}. Use: scripts/publish.sh --resume ${RELEASE_TAG}"
    if local_tag_commit "$RELEASE_TAG" >/dev/null 2>&1 || remote_tag_commit "$RELEASE_TAG" >/dev/null 2>&1; then
        die "${RELEASE_TAG} already exists. Use: scripts/publish.sh --resume ${RELEASE_TAG}"
    fi
    if local_tag_commit "$CLI_TAG" >/dev/null 2>&1 || remote_tag_commit "$CLI_TAG" >/dev/null 2>&1; then
        die "${CLI_TAG} already exists. Use: scripts/publish.sh --resume ${RELEASE_TAG}"
    fi

    BASE_COMMIT=$(git rev-parse HEAD)
    PREVIOUS_TAG=$(discover_previous_tag "$BASE_COMMIT" "$RELEASE_TAG" stable)
    PREVIOUS_CLI_TAG=$(discover_previous_tag "$BASE_COMMIT" "$CLI_TAG" cli)
    ensure_curated_release_notes_ready

    require_gh_authentication
    [ -n "${VSCE_PAT:-}" ] || die "VSCE_PAT is required to start a release."
    [ -n "${OVSX_PAT:-}" ] || die "OVSX_PAT is required to start a release."
    create_manifest
    log_info "Starting ${RELEASE_TAG} from ${BASE_COMMIT}."
}

function initialize_resume() {
    configure_release_paths "${RESUME_TAG#v}"
    require_gh_authentication
    if [ -f "$MANIFEST_FILE" ]; then
        load_manifest
    else
        reconstruct_resume_state
    fi

    BUMP_TYPE=$(infer_release_kind "$PREVIOUS_TAG" "$VERSION") \
        || die "Cannot infer release kind for ${PREVIOUS_TAG} -> ${RELEASE_TAG}."
    if [ -n "$RELEASE_COMMIT" ]; then
        validate_committed_bundled_release_notes
        assert_only_release_or_publisher_files_changed
        if release_is_complete; then
            print_success
            exit 0
        fi
        return
    fi
    ensure_curated_release_notes_ready
}

function prepare_uncommitted_release() {
    if [ -n "$RELEASE_COMMIT" ]; then
        return
    fi
    [ "$(git rev-parse HEAD)" = "$BASE_COMMIT" ] \
        || ensure_release_commit
    write_versions
    ensure_bundled_release_notes
    ensure_release_notes
    ensure_vsix
    ensure_npm_tarball
    ensure_release_commit
}

function reconcile_release() {
    prepare_uncommitted_release
    ensure_release_notes
    ensure_local_tags
    ensure_remote_refs
    ensure_draft_release
    publish_missing_registries
    publish_github_release

    sync_remote_metadata
    release_is_complete || die "Final verification failed. Resume with: scripts/publish.sh --resume ${RELEASE_TAG}"
    manifest_set completed true
    rm -f "$VSIX_FILE" "$NPM_TARBALL"
    print_success
}

function print_success() {
    echo ""
    echo "--------------------------------------------------"
    log_info "Dirac ${RELEASE_TAG} is complete."
    echo "  • Source and tags: https://github.com/${REPOSITORY}/tree/${RELEASE_TAG}"
    echo "  • GitHub Release:  https://github.com/${REPOSITORY}/releases/tag/${RELEASE_TAG}"
    echo "  • VS Marketplace:  ${VERSION}"
    echo "  • Open VSX:        ${VERSION}"
    echo "  • npm:             ${NPM_PACKAGE}@${VERSION}"
    echo "--------------------------------------------------"
}

function restore_dry_run() {
    git restore --worktree -- "${MUTATED_FILES[@]}"
    # Dry runs never change the index, so it remains the source of tracking state.
    if git ls-files --error-unmatch "$BUNDLED_RELEASE_NOTES_FILE" >/dev/null 2>&1; then
        git restore --worktree -- "$BUNDLED_RELEASE_NOTES_FILE"
    else
        rm -f "$BUNDLED_RELEASE_NOTES_FILE"
    fi
    rm -rf "$STATE_DIR"
}

function run_dry_run() {
    assert_clean_worktree
    local old_version
    old_version=$(node -p "require('./package.json').version")
    configure_release_paths "$(compute_new_version "$old_version" "$BUMP_TYPE")"
    STATE_DIR="${STATE_ROOT}/dry-run-${RELEASE_TAG}-$$"
    MANIFEST_FILE="${STATE_DIR}/manifest.json"
    RELEASE_NOTES_FILE="${STATE_DIR}/release-notes.md"
    CLI_RELEASE_NOTES_FILE="${STATE_DIR}/cli-release-notes.md"
    VSIX_FILE="${STATE_DIR}/dirac-${VERSION}.vsix"
    NPM_TARBALL="${STATE_DIR}/dirac-cli-${VERSION}.tgz"
    BASE_COMMIT=$(git rev-parse HEAD)
    PREVIOUS_TAG=$(discover_previous_tag "$BASE_COMMIT" "$RELEASE_TAG" stable)
    PREVIOUS_CLI_TAG=$(discover_previous_tag "$BASE_COMMIT" "$CLI_TAG" cli)
    ensure_curated_release_notes_ready
    create_manifest

    trap restore_dry_run EXIT

    write_versions
    ensure_bundled_release_notes
    ensure_release_notes
    ensure_vsix
    ensure_npm_tarball
    trap - EXIT
    restore_dry_run
    log_info "Dry run complete for ${RELEASE_TAG}. Nothing was committed, tagged, pushed, or published."
}

function main() {
    parse_args "$@"
    assert_repository_root
    require_commands

    if [ "$DRY_RUN" = true ]; then
        run_dry_run
        return
    fi

    sync_remote_metadata
    if [ "$MODE" = "new" ]; then
        initialize_new_release
    else
        initialize_resume
    fi
    reconcile_release
}

main "$@"
