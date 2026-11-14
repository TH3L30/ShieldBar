#!/bin/sh
set -eu

# Builds the privileged helper for every shipped target.
# Run from anywhere; output goes to desktop/resources/helper.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT="$ROOT/desktop/resources/helper"

mkdir -p "$OUT/darwin-arm64" "$OUT/win32-x64" "$OUT/linux-x64"

cd "$ROOT/helper"

CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build \
  -trimpath -ldflags "-s -w" \
  -o "$OUT/darwin-arm64/shieldbar-helper" .

CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build \
  -trimpath -ldflags "-s -w" \
  -o "$OUT/win32-x64/shieldbar-helper.exe" .

CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
  -trimpath -ldflags "-s -w" \
  -o "$OUT/linux-x64/shieldbar-helper" .

chmod 755 \
  "$OUT/darwin-arm64/shieldbar-helper" \
  "$OUT/linux-x64/shieldbar-helper"

echo "Built ShieldBar helpers:"
ls -lh \
  "$OUT/darwin-arm64/shieldbar-helper" \
  "$OUT/win32-x64/shieldbar-helper.exe" \
  "$OUT/linux-x64/shieldbar-helper"
