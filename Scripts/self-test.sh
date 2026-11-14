#!/bin/zsh
set -euo pipefail

APP="${1:-$HOME/Applications/ShieldBar.app}"
BIN="$APP/Contents/MacOS/ShieldBar"

if [[ ! -x "$BIN" ]]; then
    echo "error: ShieldBar.app not found at $APP" >&2
    echo "Run Scripts/build-app.sh first, or pass the .app path as the first argument." >&2
    exit 1
fi

exec "$BIN" --self-test
