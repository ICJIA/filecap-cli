#!/usr/bin/env bash
# publish — release @icjia/filecap to npm
#
# Usage:
#   ./publish              # patch bump (default)
#   ./publish patch        # patch bump
#   ./publish minor        # minor bump
#   ./publish major        # major bump
#   ./publish first        # first-time publish (uses version in package.json as-is)

set -euo pipefail

BUMP="${1:-patch}"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
    echo "Refusing to publish: not on main (currently on $BRANCH)" >&2
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "Refusing to publish: working tree not clean" >&2
    git status --short >&2
    exit 1
fi

# Tolerate first-time publish where origin/main doesn't exist yet.
# In that case treat local as "in sync" with itself; the actual push
# happens later via `git push origin v$VERSION` or `git push origin main --follow-tags`.
git fetch origin main 2>/dev/null || true
LOCAL=$(git rev-parse main)
REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "$LOCAL")
if [ "$LOCAL" != "$REMOTE" ]; then
    echo "Refusing to publish: local main is not in sync with origin/main" >&2
    exit 1
fi

if ! npm whoami >/dev/null 2>&1; then
    echo "Not logged in to npm. Run: npm login" >&2
    exit 1
fi

echo "==> Running tests"
npm test

# Use npm pack + npm publish <tarball> for explicit control over what's
# uploaded. The plain `npm publish` flow has historically left the registry's
# per-version readme field empty even though README.md is in the tarball
# (npmjs.com then renders "no README"). The explicit-tarball flow populates
# the per-version readme correctly.
publish_via_pack() {
    echo "==> Building tarball via npm pack ..."
    TARBALL=$(npm pack 2>&1 | tail -1)
    if [ ! -f "$TARBALL" ]; then
        echo "Refusing to publish: npm pack did not produce a tarball" >&2
        exit 1
    fi
    echo "==> Publishing $TARBALL ..."
    npm publish "./$TARBALL" --access public
    rm -f "./$TARBALL"
}

if [ "$BUMP" = "first" ]; then
    VERSION=$(node -p "require('./package.json').version")
    echo "==> First-time publish at v$VERSION"
    # Tag and push BEFORE npm publish so the invariant "if it's on npm, it's
    # tagged in git" holds. If publish fails, the tag is recoverable
    # (delete and retry); the alternative ordering can leave npm with a
    # released version that has no corresponding git tag.
    if git rev-parse --verify --quiet "refs/tags/v$VERSION" >/dev/null; then
        # Tag already exists locally (e.g., from the implementation plan's Step 15.7).
        # Verify it points at HEAD; if so, just push it. If not, that's an error.
        if [ "$(git rev-list -n 1 "v$VERSION")" != "$(git rev-parse HEAD)" ]; then
            echo "Refusing to publish: tag v$VERSION exists but does not point at HEAD" >&2
            exit 1
        fi
    else
        git tag "v$VERSION"
    fi
    git push origin main
    git push origin "v$VERSION"
    publish_via_pack
else
    echo "==> Bumping version ($BUMP)"
    NEW_TAG=$(npm version "$BUMP" -m "Release v%s")
    echo "==> Publishing $NEW_TAG"
    git push origin main --follow-tags
    publish_via_pack
fi

echo
echo "==> Done."
echo "    npm:    https://www.npmjs.com/package/@icjia/filecap"
echo "    GitHub: https://github.com/ICJIA/icjia-fleet-audit"
