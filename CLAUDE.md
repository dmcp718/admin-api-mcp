# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

LucidLink MCP — a suite of MCP servers and a macOS desktop app that enable natural language interaction with LucidLink services through Claude Desktop. TypeScript-only codebase, no Python, no Docker at runtime.

**Repository**: https://github.com/dmcp718/admin-api-mcp.git
**Last Updated**: 2026-03-08

## Architecture

### Four MCP Servers (all TypeScript, stdio transport)

| Server | File | Description |
|--------|------|-------------|
| `lucidlink-api` | `src/lucid-api-server.ts` | 30 tools — manage filespaces, members, groups, permissions via LucidLink Admin API + docs search |
| `lucidlink-connect-api` | `src/connect-server.ts` | 21 tools — manage data stores, entries, S3 workflows via LucidLink Connect |
| `lucidlink-filespace-search` | `src/search-server.ts` | Search UI generator + fs-index-server API reference resource |
| `lucidlink-filespace-browser` | `src/browser-server.ts` | Filespace browser web app generator |

### fs-index-server (Go binary)

A standalone Go HTTP server that crawls and indexes mounted LucidLink filespaces using SQLite FTS5.

| Path | Purpose |
|------|---------|
| `fs-index-server/main.go` | Entry point, routes, CORS, mount discovery |
| `fs-index-server/db.go` | SQLite schema, FTS5 search, file upsert |
| `fs-index-server/crawler.go` | Background directory crawler |
| `fs-index-server/handlers_search.go` | SSE search endpoints |
| `fs-index-server/handlers_direct_link.go` | Direct link proxy to LucidLink client API |
| `fs-index-server/mount_discovery.go` | `lucid list` + `lucid status` mount/port parsing |

**Key endpoints**: `/api/files`, `/api/mounts`, `/api/direct-link`, `/sse/search`, `/api/stats`, `/api/crawl/stats`

**Multi-mount support**: Uses `commonAncestor()` to compute mount prefix across all discovered filespaces (e.g. `/Volumes/lucid-demo/connect-us` + `/Volumes/team-us` → `/Volumes`).

### Search UI (`src/connect/search-template.ts`)

Generates a complete 5-file web app (package.json, server.js, index.html, style.css, app.js):
- TC Files-inspired dark theme with blue accent (#4C8BFF)
- Virtual home view from `/api/mounts` when multiple filespaces mounted
- Dual-mode filter: type to filter directory, Enter to search all (FTS5)
- Direct Link column with open-in-browser and copy-to-clipboard buttons
- Sortable columns, breadcrumb navigation, filespace filter chips
- Express proxy: localhost:3099 → fs-index-server at localhost:3201

**Template literal escaping**: Use `\\\\s` for `\s` in regex patterns inside template strings (double-escape through TypeScript template literal).

### macOS Desktop App (`macos-app/`)

- **Bundle**: `LucidLinkMCP.app` (NO SPACES in name)
- **Node.js v22.18.0** — must match container version (v24 crashes the API)
- **Swift menu bar app**: LSUIElement=true, no Dock icon
- **Auto-starts API** on port 3003, auto-configures Claude Desktop on first run
- **MCP server manifest**: `mcp-servers.json` — single source of truth for all four servers
- **Build**: `cd macos-app && make build` (requires Docker for API extraction, Xcode CLT)

## Project Structure

```
admin-api-mcp/
├── package.json                 # @modelcontextprotocol/sdk, zod, typescript
├── tsconfig.json                # ES2022, Node16 modules
├── mcp-servers.json             # Manifest of all 4 MCP servers (used by macOS app)
├── src/
│   ├── lucid-api-server.ts      # Admin API MCP server (30 tools)
│   ├── connect-server.ts        # Connect API MCP server (21 tools)
│   ├── search-server.ts         # Filespace search MCP server
│   ├── browser-server.ts        # Filespace browser MCP server
│   ├── shared/                  # api-client, process-manager, keychain, etc.
│   ├── connect/                 # search-template, browser-template, ui-template
│   └── docs/                    # API documentation search
│       ├── docs-search.ts       # search_api_docs tool + doc resources
│       └── chunks/              # 8 markdown doc chunks (from api_docs/ PDFs)
├── fs-index-server/             # Go binary — crawl/index/search filespaces
│   ├── main.go
│   ├── db.go
│   ├── crawler.go
│   ├── handlers_*.go
│   ├── mount_discovery.go
│   └── templates/               # Go HTML templates for SSE responses
├── test/
│   └── ui-templates.test.ts     # Template generation tests
├── macos-app/
│   ├── LucidLinkMCP/            # Swift source
│   ├── scripts/                 # build.sh, download-node.sh, extract-api.sh
│   ├── Makefile                 # make build/sign/dmg/clean
│   └── build/                   # gitignored output
└── dist/                        # TypeScript build output (gitignored)
```

## Development Commands

```bash
# Build TypeScript
npm install && npm run build

# Run tests
npx tsx test/ui-templates.test.ts

# Build Go indexer
cd fs-index-server && go build -o fs-index-server . && cd ..

# Build macOS app (requires Docker + Xcode CLT)
cd macos-app && make build

# Deploy search UI to test directory
node -e "const {generateSearchUI}=require('./dist/connect/search-template'); ..."

# Run MCP servers directly
node dist/lucid-api-server.js      # Admin API (stdio)
node dist/connect-server.js        # Connect API (stdio)
node dist/search-server.js         # Search (stdio)
node dist/browser-server.js        # Browser (stdio)
```

## Key Technical Details

- **LucidLink Direct Link API**: `GET http://127.0.0.1:{port}/fsEntry/direct-link?path={relative_path}` → `{ "result": "https://app.lucidlink.com/l/1/..." }`. Port comes from `lucid list`.
- **Mount discovery**: `lucid list` parses instance ID, name, port; `lucid --instance N status` parses mount point.
- **Search hidden files**: Search results filter dotfiles unless "Show hidden" is toggled on.
- **Folder size**: Recursive API-based calculation capped at 3 levels depth; skipped on home view.
- **Authentication**: Bearer tokens stored in macOS Keychain. Keychain service: `lucidlink-mcp`, account: `bearer_token`.

## Contribution Guidelines

- DO NOT include Claude or Anthropic as contributor or co-author in commit messages
- NEVER add attribution or co-author
