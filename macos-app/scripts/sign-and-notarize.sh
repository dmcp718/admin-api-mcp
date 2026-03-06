#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$ROOT_DIR/build/LucidLink MCP.app"
ENTITLEMENTS="$ROOT_DIR/LucidLinkMCP/LucidLinkMCP.entitlements"

IDENTITY="${DEVELOPER_ID_APP:-}"
KEYCHAIN_PROFILE="${NOTARY_KEYCHAIN_PROFILE:-}"

if [ -z "$IDENTITY" ]; then
    echo "DEVELOPER_ID_APP not set — skipping signing (dev build)."
    exit 0
fi

if [ ! -d "$APP_DIR" ]; then
    echo "Error: App bundle not found at $APP_DIR"
    echo "Run 'make build' first."
    exit 1
fi

echo "=== Code Signing ==="
echo "Identity: $IDENTITY"
echo ""

# Sign inside-out

# 1. Node.js binary
echo "Signing Resources/node..."
codesign --force --options runtime \
    --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" \
    "$APP_DIR/Contents/Resources/node"

# 2. Any native node addons (defensive)
find "$APP_DIR/Contents/Resources/node_modules" -name '*.node' -print0 2>/dev/null | \
    xargs -0 -I{} codesign --force --options runtime \
        --entitlements "$ENTITLEMENTS" \
        --sign "$IDENTITY" "{}" || true

# 3. Swift binary
echo "Signing MacOS/LucidLinkMCP..."
codesign --force --options runtime \
    --sign "$IDENTITY" \
    "$APP_DIR/Contents/MacOS/LucidLinkMCP"

# 4. Entire app bundle
echo "Signing app bundle..."
codesign --force --deep --options runtime \
    --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" \
    "$APP_DIR"

# 5. Verify
echo ""
echo "Verifying signature..."
codesign --verify --deep --strict "$APP_DIR"
echo "Signature valid."

# Notarize if keychain profile is set
if [ -z "$KEYCHAIN_PROFILE" ]; then
    echo ""
    echo "NOTARY_KEYCHAIN_PROFILE not set — skipping notarization."
    exit 0
fi

echo ""
echo "=== Notarization ==="
ZIP_PATH="$ROOT_DIR/build/LucidLinkMCP.zip"
ditto -c -k --keepParent "$APP_DIR" "$ZIP_PATH"

echo "Submitting to Apple notary service..."
xcrun notarytool submit "$ZIP_PATH" \
    --keychain-profile "$KEYCHAIN_PROFILE" \
    --wait

echo "Stapling notarization ticket..."
xcrun stapler staple "$APP_DIR"

# Clean up zip
rm -f "$ZIP_PATH"

echo ""
echo "=== Signing & Notarization Complete ==="
spctl --assess --type exec "$APP_DIR" && echo "Gatekeeper: ACCEPTED" || echo "Gatekeeper: check failed"
