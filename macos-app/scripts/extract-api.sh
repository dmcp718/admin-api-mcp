#!/usr/bin/env bash
set -euo pipefail

IMAGE="lucidlink/lucidlink-api:latest"
API_SRC="/app/LucidAPI/dist"
OUTPUT_DIR="$(dirname "$0")/../build/api"

echo "Extracting LucidLink API from Docker image..."

# Create temp container (does not start it)
CONTAINER=$(docker create "$IMAGE" 2>/dev/null)
trap "docker rm '$CONTAINER' >/dev/null 2>&1" EXIT

mkdir -p "$OUTPUT_DIR"

# Copy all dist files (main.js, WasmModule.wasm, index.html, swagger.json, etc.)
docker cp "$CONTAINER:$API_SRC/." "$OUTPUT_DIR/"


echo "API files extracted to $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR"
