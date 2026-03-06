#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FILES_DIR="$(cd "$ROOT_DIR/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
APP_DIR="$BUILD_DIR/LucidLink MCP.app"
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

# MCP server JS (compiled dist/)
cp -R "$FILES_DIR/dist/"* "$RESOURCES/mcp/"

# Production node_modules
cp -R "$PROD_MODULES/node_modules" "$RESOURCES/node_modules"

# LucidLink API
cp -R "$BUILD_DIR/api/"* "$RESOURCES/api/"

# Cleanup temp prod modules
rm -rf "$PROD_MODULES"

echo ""
echo "=== Build Complete ==="
echo "App bundle: $APP_DIR"
du -sh "$APP_DIR"
echo ""
echo "Next steps:"
echo "  make sign    — code sign and notarize"
echo "  make dmg     — create DMG installer"
