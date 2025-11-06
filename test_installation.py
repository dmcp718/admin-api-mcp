#!/usr/bin/env python3
"""
LucidLink MCP Server Test Script
Tests the installation and basic functionality
"""

import sys
import json
import subprocess
from pathlib import Path

def print_test(name, passed):
    """Print test result with emoji"""
    if passed:
        print(f"✅ {name}")
    else:
        print(f"❌ {name}")
    return passed

def test_python_version():
    """Check Python version"""
    version = sys.version_info
    return print_test(
        f"Python version ({version.major}.{version.minor}.{version.micro})",
        version.major >= 3 and version.minor >= 8
    )

def test_imports():
    """Test required imports"""
    try:
        import docker
        import requests
        import keyring
        import mcp
        return print_test("Required packages installed", True)
    except ImportError as e:
        print_test(f"Missing package: {e}", False)
        return False

def test_docker():
    """Test Docker installation and status"""
    try:
        import docker
        client = docker.from_env()
        client.ping()
        return print_test("Docker is running", True)
    except:
        return print_test("Docker is not running", False)

def test_keychain():
    """Test keychain access"""
    try:
        import keyring
        # Try to read (may return None if not set)
        token = keyring.get_password("lucidlink-mcp", "bearer_token")
        if token:
            return print_test(f"Bearer token found in keychain ({len(token)} chars)", True)
        else:
            return print_test("Bearer token not found in keychain (optional)", True)
    except Exception as e:
        return print_test(f"Keychain access error: {e}", False)

def test_claude_config():
    """Test Claude Desktop configuration"""
    config_path = Path.home() / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
    
    if config_path.exists():
        try:
            with open(config_path) as f:
                config = json.load(f)
            
            if "mcpServers" in config and "lucidlink" in config["mcpServers"]:
                return print_test("Claude Desktop configured", True)
            else:
                return print_test("LucidLink MCP not found in Claude config", False)
        except Exception as e:
            return print_test(f"Error reading Claude config: {e}", False)
    else:
        return print_test("Claude Desktop config not found", False)

def test_server_file():
    """Test server file exists"""
    server_path = Path.home() / "lucidlink-mcp" / "lucidlink_mcp_server.py"
    
    if server_path.exists():
        return print_test(f"Server file found at {server_path}", True)
    else:
        return print_test("Server file not found", False)

def test_api_container():
    """Test if API container image exists"""
    try:
        import docker
        client = docker.from_env()
        images = client.images.list()
        
        for image in images:
            if any("lucidlink" in tag for tag in (image.tags or [])):
                return print_test("LucidLink container image found", True)
        
        return print_test("LucidLink container image not found (load with: docker load -i image.tar)", True)
    except:
        return print_test("Cannot check container images", False)

def main():
    """Run all tests"""
    print("🔍 LucidLink MCP Server Installation Test")
    print("=" * 50)
    print()
    
    tests = [
        test_python_version,
        test_imports,
        test_docker,
        test_keychain,
        test_claude_config,
        test_server_file,
        test_api_container
    ]
    
    passed = sum(test() for test in tests)
    total = len(tests)
    
    print()
    print("=" * 50)
    print(f"📊 Results: {passed}/{total} tests passed")
    print()
    
    if passed == total:
        print("🎉 All tests passed! Your installation is ready.")
        print()
        print("Next steps:")
        print("1. Restart Claude Desktop")
        print("2. Try saying 'Check Docker status' in Claude")
    elif passed >= total - 2:
        print("⚠️  Installation mostly complete. Some optional components may be missing.")
        print()
        print("Check the failed tests above for details.")
    else:
        print("❌ Installation incomplete. Please review the errors above.")
        print()
        print("Run the install.sh script or follow the manual installation guide.")
    
    return 0 if passed == total else 1

if __name__ == "__main__":
    sys.exit(main())
