#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-release}"
APP_NAME="ShieldBar"
DEST="${DEST:-$HOME/Applications/$APP_NAME.app}"
ZIP="${DEST}.zip"

# The Command Line Tools' default macOS 27 SDK declares SwiftUI property
# wrappers as macros, but ships no SwiftUIMacros compiler plugin. The 26.5 SDK
# still declares them as ordinary property wrappers, so build against it.
SDK="${SHIELDBAR_SDK:-/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk}"
if [[ ! -d "$SDK" ]]; then
    echo "error: SDK not found: $SDK" >&2
    echo "Set SHIELDBAR_SDK to a macOS SDK that supports SwiftUI property wrappers." >&2
    exit 1
fi

echo "==> Building ShieldBar ($CONFIG, arm64, SDK $(basename "$SDK"))"
swift build \
    --package-path "$ROOT" \
    --build-system native \
    --sdk "$SDK" \
    -c "$CONFIG" \
    --product ShieldBar

BIN_DIR="$(swift build \
    --package-path "$ROOT" \
    --build-system native \
    --sdk "$SDK" \
    -c "$CONFIG" \
    --show-bin-path)"

if [[ ! -x "$BIN_DIR/$APP_NAME" ]]; then
    echo "error: executable not found at $BIN_DIR/$APP_NAME" >&2
    exit 1
fi

if [[ ! -f "$ROOT/Resources/AppIcon.icns" || "${FORCE_ICON:-0}" == "1" ]]; then
    echo "==> Generating app icon"
    ICONSET="$ROOT/.build/AppIcon.iconset"
    MASTER="$ROOT/.build/AppIcon-1024.png"
    rm -rf "$ICONSET"
    mkdir -p "$ICONSET"
    swift "$ROOT/Scripts/make-icon.swift" "$MASTER" >/dev/null

    resize_icon() {
        local pixels="$1"
        local name="$2"
        sips -z "$pixels" "$pixels" "$MASTER" --out "$ICONSET/$name" >/dev/null
    }

    resize_icon 16  "icon_16x16.png"
    resize_icon 32  "icon_16x16@2x.png"
    resize_icon 32  "icon_32x32.png"
    resize_icon 64  "icon_32x32@2x.png"
    resize_icon 128 "icon_128x128.png"
    resize_icon 256 "icon_128x128@2x.png"
    resize_icon 256 "icon_256x256.png"
    resize_icon 512 "icon_256x256@2x.png"
    resize_icon 512 "icon_512x512.png"
    resize_icon 1024 "icon_512x512@2x.png"

    iconutil -c icns "$ICONSET" -o "$ROOT/Resources/AppIcon.icns"
fi

echo "==> Assembling $DEST"
rm -rf "$DEST"
mkdir -p "$DEST/Contents/MacOS" "$DEST/Contents/Resources"
install -m 755 "$BIN_DIR/$APP_NAME" "$DEST/Contents/MacOS/$APP_NAME"
cp "$ROOT/Resources/Info.plist" "$DEST/Contents/Info.plist"
cp "$ROOT/Resources/AppIcon.icns" "$DEST/Contents/Resources/AppIcon.icns"
cp "$ROOT/Resources/Attribution.txt" "$DEST/Contents/Resources/Attribution.txt"
printf 'APPL????' > "$DEST/Contents/PkgInfo"

plutil -lint "$DEST/Contents/Info.plist"

echo "==> Signing (ad hoc)"
codesign --force --sign - --identifier "com.local.shieldbar" "$DEST"
codesign --verify --deep --strict "$DEST"

echo "==> Checking architecture"
file "$DEST/Contents/MacOS/$APP_NAME" | sed 's/^/    /'

echo "==> Creating zip backup"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$DEST" "$ZIP"

echo ""
echo "Installed: $DEST"
echo "Backup:    $ZIP"
echo "Launch:    open \"$DEST\""
echo "Self-test: \"$DEST/Contents/MacOS/ShieldBar\" --self-test"
