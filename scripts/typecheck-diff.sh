#!/bin/bash
# TOKEN-SAVE-07: per-file typecheck — run full tsc but print ONLY errors for
# files changed vs HEAD, so agent context stays small during dev loops.
#
# Usage: scripts/typecheck-diff.sh [web|api|both]   (default: both)
set -e
cd "$(dirname "$0")/.."

SCOPE="${1:-both}"

run_tsc() {
  local dir="$1"
  local out="$2"
  (cd "$dir" && npx tsc --noEmit 2>&1 || true) > "$out"
}

changed_files() {
  {
    git diff --name-only HEAD -- '*.ts' '*.tsx' 2>/dev/null || true
    # include untracked (new) files too, or errors in new files would be skipped
    git ls-files --others --exclude-standard -- '*.ts' '*.tsx' 2>/dev/null || true
  } | sort -u
}

filter_changed() {
  local logfile="$1"
  local changes="$2"
  if [ -s "$changes" ]; then
    # Build a grep pattern from changed paths (match on basename + src path fragments)
    local pat=""
    while IFS= read -r f; do
      local base
      base=$(basename "$f")
      pat="${pat:+$pat|}$base"
    done < "$changes"
    if [ -n "$pat" ]; then
      grep -E "($pat)" "$logfile" || echo "No errors in changed files."
    else
      echo "No TS/TSX files changed vs HEAD."
    fi
  else
    echo "No TS/TSX files changed vs HEAD."
  fi
}

CHANGES=$(mktemp)
changed_files > "$CHANGES"

if [ "$SCOPE" = "web" ] || [ "$SCOPE" = "both" ]; then
  OUT=$(mktemp)
  echo "=== web (apps/web) — errors in changed files ==="
  run_tsc "apps/web" "$OUT"
  filter_changed "$OUT" "$CHANGES"
  rm -f "$OUT"
fi

if [ "$SCOPE" = "api" ] || [ "$SCOPE" = "both" ]; then
  OUT=$(mktemp)
  echo "=== api (apps/api) — errors in changed files ==="
  run_tsc "apps/api" "$OUT"
  filter_changed "$OUT" "$CHANGES"
  rm -f "$OUT"
fi

rm -f "$CHANGES"
