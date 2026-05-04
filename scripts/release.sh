#!/usr/bin/env bash
#
# Release a new version of power-term:
#   1. Bump version in package.json, Cargo.toml, tauri.conf.json
#   2. Build DMGs for aarch64 + x86_64
#   3. Commit, tag, push source branch
#   4. Upload DMGs as a GitHub release on the tap repo
#   5. Update the cask formula (version + sha256s) and push the tap
#
# Usage:
#   scripts/release.sh <version>          # e.g. scripts/release.sh 0.2.0
#   BRANCH=main scripts/release.sh 0.2.0  # override source branch (default: develop)

set -euo pipefail

VERSION="${1:-}"
TAP_REPO="bango97/homebrew-power-term"
SOURCE_BRANCH="${BRANCH:-develop}"

red()   { printf "\033[31m%s\033[0m\n" "$*" >&2; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
step()  { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }

if [[ -z "$VERSION" ]]; then
  red "Usage: $0 <version>  (e.g. $0 0.2.0)"
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  red "Version must be semver X.Y.Z (got: $VERSION)"
  exit 1
fi

TAG="v$VERSION"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$(mktemp -d -t power-term-release-XXXXXX)"
TAP_DIR="$(mktemp -d -t homebrew-power-term-XXXXXX)"

cd "$ROOT"

step "Pre-flight checks"
gh auth status >/dev/null 2>&1 || { red "gh not authenticated — run: gh auth login"; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { red "Working tree dirty — commit or stash first"; exit 1; }

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "$SOURCE_BRANCH" ]]; then
  red "Expected branch '$SOURCE_BRANCH', currently on '$CURRENT_BRANCH' (use BRANCH=$CURRENT_BRANCH to override)"
  exit 1
fi

rustup target list --installed | grep -q '^aarch64-apple-darwin$' || { red "rustup target add aarch64-apple-darwin"; exit 1; }
rustup target list --installed | grep -q '^x86_64-apple-darwin$'  || { red "rustup target add x86_64-apple-darwin"; exit 1; }

if git rev-parse "$TAG" >/dev/null 2>&1; then
  red "Tag $TAG already exists locally"
  exit 1
fi

green "  ✓ gh authed, tree clean, on $SOURCE_BRANCH, both rust targets installed, $TAG free"

step "Bumping version → $VERSION"
sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"$VERSION\"/" package.json && rm package.json.bak
sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json && rm src-tauri/tauri.conf.json.bak
sed -i.bak -E "s/^version = \"[^\"]+\"/version = \"$VERSION\"/" src-tauri/Cargo.toml && rm src-tauri/Cargo.toml.bak

step "Building DMG for aarch64-apple-darwin"
npm run tauri:build -- --target aarch64-apple-darwin

step "Building DMG for x86_64-apple-darwin"
npm run tauri:build -- --target x86_64-apple-darwin

step "Staging release artifacts"
cp "src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Power Term_${VERSION}_aarch64.dmg" \
   "$RELEASE_DIR/PowerTerm-${VERSION}-aarch64.dmg"
cp "src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/Power Term_${VERSION}_x64.dmg" \
   "$RELEASE_DIR/PowerTerm-${VERSION}-x86_64.dmg"

SHA_ARM=$(shasum -a 256 "$RELEASE_DIR/PowerTerm-${VERSION}-aarch64.dmg" | awk '{print $1}')
SHA_X64=$(shasum -a 256 "$RELEASE_DIR/PowerTerm-${VERSION}-x86_64.dmg"  | awk '{print $1}')
green "  arm64:  $SHA_ARM"
green "  x86_64: $SHA_X64"

step "Committing version bump and tagging $TAG"
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: release $TAG"
git tag -a "$TAG" -m "Release $TAG"

step "Pushing $SOURCE_BRANCH and $TAG to origin"
git push origin "$SOURCE_BRANCH"
git push origin "$TAG"

step "Creating GitHub release on $TAP_REPO"
gh release create "$TAG" \
  --repo "$TAP_REPO" \
  --title "$TAG" \
  --notes "Binary release for power-term $TAG cask." \
  "$RELEASE_DIR/PowerTerm-${VERSION}-aarch64.dmg" \
  "$RELEASE_DIR/PowerTerm-${VERSION}-x86_64.dmg"

step "Updating cask formula in $TAP_REPO"
git clone "https://github.com/$TAP_REPO.git" "$TAP_DIR"
cd "$TAP_DIR"

CASK="Casks/power-term.rb"
sed -i.bak -E "s/version \"[^\"]+\"/version \"$VERSION\"/" "$CASK"
sed -i.bak -E "s/(arm: *)\"[a-f0-9]{64}\"/\1\"$SHA_ARM\"/" "$CASK"
sed -i.bak -E "s/(intel: *)\"[a-f0-9]{64}\"/\1\"$SHA_X64\"/" "$CASK"
rm "$CASK.bak"

if git diff --quiet "$CASK"; then
  red "Cask formula unchanged after sed — check substitution patterns"
  exit 1
fi

git add "$CASK"
git commit -m "feat: bump power-term to $VERSION"
git push

step "Done"
green "  Source: https://github.com/Financial-Support/power-term/tree/$TAG"
green "  Release: https://github.com/$TAP_REPO/releases/tag/$TAG"
green "  Test:    brew update && brew upgrade --cask power-term"
echo
echo "  Artifacts: $RELEASE_DIR"
