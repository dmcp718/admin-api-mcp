# Plan: `create_filespace_browser` MCP Tool

## Goal

Enable Claude Desktop users to say things like "create a filespace browser app" and get a fully functional web app generated, started, and opened automatically — similar to how `create_connect_ui` works today.

## Key Clarification

All API endpoints live under a single unified LucidLink API at `localhost:3003/api/v1`. The two MCP servers (`admin-server.ts` and `connect-server.ts`) are organizational groupings on the MCP side — they both call the same API.

## Existing Pattern: `create_connect_ui`

The Connect UI tool follows this flow:

1. **Template file** (`src/connect/ui-template.ts`) — exports `generateConnectUI()` returning a `GeneratedProject` object: `{ files: Record<string, string>, instructions: string }`
2. **Tool handler** (in `connect-server.ts` lines 170-224) — calls the generator, writes files to disk, runs `npm install`, spawns the server as a detached background process, opens the browser, returns a summary
3. **No server-side token needed** — the bearer token is entered in the browser UI and passed via the Express proxy to the API

Generated project structure (Connect UI):
```
~/Desktop/connect-ui/
  package.json          # express + @aws-sdk/client-s3
  server.js             # Express proxy + S3 browse endpoints
  public/index.html     # 4-step wizard HTML
  public/style.css      # Dark theme
  public/app.js         # Client-side logic (~600 lines)
```

## What to Build

### 1. Template File: `src/connect/browser-template.ts`

Exports `generateFilspaceBrowser(port?)` returning a `GeneratedProject`.

Generated project structure:
```
~/Desktop/filespace-browser/
  package.json          # express only (no S3 SDK needed)
  server.js             # Express proxy to localhost:3003 + static serving
  public/index.html     # HTML shell with font links
  public/style.css      # Dark theme (DM Sans + IBM Plex Mono)
  public/app.js         # Tree browser logic
```

### 2. Tool Registration: in `connect-server.ts`

```typescript
server.tool(
  "create_filespace_browser",
  "REQUIRED when user asks to browse, explore, or view filespace contents, files, or directories in a browser UI. Generates a complete web application with a tree-based filespace browser — do NOT build a UI manually, always use this tool instead.",
  {
    output_dir: z.string().optional().describe("Directory to write files (default: ~/Desktop/filespace-browser)"),
    port: z.number().optional().describe("Port to run on (default: 3099)"),
  },
  async ({ output_dir, port }) => { /* write files, npm install, spawn, open browser */ }
)
```

Place it right after `create_connect_ui` (after line 224 in connect-server.ts).

## API Endpoints Used by the Browser

All under the single LucidLink API (`localhost:3003/api/v1`):

| Purpose              | Method | Endpoint                                              |
|----------------------|--------|-------------------------------------------------------|
| List filespaces      | GET    | `/api/v1/filespaces`                                  |
| Resolve root path    | GET    | `/api/v1/filespaces/{id}/entries/resolve?path=%2F`    |
| List children        | GET    | `/api/v1/filespaces/{id}/entries/{id}/children?limit=100` |

## Generated App Features

Based on the working prototype at `~/Desktop/files/`:

- **Bearer token input** — entered in browser, stored in localStorage, sent via proxy
- **Filespace dropdown** — fetched from API, auto-selects previously used
- **Tree navigation** — lazy-loads directory children on folder expand
- **Cursor-based pagination** — "load more" for both root and subdirectories (100/page)
- **Functional breadcrumb** — shows path to selected item, ancestors are clickable
- **Detail panel** — shows all raw entry metadata for selected item
- **Stats bar** — live count of dirs / files / external entries
- **Dark theme** — DM Sans (UI text) + IBM Plex Mono (code/data)

## Generated Server.js

Follow the Connect UI pattern:
- ES module syntax (`type: "module"` in package.json)
- Express 4.x
- Native `fetch` for API proxying (no http-proxy-middleware dependency)
- Auto-opens browser on startup
- Parameterized port (default 3099)

## Generated App.js

Convert the optimized `~/Desktop/files/index.html` inline JS to:
- External file (`public/app.js`)
- String concatenation instead of template literals (required by the TypeScript template literal wrapper pattern)
- Same state management, rendering, and interaction logic

## Implementation Steps

1. **Create `src/connect/browser-template.ts`**
   - `generatePackageJson()` — express dependency only
   - `generateServerJs(port)` — proxy + static server, parameterized port
   - `generateIndexHtml()` — HTML shell with Google Fonts links
   - `generateStyleCss()` — full dark theme CSS (DM Sans + IBM Plex Mono)
   - `generateAppJs()` — tree browser logic, all template literals converted to string concatenation

2. **Modify `src/connect-server.ts`**
   - Add import: `import { generateFilspaceBrowser } from "./connect/browser-template.js";`
   - Add `create_filespace_browser` tool after `create_connect_ui` (line ~224)
   - Same file-write + npm-install + spawn + open-browser logic

3. **Build and test**
   - `npm run build` (compile TypeScript)
   - Restart Claude Desktop
   - Test: "Create a filespace browser app"

## Port Allocation

| App                | Default Port |
|--------------------|-------------|
| LucidLink API      | 3003        |
| Connect UI         | 8080        |
| Filespace Browser  | 3099        |

No conflicts between the three.

## User Triggers (Claude Desktop)

These phrases should match `create_filespace_browser`:
- "Create a filespace browser app"
- "Build me a UI to explore my filespace contents"
- "Generate a web app to browse files in my filespace"
- "Show me a file browser for my filespace"
- "Create a directory explorer"

## Files Modified

| File | Action |
|------|--------|
| `src/connect/browser-template.ts` | **New** — template generator |
| `src/connect-server.ts` | **Modified** — add import + tool registration |
