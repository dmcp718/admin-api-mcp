# LucidLink MCP Server for Claude Desktop

## Overview

This MCP (Model Context Protocol) server enables non-technical users to interact with the LucidLink Admin API Container through natural language conversations in Claude Desktop for macOS. It handles Docker management, API authentication, and translates conversational requests into proper API calls.

## Features

### 🐳 Docker Management
- Automatic Docker Desktop detection and startup
- Container lifecycle management
- Log streaming and diagnostics

### 📁 Filespace Operations
- Create new filespaces with customizable regions and storage providers
- List and manage existing filespaces
- Delete filespaces with safety confirmation

### 👥 User & Group Management
- Add members by email
- Create and manage groups
- Add/remove members from groups

### 🔐 Permission Control
- Grant read/write/admin permissions
- Manage access at folder level
- Support for both user and group permissions

### 🛡️ Security & Safety
- Secure token storage in macOS Keychain
- Input validation and sanitization
- Rate limiting to prevent abuse
- User-friendly error messages

## Prerequisites

- **macOS** (Intel or Apple Silicon)
- **LucidLink Business or Enterprise plan**
- **Service Account** with API access
- **uv** (Python package manager) - auto-installed by install.sh
- **Docker Desktop for Mac**

## Quick Installation

1. **Download the files**:
   - `lucidlink_mcp_server.py`
   - `pyproject.toml`
   - `install.sh`

2. **Run the installer**:
   ```bash
   chmod +x install.sh
   ./install.sh
   ```

3. **Follow the prompts** to:
   - Install Docker Desktop (if needed)
   - Enter your bearer token
   - Configure Claude Desktop

4. **Restart Claude Desktop**

## Manual Installation

### Step 1: Install Docker Desktop

Download from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)

### Step 2: Get Your Bearer Token

1. Log into LucidLink Admin Portal
2. Navigate to **Service Accounts**
3. Create or select a Service Account
4. Generate a **secret key** (this is your bearer token)

### Step 3: Install uv and the MCP Server

```bash
# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Create installation directory
mkdir -p ~/lucidlink-mcp
cd ~/lucidlink-mcp

# Copy the server files
cp lucidlink_mcp_server.py ~/lucidlink-mcp/
cp pyproject.toml ~/lucidlink-mcp/

# Note: Dependencies are automatically installed when you first run the server with 'uv run'

# Store bearer token securely (optional but recommended)
security add-generic-password -a "lucidlink-mcp" -s "lucidlink-mcp" -w "YOUR_BEARER_TOKEN"
```

### Step 4: Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

**Note:**
- Use the full path to `uv` (typically `~/.local/bin/uv`) because Claude Desktop doesn't inherit your terminal's PATH
- The `--directory` flag tells uv to use the pyproject.toml from that directory

### Step 5: Restart Claude Desktop

Restart Claude Desktop to load the MCP server.

## Usage Examples

### First Time Setup

**You**: "Check if Docker is running"
> Claude checks Docker status and starts it if needed

**You**: "Pull the container image"
> Claude pulls the lucidlink/lucidlink-api image from Docker Hub (happens automatically when needed)

**You**: "Initialize the API"
> Claude sets up the API connection with your bearer token

### Creating Resources

**You**: "Create a new filespace called marketing-assets"
> Claude creates a filespace with default settings (AWS, us-east-1)

**You**: "Create a filespace called eu-data in Europe"
> Claude creates a filespace in eu-west-1 region

**You**: "Add sarah@company.com to the workspace"
> Claude adds the new member

**You**: "Create a group called Design Team"
> Claude creates the new group

### Managing Permissions

**You**: "Give the Design Team read access to marketing-assets"
> Claude grants read permissions to the group

**You**: "Grant admin access to john@company.com on the eu-data filespace"
> Claude grants admin permissions to the user

### Viewing Information

**You**: "Show me all filespaces"
> Claude lists all filespaces with details

**You**: "List all members"
> Claude shows all workspace members

**You**: "What permissions are set on marketing-assets?"
> Claude displays all permissions for that filespace

## Natural Language Patterns

The MCP server understands various ways to express the same action:

### Creating Filespaces
- "Create a filespace called X"
- "Make a new filespace named X"
- "Set up a filespace for X"
- "I need a filespace called X"

### Adding Members
- "Add user@email.com"
- "Invite user@email.com to the workspace"
- "Give user@email.com access"
- "Include user@email.com as a member"

### Granting Permissions
- "Give the Marketing group read access to project-files"
- "Let the Marketing group view project-files"
- "Grant read permissions on project-files to Marketing"
- "Marketing should be able to read project-files"

## API Endpoints

The MCP server interacts with these LucidLink API endpoints:

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Create Filespace | POST | `/api/v1/filespaces` |
| List Filespaces | GET | `/api/v1/filespaces` |
| Get Filespace | GET | `/api/v1/filespaces/{id}` |
| Delete Filespace | DELETE | `/api/v1/filespaces/{id}` |
| Add Member | POST | `/api/v1/members` |
| List Members | GET | `/api/v1/members` |
| Remove Member | DELETE | `/api/v1/members/{id}` |
| Create Group | POST | `/api/v1/groups` |
| List Groups | GET | `/api/v1/groups` |
| Add to Group | PUT | `/api/v1/groups/members` |
| Grant Permission | POST | `/api/v1/filespaces/{id}/permissions` |
| List Permissions | GET | `/api/v1/filespaces/{id}/permissions` |

## Configuration

### Environment Variables

- `LUCIDLINK_BEARER_TOKEN`: Your Service Account bearer token
- `DOCKER_CONTAINER_IMAGE`: Container image name (default: lucidlink-api-container:latest)
- `PYTHONUNBUFFERED`: Set to "1" for real-time logging

### Storing Bearer Token

**Option 1: macOS Keychain (Recommended)**
```bash
security add-generic-password -a "lucidlink-mcp" -s "lucidlink-mcp" -w "YOUR_TOKEN"
```

**Option 2: Environment Variable**
```bash
export LUCIDLINK_BEARER_TOKEN="your_token_here"
```

**Option 3: Claude Desktop Config**
Add to the env section in `claude_desktop_config.json`:
```json
"env": {
  "LUCIDLINK_BEARER_TOKEN": "your_token_here"
}
```

## Troubleshooting

### Docker Issues

**Problem**: "Docker Desktop is not installed"
- **Solution**: Install Docker Desktop from docker.com

**Problem**: "Docker is not running"
- **Solution**: The MCP server will try to start it automatically. If it fails, start Docker Desktop manually.

**Problem**: "Container won't start"
- **Solution**: Check if the image is loaded: `docker images | grep lucidlink`

### API Connection Issues

**Problem**: "Authentication failed"
- **Solution**: Verify your bearer token is correct and not expired

**Problem**: "Cannot connect to API"
- **Solution**: Ensure the container is running on port 3003: `docker ps`

**Problem**: "Rate limit exceeded"
- **Solution**: Wait 60 seconds for the rate limit to reset

### Claude Desktop Issues

**Problem**: "MCP server not available in Claude"
- **Solution**: Restart Claude Desktop after updating the config file

**Problem**: "Python errors when running commands"
- **Solution**: Ensure all dependencies are installed: `pip3 install -r requirements.txt`

### Viewing Logs

**Container logs**:
```bash
docker logs lucidlink-api
```

**MCP server logs**:
Check Claude Desktop's developer console or run the server manually:
```bash
cd ~/lucidlink-mcp
uv run python lucidlink_mcp_server.py
```

## Security Best Practices

1. **Never share your bearer token**
2. **Use macOS Keychain** for token storage
3. **Regularly rotate** your Service Account tokens
4. **Monitor API usage** through LucidLink Admin Portal
5. **Restrict permissions** to minimum necessary

## Advanced Usage

### Custom Storage Providers

```python
# Modify the server to support additional providers
class StorageProvider(Enum):
    AWS = "AWS"
    AZURE = "Azure"
    GCP = "GCP"
    WASABI = "Wasabi"
    CUSTOM = "YourProvider"
```

### Bulk Operations

You can extend the server to handle bulk operations:

```python
# Example: Bulk member addition
def add_members_bulk(self, emails: List[str]) -> List[ApiResponse]:
    responses = []
    for email in emails:
        responses.append(self.add_member(email))
    return responses
```

### Webhook Integration

Add webhook support for real-time notifications:

```python
def notify_webhook(self, event: str, data: Dict):
    webhook_url = os.getenv("WEBHOOK_URL")
    if webhook_url:
        requests.post(webhook_url, json={
            "event": event,
            "data": data,
            "timestamp": time.time()
        })
```

## Support

- **LucidLink Support**: [support.lucidlink.com](https://support.lucidlink.com)
- **API Documentation**: See the API Key Functionalities guide
- **Docker Help**: [docs.docker.com](https://docs.docker.com)

## License

This MCP server is provided as-is for LucidLink customers to interact with their Admin API.

## Contributing

To contribute improvements:

1. Test thoroughly with your LucidLink environment
2. Follow Python PEP 8 style guidelines
3. Add error handling for edge cases
4. Update documentation for new features

## Version History

### v1.0.0 (2024)
- Initial release with full API support
- Docker automation
- Natural language processing
- Secure token management

---

**Built for LucidLink Business and Enterprise customers** | **Powered by Claude MCP**
