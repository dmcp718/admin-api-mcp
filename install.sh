#!/bin/bash
# LucidLink MCP Server Installation Script for macOS
# This script sets up the LucidLink MCP server for Claude Desktop

set -e

echo "🚀 LucidLink MCP Server Installation"
echo "===================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    print_error "This script is designed for macOS only"
    exit 1
fi

# Check Claude Desktop installation
echo "1️⃣  Checking Claude Desktop..."
if [ -d "/Applications/Claude.app" ]; then
    print_success "Claude Desktop is installed"
else
    print_error "Claude Desktop is not installed"
    echo ""
    echo "   This MCP server requires Claude Desktop to be installed first."
    echo "   Please download and install Claude Desktop from:"
    echo "   https://claude.ai/download"
    echo ""
    echo "   After installing Claude Desktop, run this script again."
    exit 1
fi

# Check uv installation
echo ""
echo "2️⃣  Checking uv installation..."
if command -v uv &> /dev/null; then
    UV_VERSION=$(uv --version | cut -d' ' -f2)
    UV_PATH=$(which uv)
    print_success "uv $UV_VERSION found at $UV_PATH"
else
    print_warning "uv not found. Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh

    # Add uv to PATH for this session
    export PATH="$HOME/.local/bin:$PATH"

    # Check if uv is now available (either in PATH or at default location)
    if command -v uv &> /dev/null; then
        UV_PATH=$(which uv)
        UV_VERSION=$(uv --version | cut -d' ' -f2)
        print_success "uv $UV_VERSION installed successfully at $UV_PATH"
    elif [ -f "$HOME/.local/bin/uv" ]; then
        UV_PATH="$HOME/.local/bin/uv"
        UV_VERSION=$($UV_PATH --version | cut -d' ' -f2)
        print_success "uv $UV_VERSION installed successfully at $UV_PATH"
    else
        print_error "Failed to install uv. Please install manually from https://docs.astral.sh/uv/"
        exit 1
    fi

    # Provide instructions to add to PATH permanently
    echo ""
    print_warning "To use uv in future terminal sessions, add it to your PATH:"
    echo "   For bash/zsh: echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
    echo "   For fish: echo 'set -gx PATH \$HOME/.local/bin \$PATH' >> ~/.config/fish/config.fish"
    echo "   Then restart your terminal or run: source ~/.zshrc"
    echo ""
fi

# Check Docker Desktop installation
echo ""
echo "3️⃣  Checking Docker Desktop..."
if [ -d "/Applications/Docker.app" ]; then
    print_success "Docker Desktop is installed"
    
    # Check if Docker is running
    if docker info &> /dev/null; then
        print_success "Docker is running"
    else
        print_warning "Docker is not running. Starting Docker Desktop..."
        open -a Docker
        echo "   Waiting for Docker to start (this may take a minute)..."
        
        # Wait for Docker to start
        COUNTER=0
        while ! docker info &> /dev/null; do
            sleep 1
            COUNTER=$((COUNTER + 1))
            if [ $COUNTER -gt 60 ]; then
                print_error "Docker failed to start. Please start it manually."
                exit 1
            fi
        done
        print_success "Docker started successfully"
    fi
else
    print_error "Docker Desktop is not installed"
    echo ""
    echo "   Would you like to download Docker Desktop? (y/n)"
    read -r response
    if [[ "$response" == "y" ]]; then
        echo "   Opening Docker Desktop download page..."
        open "https://www.docker.com/products/docker-desktop"
        echo ""
        echo "   Please install Docker Desktop and run this script again."
        exit 0
    else
        echo "   Please install Docker Desktop from https://docker.com/products/docker-desktop"
        exit 1
    fi
fi

# Create installation directory
echo ""
echo "4️⃣  Creating installation directory..."
INSTALL_DIR="$HOME/lucidlink-mcp"
if [ -d "$INSTALL_DIR" ]; then
    print_warning "Installation directory already exists: $INSTALL_DIR"
    echo "   Would you like to reinstall? (y/n)"
    read -r response
    if [[ "$response" != "y" ]]; then
        echo "   Installation cancelled."
        exit 0
    fi
    rm -rf "$INSTALL_DIR"
fi

mkdir -p "$INSTALL_DIR"
print_success "Created directory: $INSTALL_DIR"

# Copy server files
echo ""
echo "5️⃣  Installing MCP server..."
cp lucidlink_mcp_server.py "$INSTALL_DIR/"
cp pyproject.toml "$INSTALL_DIR/"
print_success "Copied server files"

# Note: No need to install dependencies manually
# uv run will automatically create a virtual environment and install dependencies
# when the script is first executed by Claude Desktop
echo ""
echo "6️⃣  Dependencies configured..."
print_success "Dependencies will be installed automatically on first run"

# Get LucidLink Bearer Token
echo ""
echo "7️⃣  Authentication Setup"
echo "   ========================"

# Check if token already exists in keychain
EXISTING_TOKEN=$(security find-generic-password -a "lucidlink-mcp" -s "lucidlink-mcp" -w 2>/dev/null)

if [ -n "$EXISTING_TOKEN" ]; then
    print_success "Bearer token already configured in macOS Keychain"
    echo "   Would you like to update it? (y/n)"
    read -r response
    if [[ "$response" != "y" ]]; then
        echo "   Keeping existing token."
    else
        echo ""
        echo "   Enter your new bearer token:"
        read -s BEARER_TOKEN
        echo ""

        if [ -n "$BEARER_TOKEN" ]; then
            security delete-generic-password -a "lucidlink-mcp" -s "lucidlink-mcp" 2>/dev/null
            security add-generic-password -a "lucidlink-mcp" -s "lucidlink-mcp" -w "$BEARER_TOKEN"
            print_success "Bearer token updated in macOS Keychain"
        else
            print_warning "No token entered. Keeping existing token."
        fi
    fi
else
    echo "   You need a LucidLink Service Account bearer token."
    echo "   This is available for Business and Enterprise customers."
    echo ""
    echo "   To get your token:"
    echo "   1. Log into LucidLink Admin Portal"
    echo "   2. Navigate to Service Accounts"
    echo "   3. Create or select a Service Account"
    echo "   4. Generate a secret key (bearer token)"
    echo ""
    echo "   Enter your bearer token (or press Enter to skip and set later):"
    read -s BEARER_TOKEN
    echo ""

    if [ -n "$BEARER_TOKEN" ]; then
        security add-generic-password -a "lucidlink-mcp" -s "lucidlink-mcp" -w "$BEARER_TOKEN" 2>/dev/null
        print_success "Bearer token stored securely in macOS Keychain"
    else
        print_warning "Bearer token not provided. You'll need to set it later."
    fi
fi

# Configure Claude Desktop
echo ""
echo "8️⃣  Configuring Claude Desktop..."
CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
CLAUDE_CONFIG_FILE="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"

mkdir -p "$CLAUDE_CONFIG_DIR"

# Check if config exists
if [ -f "$CLAUDE_CONFIG_FILE" ]; then
    print_warning "Claude Desktop config already exists"
    echo "   Would you like to update it? (y/n)"
    read -r response
    if [[ "$response" == "y" ]]; then
        # Backup existing config
        cp "$CLAUDE_CONFIG_FILE" "$CLAUDE_CONFIG_FILE.backup"
        print_success "Backed up existing config to $CLAUDE_CONFIG_FILE.backup"
        
        # Create new config with full uv path and directory flag
        cat > "$CLAUDE_CONFIG_FILE" << EOF
{
  "mcpServers": {
    "lucidlink-admin-api": {
      "command": "$UV_PATH",
      "args": [
        "--directory",
        "$INSTALL_DIR",
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
EOF
        print_success "Updated Claude Desktop configuration"
    fi
else
    # Create new config with full uv path and directory flag
    cat > "$CLAUDE_CONFIG_FILE" << EOF
{
  "mcpServers": {
    "lucidlink-admin-api": {
      "command": "$UV_PATH",
      "args": [
        "--directory",
        "$INSTALL_DIR",
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
EOF
    print_success "Created Claude Desktop configuration"
fi

# Note about container image
echo ""
echo "9️⃣  Container Image Setup"
echo "   ========================"
echo "   The LucidLink API container image (lucidlink/lucidlink-api) will be"
echo "   automatically pulled from Docker Hub when you first start the container."
echo "   "
echo "   No manual download required - it just works!"
echo ""

# Test the installation
echo ""
echo "🔟 Testing installation..."
cd "$INSTALL_DIR"
echo "   Installing and verifying dependencies (this may take a moment on first run)..."
uv run --quiet python -c "import mcp, docker, requests, keyring; print('✅ All dependencies verified')" || {
    print_error "Dependency check failed"
    exit 1
}

# Success message
echo ""
echo "=========================================="
print_success "Installation completed successfully! 🎉"
echo "=========================================="
echo ""
echo "📋 Next Steps:"
echo "   1. Restart Claude Desktop to load the MCP server"
echo ""
echo "   2. In Claude Desktop, start chatting:"
echo "      • 'Check Docker status'"
echo "      • 'Initialize API' (you'll be prompted for your bearer token)"
echo "      • 'Create a filespace called test-project'"
echo "      • 'List all filespaces'"
echo ""
echo "   Note: The container image will be automatically pulled from Docker Hub"
echo "         when needed. No manual download required!"
echo ""
echo "📁 Installation location: $INSTALL_DIR"
echo "📝 Configuration file: $CLAUDE_CONFIG_FILE"
echo ""
echo "🔐 Security Note:"
echo "   Your bearer token is stored securely in macOS Keychain."
echo "   To update it later, run:"
echo "   security add-generic-password -a 'lucidlink-mcp' -s 'lucidlink-mcp' -w 'YOUR_NEW_TOKEN' -U"
echo ""
echo "📚 For help, check the documentation or run 'View help' in Claude Desktop"
echo ""
