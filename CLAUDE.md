# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that enables natural language interaction with the LucidLink Admin API through Claude Desktop on macOS. The server acts as a bridge between Claude's conversational interface and LucidLink's container-based Admin API, handling Docker management, authentication, and API operations.

**Target Users**: Non-technical LucidLink Business/Enterprise customers who need to manage filespaces, users, groups, and permissions.

## Architecture

### Three-Tier Architecture

1. **MCP Server Layer** (`lucidlink_mcp_server.py`)
   - Exposes MCP tools to Claude Desktop
   - Handles input validation and sanitization
   - Provides user-friendly error messages
   - Implements rate limiting (10 calls/60 seconds)

2. **Docker Management Layer** (`DockerManager` class)
   - Detects and starts Docker Desktop on macOS
   - Manages the LucidLink API container lifecycle
   - Handles container logs and diagnostics
   - Auto-restarts containers with `unless-stopped` policy

3. **API Client Layer** (`LucidLinkAPIClient` class)
   - Makes authenticated requests to `http://localhost:3003/api/v1`
   - Translates between MCP tools and REST API endpoints
   - Handles error responses and connection issues

### Key Components

**Security & Authentication**:
- Bearer tokens stored in macOS Keychain via `keyring` library
- Fallback to `LUCIDLINK_BEARER_TOKEN` environment variable
- Token retrieval: `get_bearer_token()` function (lucidlink_mcp_server.py:458)

**Input Validation**:
- `InputValidator` class (lucidlink_mcp_server.py:405)
- Validates filespace names (3-63 chars, alphanumeric with hyphens/underscores)
- Validates email addresses (RFC-compliant regex)
- Sanitizes group names (removes special characters)

**Rate Limiting**:
- `RateLimiter` class (lucidlink_mcp_server.py:68)
- Sliding window algorithm
- Returns time until reset when limit exceeded

**Container Management**:
- Container name: `lucidlink-api`
- Default image: `lucidlink/lucidlink-api:latest` (from Docker Hub)
- Port mapping: 3003 → localhost:3003
- Image pulling: Automatic when container starts (via `pull_image` method)
- Users can manually trigger: "Pull the container image"
- Server automatically pulls from Docker Hub if image is missing

## Development Commands

### Testing

```bash
# Run installation test suite
uv run python test_installation.py

# Test MCP server directly (bypasses Claude Desktop)
cd ~/lucidlink-mcp
uv run python lucidlink_mcp_server.py

# Check Docker container status
docker ps | grep lucidlink-api

# View container logs
docker logs lucidlink-api

# Check if bearer token is stored
security find-generic-password -a "lucidlink-mcp" -s "lucidlink-mcp" -w
```

### Installation

```bash
# Automated installation (installs uv if needed)
chmod +x install.sh
./install.sh

# Manual uv installation
curl -LsSf https://astral.sh/uv/install.sh | sh

# Note: Dependencies are automatically installed via pyproject.toml when using 'uv run'
# No manual installation of dependencies is needed
```

### Configuration

**Claude Desktop Config**: `~/Library/Application Support/Claude/claude_desktop_config.json`

The MCP server is registered with Claude Desktop through this config file using `uv run` to avoid Python environment issues. The installer (`install.sh`) automatically creates/updates it with the correct configuration:

```json
{
  "mcpServers": {
    "lucidlink-admin-api": {
      "command": "/Users/YOUR_USERNAME/.local/bin/uv",
      "args": [
        "--directory",
        "/Users/YOUR_USERNAME/lucidlink-mcp",
        "run",
        "python",
        "lucidlink_mcp_server.py"
      ],
      "env": {
        "PYTHONUNBUFFERED": "1"
      }
    }
  }
}
```

**Important:**
- Must use the full path to `uv` because GUI apps like Claude Desktop don't inherit the terminal's PATH environment variable
- The `--directory` flag tells uv where to find `pyproject.toml` and which virtual environment to use

## MCP Tools

The server exposes 16 MCP tools (conversational commands):

### Docker & Container Management
- `check_docker_status` - Verify Docker is running and start if needed
- `start_api_container` - Start the LucidLink API container (auto-pulls image if needed)
- `view_container_logs` - View container logs for debugging
- **`pull_container_image`** - Manually pull image from Docker Hub (lucidlink/lucidlink-api)
- **`check_container_image`** - Check if container image is available locally

### API Operations (14 tools)

The server implements 14 LucidLink Admin API operations:

| MCP Tool | HTTP Method | API Endpoint |
|----------|-------------|--------------|
| `create_filespace` | POST | `/api/v1/filespaces` |
| `list_filespaces` | GET | `/api/v1/filespaces` |
| `get_filespace_details` | GET | `/api/v1/filespaces/{id}` |
| `delete_filespace` | DELETE | `/api/v1/filespaces/{id}` |
| `add_member` | POST | `/api/v1/members` |
| `list_members` | GET | `/api/v1/members` |
| `remove_member` | DELETE | `/api/v1/members/{id}` |
| `create_group` | POST | `/api/v1/groups` |
| `list_groups` | GET | `/api/v1/groups` |
| `add_member_to_group` | PUT | `/api/v1/groups/members` |
| `grant_permission` | POST | `/api/v1/filespaces/{id}/permissions` |
| `list_permissions` | GET | `/api/v1/filespaces/{id}/permissions` |
| `check_api_health` | GET | `/api/v1/health` |

## User Experience for Non-Technical Users

The MCP server is designed to handle Docker complexity automatically:

1. **Automatic Image Pulling**: When user starts the container, the image is automatically pulled from Docker Hub if not present locally. No manual intervention required!

2. **Zero Configuration**: Users just say "Start the API container" and everything happens automatically:
   - Checks if Docker is running
   - Pulls `lucidlink/lucidlink-api:latest` from Docker Hub (if needed)
   - Creates and starts the container
   - Maps port 3003 to localhost

3. **Manual Pull Option**: Advanced users can pre-pull the image:
   - User: "Pull the container image"
   - Claude calls `pull_container_image` tool
   - Image downloads from Docker Hub

4. **Helpful Error Messages**: All Docker errors translated to user-friendly language

## Common Development Patterns

### Adding a New API Operation

1. Add method to `LucidLinkAPIClient` class (follows pattern: `def operation_name(self, ...) -> ApiResponse`)
2. Define MCP tool in `@server.list_tools()` decorator (lucidlink_mcp_server.py:503)
3. Implement tool handler in `@server.call_tool()` decorator (lucidlink_mcp_server.py:761)
4. Add input validation if needed (use `InputValidator` class)
5. Format success/error responses with `format_success_message()` / `format_error_message()`

### Error Handling Strategy

- Connection errors → "Cannot connect to API. Please ensure Docker container is running."
- 401 errors → "Authentication failed - check your Bearer token"
- 404 errors → "Resource not found"
- 409 errors → "Resource already exists. Please choose a different name."
- Rate limit exceeded → "Too many requests. Please wait {time} seconds."

All errors are translated to user-friendly messages in `format_error_message()` (lucidlink_mcp_server.py:485)

### Testing with Claude Desktop

After making changes:
1. Save changes to `lucidlink_mcp_server.py`
2. Restart Claude Desktop (Cmd+Q, then reopen)
3. Test with natural language: "Check Docker status", "List all filespaces", etc.

### Debugging

**MCP Server Logs**: Check Claude Desktop's developer console (not exposed in UI)

**Container Logs**:
```bash
docker logs -f lucidlink-api  # Follow logs in real-time
```

**Manual Server Testing**:
```bash
# Run server in stdio mode (simulates Claude Desktop connection)
cd ~/lucidlink-mcp
uv run python lucidlink_mcp_server.py
# Server will wait for JSON-RPC messages on stdin
```

## Important Constraints

1. **macOS Only**: Docker detection uses `/Applications/Docker.app` path
2. **Python 3.10+**: Required by MCP SDK (automatically handled by uv)
3. **uv Required**: Uses `uv run` to avoid Python environment/version conflicts
4. **Docker Desktop Required**: Cannot use Docker Engine alone (needs `open -a Docker` command)
5. **Internet Connection**: Required to pull `lucidlink/lucidlink-api` from Docker Hub
6. **Bearer Token Security**: Never log or expose bearer tokens in error messages

## File Structure

```
.
├── lucidlink_mcp_server.py    # Main MCP server (1263 lines)
├── pyproject.toml              # Python project config and dependencies (uv format)
├── install.sh                  # Automated installer for macOS
├── test_installation.py        # Installation verification script
├── claude_desktop_config.json  # Example Claude Desktop config
└── README.md                   # User documentation
```

## Dependencies

All dependencies are declared in `pyproject.toml` and automatically managed by `uv run`:

- `docker>=6.1.3` - Docker SDK for Python (container management)
- `requests>=2.31.0` - HTTP client (API calls)
- `keyring>=24.2.0` - Secure token storage (macOS Keychain)
- `mcp>=0.1.0` - Model Context Protocol SDK
- `aiohttp>=3.9.0` - Async HTTP (optional, performance optimization)

When you run `uv run lucidlink_mcp_server.py`, uv automatically:
1. Creates an isolated virtual environment (if it doesn't exist)
2. Installs all dependencies from `pyproject.toml`
3. Runs the script in that environment

This eliminates conflicts with system Python or other virtual environments, and requires no manual dependency installation.

## Security Considerations

- Input validation prevents command injection in filespace/group names
- Rate limiting prevents accidental API abuse
- Bearer tokens stored in macOS Keychain (encrypted at rest)
- No sensitive data logged (tokens redacted)
- Container runs with restart policy to prevent downtime

## Natural Language Processing

The MCP server does NOT include NLP logic. Claude Desktop handles intent recognition and calls the appropriate MCP tools. The server only:
- Validates inputs
- Calls API endpoints
- Formats responses

Example flow:
1. User: "Create a filespace called marketing-assets"
2. Claude interprets intent → calls `create_filespace` tool with `name="marketing-assets"`
3. Server validates name → calls API → returns formatted response
4. Claude presents result to user in natural language
