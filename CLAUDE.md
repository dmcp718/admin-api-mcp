# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that enables natural language interaction with the LucidLink Admin API through Claude Desktop on macOS. The server acts as a bridge between Claude's conversational interface and LucidLink's container-based Admin API, handling Docker management, authentication, and API operations.

**Target Users**: Non-technical LucidLink Business/Enterprise customers who need to manage filespaces, users, groups, and permissions.

**Repository**: https://github.com/dmcp718/admin-api-mcp.git

## Project Status

**Last Updated**: 2025-11-06

### Recent Improvements (November 2025)

1. **Installation Script Enhancements**:
   - Added Claude Desktop installation check (exits early if not installed)
   - Fixed uv PATH detection after fresh installation
   - Added automatic keychain token migration from old format
   - Improved keychain error handling (updates existing tokens gracefully)
   - Pre-checks keychain for existing tokens to avoid unnecessary prompts

2. **Documentation Updates**:
   - Fixed API endpoints table alignment in README
   - Added missing `/providers` and `/health` endpoints
   - Enhanced webhook integration examples
   - Cleaned up unnecessary sections

3. **Critical Bug Fixes**:
   - Fixed keychain account name mismatch (was `lucidlink-mcp`, now `bearer_token`)
   - Installation script no longer stops when keychain entry already exists
   - Token now automatically retrieved from keychain on server startup

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
- **CRITICAL**: Keychain service name is `"lucidlink-mcp"`, account name is `"bearer_token"`
- Fallback to `LUCIDLINK_BEARER_TOKEN` environment variable
- Token retrieval: `get_bearer_token()` function (lucidlink_mcp_server.py:497)
- Storage command: `security add-generic-password -a "bearer_token" -s "lucidlink-mcp" -w "TOKEN"`

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

# Check if bearer token is stored (correct format)
security find-generic-password -a "bearer_token" -s "lucidlink-mcp" -w

# Check for old format token (if migration is needed)
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
    "lucidlink-api": {
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

| MCP Tool                | HTTP Method | API Endpoint                                 |
|-------------------------|-------------|----------------------------------------------|
| `create_filespace`      | POST        | `/api/v1/filespaces`                         |
| `list_filespaces`       | GET         | `/api/v1/filespaces`                         |
| `get_filespace_details` | GET         | `/api/v1/filespaces/{id}`                    |
| `delete_filespace`      | DELETE      | `/api/v1/filespaces/{id}`                    |
| `add_member`            | POST        | `/api/v1/members`                            |
| `list_members`          | GET         | `/api/v1/members`                            |
| `remove_member`         | DELETE      | `/api/v1/members/{id}`                       |
| `create_group`          | POST        | `/api/v1/groups`                             |
| `list_groups`           | GET         | `/api/v1/groups`                             |
| `add_member_to_group`   | PUT         | `/api/v1/groups/members`                     |
| `grant_permission`      | POST        | `/api/v1/filespaces/{id}/permissions`        |
| `list_permissions`      | GET         | `/api/v1/filespaces/{id}/permissions`        |
| `list_providers`        | GET         | `/api/v1/providers`                          |
| `check_api_health`      | GET         | `/api/v1/health`                             |

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
2. **Claude Desktop Required**: Installation script checks for `/Applications/Claude.app`
3. **Python 3.10+**: Required by MCP SDK (automatically handled by uv)
4. **uv Required**: Uses `uv run` to avoid Python environment/version conflicts
5. **Docker Desktop Required**: Cannot use Docker Engine alone (needs `open -a Docker` command)
6. **Internet Connection**: Required to pull `lucidlink/lucidlink-api` from Docker Hub
7. **Bearer Token Security**: Never log or expose bearer tokens in error messages

## Known Issues & Solutions

### Installation Issues

**Issue**: Script stops after "7️⃣ Authentication Setup" with no prompt
- **Cause**: Old keychain token format (account name was `lucidlink-mcp` instead of `bearer_token`)
- **Solution**: Script now auto-migrates old tokens. Re-run `./install.sh` to fix.

**Issue**: "Failed to install uv" error despite successful installation
- **Cause**: `~/.local/bin` not in PATH during script execution
- **Solution**: Script now adds to PATH for current session and checks direct file path

**Issue**: Script exits when keychain entry already exists
- **Cause**: Poor error handling with `security` command chaining
- **Solution**: Now uses proper if/else logic and updates existing entries gracefully

**Issue**: Token in keychain but Claude Desktop asks for it anyway
- **Cause**: Mismatch between keychain storage account name and retrieval account name
- **Solution**: Fixed in commit e592a3a - both now use account name `"bearer_token"`

### Runtime Issues

**Issue**: API not initialized error despite token in keychain
- **Cause**: Server looking for account name `"bearer_token"` but token stored as `"lucidlink-mcp"`
- **Solution**: Re-run installer to migrate token, or manually update:
  ```bash
  # Delete old format
  security delete-generic-password -a "lucidlink-mcp" -s "lucidlink-mcp"

  # Add new format
  security add-generic-password -a "bearer_token" -s "lucidlink-mcp" -w "YOUR_TOKEN"
  ```

## Installation Flow (Current Version)

The `install.sh` script performs these steps in order:

1. **Check macOS** - Verify running on macOS (exits if not)
2. **Check Claude Desktop** - Verify `/Applications/Claude.app` exists (exits if not)
3. **Check/Install uv** - Install if missing, add to PATH for session
4. **Check/Start Docker Desktop** - Start automatically if installed but not running
5. **Create Installation Directory** - `~/lucidlink-mcp` (prompts if exists)
6. **Copy Server Files** - `lucidlink_mcp_server.py` and `pyproject.toml`
7. **Configure Dependencies** - Via `pyproject.toml` (installed on first run)
8. **Authentication Setup**:
   - Check for new format token (`-a "bearer_token"`)
   - Check for old format token and migrate if found
   - Prompt for token if not found (or offer to update)
9. **Configure Claude Desktop** - Update `claude_desktop_config.json`
10. **Container Image Note** - Inform about auto-pull from Docker Hub
11. **Test Installation** - Verify dependencies with `uv run`
12. **Success Message** - Display next steps and helpful commands

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
