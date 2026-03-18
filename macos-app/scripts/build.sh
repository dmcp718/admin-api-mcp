#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FILES_DIR="$(cd "$ROOT_DIR/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
APP_DIR="$BUILD_DIR/LucidLinkMCP.app"
CONTENTS="$APP_DIR/Contents"
RESOURCES="$CONTENTS/Resources"

echo "=== LucidLink MCP macOS App Build ==="
echo "Files dir: $FILES_DIR"
echo "Build dir: $BUILD_DIR"
echo ""

# Clean previous build (preserve node cache)
rm -rf "$APP_DIR"
mkdir -p "$BUILD_DIR"

# -----------------------------------------------
# Step 0: Build fs-index-server Go binary
# -----------------------------------------------
echo "[0/6] Building fs-index-server (Go binary)..."
FS_INDEX_DIR="$FILES_DIR/fs-index-server"
if [ -d "$FS_INDEX_DIR" ]; then
    cd "$FS_INDEX_DIR"
    GOOS=darwin GOARCH=arm64 go build -o "$BUILD_DIR/fs-index-server" .
    echo "  fs-index-server built for darwin/arm64."
else
    echo "  WARNING: fs-index-server/ not found, skipping Go build."
fi

# -----------------------------------------------
# Step 1: Build TypeScript MCP servers
# -----------------------------------------------
echo "[1/6] Building TypeScript MCP servers..."
cd "$FILES_DIR"
npm ci
npm run build
echo "  TypeScript build complete."

# -----------------------------------------------
# Step 2: Download Node.js binary
# -----------------------------------------------
echo "[2/6] Downloading Node.js binary..."
"$SCRIPT_DIR/download-node.sh"

# -----------------------------------------------
# Step 3: Extract LucidLink API from Docker
# -----------------------------------------------
echo "[3/6] Extracting LucidLink API..."
"$SCRIPT_DIR/extract-api.sh"

# -----------------------------------------------
# Step 4: Install production-only dependencies
# -----------------------------------------------
echo "[4/6] Installing production dependencies..."
cd "$FILES_DIR"
# Use a temp dir so we don't clobber the dev node_modules
PROD_MODULES="$BUILD_DIR/node_modules_prod"
rm -rf "$PROD_MODULES"
mkdir -p "$PROD_MODULES"
cp package.json "$PROD_MODULES/"
cd "$PROD_MODULES"
npm install --omit=dev --ignore-scripts
cd "$ROOT_DIR"

# -----------------------------------------------
# Step 5: Compile Swift menu bar app
# -----------------------------------------------
echo "[5/6] Compiling Swift menu bar app..."
swiftc \
    -O \
-target arm64-apple-macos13.0 \
    -o "$BUILD_DIR/LucidLinkMCP" \
    "$ROOT_DIR/LucidLinkMCP/AppDelegate.swift" \
    -framework Cocoa \
    -framework UserNotifications \
    -framework WebKit

echo "  Swift binary compiled."

# -----------------------------------------------
# Step 6: Assemble .app bundle
# -----------------------------------------------
echo "[6/6] Assembling .app bundle..."

mkdir -p "$CONTENTS/MacOS"
mkdir -p "$RESOURCES/mcp"
mkdir -p "$RESOURCES/api"

# Swift binary
cp "$BUILD_DIR/LucidLinkMCP" "$CONTENTS/MacOS/LucidLinkMCP"

# Info.plist
cp "$ROOT_DIR/LucidLinkMCP/Info.plist" "$CONTENTS/Info.plist"

# App icon (if available)
if [ -f "$ROOT_DIR/resources/AppIcon.icns" ]; then
    cp "$ROOT_DIR/resources/AppIcon.icns" "$RESOURCES/AppIcon.icns"
fi

# Node.js binary
cp "$BUILD_DIR/node" "$RESOURCES/node"
chmod +x "$RESOURCES/node"

# MCP server manifest and JS (compiled dist/)
cp "$FILES_DIR/mcp-servers.json" "$RESOURCES/mcp-servers.json"
cp -R "$FILES_DIR/dist/"* "$RESOURCES/mcp/"

# Doc chunks (markdown files read at runtime by docs-search.js)
if [ -d "$FILES_DIR/src/docs/chunks" ]; then
    mkdir -p "$RESOURCES/mcp/docs/chunks"
    cp "$FILES_DIR/src/docs/chunks/"*.md "$RESOURCES/mcp/docs/chunks/"
fi

# Production node_modules
cp -R "$PROD_MODULES/node_modules" "$RESOURCES/node_modules"

# LucidLink API
cp -R "$BUILD_DIR/api/"* "$RESOURCES/api/"

# fs-index-server binary and templates
if [ -f "$BUILD_DIR/fs-index-server" ]; then
    cp "$BUILD_DIR/fs-index-server" "$RESOURCES/fs-index-server"
    chmod +x "$RESOURCES/fs-index-server"
    # Copy templates (Go binary expects templates/ next to executable)
    if [ -d "$FILES_DIR/fs-index-server/templates" ]; then
        cp -R "$FILES_DIR/fs-index-server/templates" "$RESOURCES/templates"
    fi
    echo "  fs-index-server bundled."
fi

# Cleanup temp prod modules
rm -rf "$PROD_MODULES"

# -----------------------------------------------
# Step 7: Ad-hoc code sign (seals resources)
# -----------------------------------------------
# Without this, macOS sees a linker-signed binary with no resource seal,
# causing "code has no resources but signature indicates they must be present".
# Proper Developer ID signing (make sign) replaces this ad-hoc signature.
echo "[7/7] Ad-hoc signing app bundle..."

# Sign embedded binaries first (inside-out)
codesign --force --deep --sign - "$RESOURCES/node" 2>/dev/null || true
codesign --force --deep --sign - "$RESOURCES/fs-index-server" 2>/dev/null || true
find "$RESOURCES/node_modules" -name '*.node' -print0 2>/dev/null | \
    xargs -0 -I{} codesign --force --sign - "{}" 2>/dev/null || true

# Sign the main binary
codesign --force --sign - "$CONTENTS/MacOS/LucidLinkMCP"

# Sign the entire app bundle (seals all resources)
codesign --force --deep --sign - "$APP_DIR"

echo "  Ad-hoc signature applied (resources sealed)."

echo ""
echo "=== Build Complete ==="
echo "App bundle: $APP_DIR"
du -sh "$APP_DIR"
echo ""
echo "Next steps:"
echo "  make sign    — code sign and notarize (for distribution)"
echo "  make dmg     — create DMG installer"
