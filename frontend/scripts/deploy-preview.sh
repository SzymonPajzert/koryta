#!/bin/bash

# Rolls a branch out to the preview backend from a laptop, the same way
# .github/workflows/preview.yml does it from CI. Use whichever is closer to
# hand: the workflow needs a push and a label, this needs `firebase login`.
#
#   npm run preview:deploy               # the branch you are on
#   npm run preview:deploy -- some-branch
#
# App Hosting builds from the branch as GitHub has it, so anything not pushed
# yet will not be in the deployment. The script says so rather than quietly
# deploying something older than the working copy.

set -euo pipefail

PROJECT="${PREVIEW_PROJECT:-koryta-pl-preview}"
BACKEND="${PREVIEW_BACKEND:-preview}"

branch="${1:-}"
if [ -z "$branch" ]; then
    # jj first: the working copy here is usually a jj workspace, where
    # `git branch --show-current` reports whatever git last checked out.
    branch=$(jj log -r @ --no-graph -T 'bookmarks' 2>/dev/null | tr -d ' *' | head -n 1 || true)
    branch="${branch:-$(git branch --show-current)}"
fi

if [ -z "$branch" ]; then
    echo "Error: no branch given and none could be worked out from the repo" >&2
    exit 1
fi

remote_head=$(git ls-remote --heads origin "$branch" | cut -f1)
if [ -z "$remote_head" ]; then
    echo "Error: origin has no branch named $branch - push it first." >&2
    echo "App Hosting builds from GitHub, not from this directory." >&2
    exit 1
fi

local_head=$(git rev-parse "$branch" 2>/dev/null || echo "")
if [ -n "$local_head" ] && [ "$local_head" != "$remote_head" ]; then
    echo "Warning: origin/$branch is at ${remote_head:0:12}, local $branch is at ${local_head:0:12}." >&2
    echo "The deployment will be built from origin's commit." >&2
fi

echo "Rolling $branch out to $PROJECT/$BACKEND..."
npx firebase apphosting:rollouts:create "$BACKEND" \
    --git-branch "$branch" --project "$PROJECT" --force

echo
echo "The build takes a few minutes. The URL is on the backend:"
echo "  npx firebase apphosting:backends:get $BACKEND --project $PROJECT"
