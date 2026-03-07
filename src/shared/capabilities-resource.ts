/**
 * LucidLink MCP capabilities guide — registered as a resource on every server.
 * Gives Claude Desktop a complete map of what's available, how the pieces
 * connect, and how to use them correctly.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const CAPABILITIES_GUIDE = `LucidLink MCP — Complete Capabilities Guide
=============================================

You have access to 4 MCP servers that together manage LucidLink filespaces.
All servers share a common LucidLink API running at localhost:3003.
Read this guide before taking action — it will save you from mistakes.

ARCHITECTURE
============
                                    ┌─ lucidlink-api (28 tools)
  Claude Desktop ──► MCP servers ───┼─ lucidlink-connect-api (18 tools)
                                    ├─ lucidlink-filespace-search (4 tools)
                                    └─ lucidlink-filespace-browser (1 tool)
                                          │
                          LucidLink API ◄──┘  (localhost:3003, Node.js process)
                          fs-index-server ◄── (localhost:3201, Go binary)

The LucidLink API is a single process shared by lucidlink-api and lucidlink-connect-api.
The fs-index-server is a separate Go binary managed by lucidlink-filespace-search.

IMPORTANT RULES
===============
- NEVER rewrite or replace the Go binary (fs-index-server) — it is a compiled,
  tested backend with SQLite FTS5 search. If it fails, diagnose the error.
- NEVER build a search backend in Python, FastAPI, or any other language.
- NEVER use fonts other than Inter (body) and IBM Plex Mono (monospace).
  Read the lucidlink://brand/design-tokens resource for full brand guidelines.
- ALWAYS use existing tools. Do not build custom scripts for tasks the tools handle.
- When generating any UI, use dark theme (#151519 background, white text, #B0FB15 accent).

SERVER 1: lucidlink-api (filespace administration)
==================================================
Manages filespaces, users, groups, and permissions via the LucidLink Admin API.

Process management:
  check_api_status          — is the API running?
  initialize_api            — start the API process (auto-pulls Docker image if needed)
  view_api_logs             — show recent API logs for debugging
  check_api_health          — lightweight health check
  list_providers            — list cloud storage providers

Filespace CRUD:
  create_filespace          — create a new filespace (needs name, provider, region)
  list_filespaces           — list all filespaces
  get_filespace_details     — get details for one filespace by ID
  update_filespace          — update filespace settings
  delete_filespace          — delete a filespace by ID

Member management:
  add_member                — invite user by email to a filespace
  list_members              — list all members of a filespace
  get_member_details        — get details for one member
  remove_member             — remove a member from a filespace
  update_member_role        — change a member's role (admin, contributor, viewer)
  get_member_groups         — list groups a member belongs to

Group management:
  create_group              — create a group in a filespace
  list_groups               — list all groups in a filespace
  get_group                 — get group details
  update_group              — rename a group
  delete_group              — delete a group
  list_group_members        — list members in a group
  add_member_to_group       — add a member to a group (batch endpoint, works for one or many)
  remove_member_from_group  — remove a member from a group

Permissions:
  grant_permission          — grant folder permission to a user or group
  list_permissions          — list permissions on a filespace
  update_permission         — change permission level
  revoke_permission         — remove a permission

Example workflow — set up a new filespace:
  1. list_providers → get provider ID
  2. create_filespace → get filespace ID
  3. add_member (for each user) → get member IDs
  4. create_group → get group ID
  5. add_member_to_group → assign members
  6. grant_permission → set folder access

SERVER 2: lucidlink-connect-api (S3 object linking)
====================================================
Links existing S3 objects into a filespace as read-only entries.
Process management (check_api_status, view_api_logs, initialize_api) is on lucidlink-api only.

Workflow guide:
  get_connect_workflow_guide — full quickstart and reference (call this first)

UI generation:
  create_connect_ui         — generates a complete web app for S3 browsing/importing
                              Do NOT build UIs manually — always use this tool.

High-level tools (recommended):
  ensure_folder_path        — create nested directory structure in one call
  import_s3_object          — create dirs + link one S3 object
  bulk_import_s3_objects    — create dirs + link many objects with progress

Primitive API tools:
  create_entry              — create a folder entry
  resolve_entry             — resolve path to entry ID
  get_entry                 — get entry by ID
  delete_entry              — delete an entry
  list_entry_children       — list folder contents

Data store management:
  create_data_store         — register S3 bucket credentials
  list_data_stores          — list configured data stores
  get_data_store            — get data store details
  update_data_store         — rotate credentials
  delete_data_store         — remove a data store

External entries:
  create_external_entry     — link an S3 object to a filespace path
  list_external_entry_ids   — list linked objects
  delete_external_entry     — unlink an object

Example workflow — link S3 objects:
  1. create_data_store (bucket, credentials)
  2. ensure_folder_path ("/videos/2024")
  3. bulk_import_s3_objects (list of S3 keys)

SERVER 3: lucidlink-filespace-search (file indexing & search)
=============================================================
Runs a Go backend (fs-index-server) that crawls mounted filespaces and provides
full-text search via SQLite FTS5.

Tools:
  start_filespace_indexer   — start the Go binary (discovers mounts via lucid CLI,
                              begins crawling). Call this first. All parameters optional.
  search_filespace          — FTS5 search across all indexed files
                              Returns file names and paths, supports filespace filtering.
  browse_filespace          — list directory contents (like ls)
  indexer_status            — check mount points, crawl progress, file counts

Example workflow — search files:
  1. start_filespace_indexer (no args needed — auto-discovers mounts)
  2. search_filespace (query: "quarterly report")
  3. browse_filespace (path: "/Volumes/myfs/documents")

The indexer runs continuously in the background. Once started, search and browse
work immediately (results improve as crawling progresses).

SERVER 4: lucidlink-filespace-browser (visual file browser)
============================================================
Generates a standalone web application for browsing filespace contents.

Tools:
  create_filespace_browser  — generates a complete Node.js + Express web app with
                              tree-based file browser, starts it, and opens the browser.
                              Do NOT build file browsers manually — always use this tool.

WHEN TO USE WHICH SERVER
========================
"List my filespaces"              → lucidlink-api: list_filespaces
"Add a user to the marketing fs"  → lucidlink-api: add_member
"Search for quarterly reports"    → lucidlink-filespace-search: start_filespace_indexer + search_filespace
"Browse the videos folder"        → lucidlink-filespace-search: browse_filespace
"Show me a file browser"          → lucidlink-filespace-browser: create_filespace_browser
"Link S3 objects into a filespace"→ lucidlink-connect-api: get_connect_workflow_guide, then follow steps
"Create a Connect import UI"      → lucidlink-connect-api: create_connect_ui
"Set folder permissions"          → lucidlink-api: grant_permission

GENERATING UIs
==============
When asked to create any UI, dashboard, or web interface:
1. Check if a tool already generates it (create_connect_ui, create_filespace_browser)
2. If yes, USE THAT TOOL — do not build from scratch
3. If you must generate custom UI, read lucidlink://brand/design-tokens first
4. Use: Inter font, dark theme (#151519), neon accent (#B0FB15), sentence case
5. Never use: DM Sans, Aeonik, system fonts, title case, right-aligned text, FastAPI`;

export function registerCapabilitiesResource(server: McpServer): void {
  server.resource(
    "capabilities-guide",
    "lucidlink://guide/capabilities",
    {
      description: "Complete guide to all LucidLink MCP capabilities — servers, tools, workflows, and rules. READ THIS FIRST before taking any action.",
      mimeType: "text/plain",
    },
    async () => ({
      contents: [{
        uri: "lucidlink://guide/capabilities",
        text: CAPABILITIES_GUIDE,
      }],
    }),
  );
}
