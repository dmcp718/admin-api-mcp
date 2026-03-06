#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$ROOT_DIR/build/LucidLink MCP.app"
DMG_PATH="$ROOT_DIR/build/LucidLink-MCP.dmg"
STAGING="$ROOT_DIR/build/dmg-staging"

IDENTITY="${DEVELOPER_ID_APP:-}"
KEYCHAIN_PROFILE="${NOTARY_KEYCHAIN_PROFILE:-}"

if [ ! -d "$APP_DIR" ]; then
    echo "Error: App bundle not found. Run 'make build' first."
    exit 1
fi

echo "=== Creating DMG ==="

# Prepare staging area
rm -rf "$STAGING" "$DMG_PATH"
mkdir -p "$STAGING"
cp -R "$APP_DIR" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

# Create compressed DMG
hdiutil create \
    -volname "LucidLink MCP" \
    -srcfolder "$STAGING" \
    -ov \
    -format UDZO \
    "$DMG_PATH"

rm -rf "$STAGING"

# Sign and notarize DMG if identity available
if [ -n "$IDENTITY" ]; then
    echo "Signing DMG..."
    codesign --sign "$IDENTITY" "$DMG_PATH"

    if [ -n "$KEYCHAIN_PROFILE" ]; then
        echo "Notarizing DMG..."
        xcrun notarytool submit "$DMG_PATH" \
            --keychain-profile "$KEYCHAIN_PROFILE" \
            --wait
        xcrun stapler staple "$DMG_PATH"
    fi
fi

echo ""
echo "=== DMG Created ==="
echo "$DMG_PATH"
ls -lh "$DMG_PATH"
