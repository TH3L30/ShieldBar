#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${SHIELDBAR_SDK:-/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk}"
FRAMEWORKS="/Library/Developer/CommandLineTools/Library/Developer/Frameworks"

if [[ ! -d "$SDK" ]]; then
    echo "error: SDK not found: $SDK" >&2
    exit 1
fi

# Command Line Tools ship Swift Testing as a standalone framework but do not
# add it to the default search paths.
swift test \
    --package-path "$ROOT" \
    --build-system native \
    --sdk "$SDK" \
    -Xswiftc -F -Xswiftc "$FRAMEWORKS" \
    -Xlinker -F -Xlinker "$FRAMEWORKS" \
    -Xlinker -rpath -Xlinker "$FRAMEWORKS"
