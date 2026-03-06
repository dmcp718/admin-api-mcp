# LucidLink MCP — macOS Desktop App

Packages the LucidLink Admin & Connect MCP servers into a signed macOS .app for one-click installation with Claude Desktop.

## Prerequisites

- macOS 13+ (arm64)
- Xcode Command Line Tools (`xcode-select --install`)
- Docker (for extracting LucidLink API)
- Apple Developer ID (optional, for signing/notarization)

## Build

```bash
cd macos-app
make build        # Build unsigned .app
make sign         # Code sign + notarize (requires DEVELOPER_ID_APP)
make dmg          # Create DMG installer
make all          # Build + sign + DMG
make clean        # Clean build output (preserves node cache)
make clean-all    # Remove everything including cache
```

## Environment Variables (signing)

```bash
export DEVELOPER_ID_APP="Developer ID Application: Your Name (TEAMID)"
export NOTARY_KEYCHAIN_PROFILE="your-notary-profile"
```

Set up the notary profile once:
```bash
xcrun notarytool store-credentials "your-notary-profile" \
    --apple-id "you@example.com" \
    --team-id "TEAMID" \
    --password "app-specific-password"
```

## What the app does

- **Menu bar only** (no Dock icon) — sits quietly in the menu bar
- **Auto-configures Claude Desktop** on first launch (merges MCP server entries)
- **Check API Status** — quick health check of the LucidLink API
- Bundles Node.js, MCP servers, and LucidLink API — no system dependencies needed

## App Bundle Layout

```
LucidLink MCP.app/Contents/
├── MacOS/LucidLinkMCP          # Swift menu bar binary
├── Info.plist
└── Resources/
    ├── node                    # Bundled Node.js arm64
    ├── mcp/                    # Compiled MCP servers
    ├── node_modules/           # Production dependencies
    └── api/                    # LucidLink API (main.js + WasmModule.wasm)
```
