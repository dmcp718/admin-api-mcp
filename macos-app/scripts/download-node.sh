#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="v24.1.0"
ARCH="arm64"
CACHE_DIR="$(dirname "$0")/../build/node-cache"
NODE_TAR="node-${NODE_VERSION}-darwin-${ARCH}.tar.gz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TAR}"
OUTPUT="$(dirname "$0")/../build/node"

mkdir -p "$CACHE_DIR"

# Download if not cached
if [ ! -f "$CACHE_DIR/$NODE_TAR" ]; then
    echo "Downloading Node.js ${NODE_VERSION} (${ARCH})..."
    curl -fSL "$NODE_URL" -o "$CACHE_DIR/$NODE_TAR"
else
    echo "Using cached Node.js ${NODE_VERSION}"
fi

# Extract just the node binary
echo "Extracting node binary..."
tar -xzf "$CACHE_DIR/$NODE_TAR" -C "$CACHE_DIR" --strip-components=2 "node-${NODE_VERSION}-darwin-${ARCH}/bin/node"
mv "$CACHE_DIR/node" "$OUTPUT"
chmod +x "$OUTPUT"

echo "Node.js binary ready at $OUTPUT"
ls -lh "$OUTPUT"
