#!/bin/bash
# Collect every historical version of apps/api/src/snapshots/audit-logs.json
# into audit-versions/<shortsha>.json
set -e
cd "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX"
mkdir -p audit-versions
for c in $(git log --format="%H" --follow -- apps/api/src/snapshots/audit-logs.json); do
  short=$(echo "$c" | cut -c1-7)
  git show "$c:apps/api/src/snapshots/audit-logs.json" > "audit-versions/$short.json" 2>/dev/null || true
done
ls audit-versions | wc -l
