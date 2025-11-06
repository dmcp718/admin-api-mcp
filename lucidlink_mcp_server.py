#!/usr/bin/env python3
"""
LucidLink MCP Server for Claude Desktop
Provides natural language interface to LucidLink Admin API Container
"""

import json
import time
import os
import sys
import re
import logging
import subprocess
import asyncio
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from enum import Enum

import docker
import requests
import keyring
from mcp.server import Server
from mcp.types import Tool, TextContent, Resource
from mcp.server.stdio import stdio_server

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
API_BASE_URL = "http://localhost:3003/api/v1"
CONTAINER_NAME = "lucidlink-api"
CONTAINER_IMAGE = "lucidlink/lucidlink-api:latest"
DOCKER_TIMEOUT = 60  # seconds
RATE_LIMIT_CALLS = 10
RATE_LIMIT_WINDOW = 60  # seconds

class StorageProvider(Enum):
    """Supported storage providers"""
    AWS = "AWS"
    AZURE = "Azure"
    GCP = "GCP"
    WASABI = "Wasabi"
    
class Region(Enum):
    """Common regions across providers"""
    US_EAST_1 = "us-east-1"
    US_WEST_2 = "us-west-2"
    EU_WEST_1 = "eu-west-1"
    AP_SOUTHEAST_1 = "ap-southeast-1"

class Permission(Enum):
    """Permission levels"""
    READ = "read"
    WRITE = "write"
    ADMIN = "admin"

@dataclass
class ApiResponse:
    """Standardized API response"""
    success: bool
    data: Optional[Dict] = None
    error: Optional[str] = None
    status_code: Optional[int] = None

class RateLimiter:
    """Simple rate limiter for API calls"""
    def __init__(self, max_calls: int = RATE_LIMIT_CALLS, window: int = RATE_LIMIT_WINDOW):
        self.max_calls = max_calls
        self.window = window
        self.calls = []
    
    def check_limit(self) -> bool:
        """Check if we're within rate limit"""
        now = time.time()
        # Remove old calls outside window
        self.calls = [t for t in self.calls if now - t < self.window]
        
        if len(self.calls) >= self.max_calls:
            return False
        
        self.calls.append(now)
        return True
    
    def time_until_reset(self) -> int:
        """Time until oldest call expires"""
        if not self.calls:
            return 0
        return max(0, int(self.window - (time.time() - self.calls[0])))

class DockerManager:
    """Manages Docker Desktop and LucidLink container"""
    
    def __init__(self):
        self.client = None
        
    def is_docker_installed(self) -> bool:
        """Check if Docker Desktop is installed on macOS"""
        return os.path.exists('/Applications/Docker.app')
    
    def is_docker_running(self) -> bool:
        """Check if Docker daemon is running"""
        try:
            self.client = docker.from_env()
            self.client.ping()
            return True
        except Exception as e:
            logger.debug(f"Docker not running: {e}")
            return False
    
    def start_docker(self) -> bool:
        """Start Docker Desktop on macOS"""
        if not self.is_docker_installed():
            return False
            
        if self.is_docker_running():
            return True
            
        try:
            logger.info("Starting Docker Desktop...")
            subprocess.run(['open', '-a', 'Docker'], check=True)
            
            # Wait for Docker daemon to be ready
            for i in range(DOCKER_TIMEOUT):
                if self.is_docker_running():
                    logger.info("Docker Desktop started successfully")
                    return True
                time.sleep(1)
            
            logger.error("Docker Desktop failed to start within timeout")
            return False
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to start Docker Desktop: {e}")
            return False
    
    def image_exists(self, image_name: str) -> bool:
        """Check if Docker image exists locally"""
        if not self.is_docker_running():
            if not self.start_docker():
                return False

        try:
            self.client.images.get(image_name)
            return True
        except docker.errors.ImageNotFound:
            return False
        except Exception as e:
            logger.error(f"Error checking for image: {e}")
            return False

    def pull_image(self, image_name: str) -> tuple[bool, str]:
        """Pull Docker image from Docker Hub"""
        if not self.is_docker_running():
            if not self.start_docker():
                return False, "Docker is not running and failed to start"

        try:
            logger.info(f"Pulling image {image_name} from Docker Hub...")
            self.client.images.pull(image_name)
            return True, f"Successfully pulled image: {image_name}"
        except docker.errors.APIError as e:
            logger.error(f"Failed to pull image: {e}")
            return False, f"Failed to pull image from Docker Hub: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error pulling image: {e}")
            return False, f"Unexpected error: {str(e)}"
    
    def ensure_container_running(self, image_name: str = CONTAINER_IMAGE,
                                container_name: str = CONTAINER_NAME) -> tuple[Optional[docker.models.containers.Container], Optional[str]]:
        """Ensure LucidLink API container is running

        Returns: (container, error_message)
        """
        if not self.is_docker_running():
            if not self.start_docker():
                return None, "Docker Desktop is not running and failed to start"

        try:
            # Check if container exists
            container = self.client.containers.get(container_name)

            if container.status != 'running':
                logger.info(f"Starting existing container {container_name}")
                container.start()
                time.sleep(2)  # Give container time to initialize

            return container, None

        except docker.errors.NotFound:
            # Container doesn't exist, check if image exists
            if not self.image_exists(image_name):
                # Try to pull the image automatically
                logger.info(f"Image {image_name} not found locally, attempting to pull from Docker Hub...")
                success, message = self.pull_image(image_name)
                if not success:
                    error_msg = (
                        f"Container image '{image_name}' not found locally and failed to pull from Docker Hub. "
                        f"Error: {message}"
                    )
                    return None, error_msg

            # Image exists (or was just pulled), create container
            logger.info(f"Creating new container {container_name}")

            try:
                container = self.client.containers.run(
                    image_name,
                    detach=True,
                    name=container_name,
                    ports={'3003/tcp': 3003},
                    restart_policy={"Name": "unless-stopped"}
                )
                time.sleep(3)  # Give container time to initialize
                return container, None

            except docker.errors.APIError as e:
                logger.error(f"Failed to create container: {e}")
                return None, f"Failed to create container: {str(e)}"
        except Exception as e:
            return None, f"Unexpected error: {str(e)}"
    
    def get_container_logs(self, lines: int = 50) -> str:
        """Get container logs"""
        try:
            container = self.client.containers.get(CONTAINER_NAME)
            logs = container.logs(tail=lines, decode=True)
            return logs
        except Exception as e:
            return f"Error getting logs: {e}"
    
    def stop_container(self) -> bool:
        """Stop the LucidLink container"""
        try:
            container = self.client.containers.get(CONTAINER_NAME)
            container.stop()
            return True
        except Exception:
            return False

class LucidLinkAPIClient:
    """Client for LucidLink Admin API"""
    
    def __init__(self, bearer_token: str, base_url: str = API_BASE_URL):
        self.base_url = base_url
        self.bearer_token = bearer_token
        self.headers = {
            "Authorization": f"Bearer {bearer_token}",
            "Content-Type": "application/json"
        }
        self.rate_limiter = RateLimiter()
    
    def _make_request(self, method: str, endpoint: str, 
                     data: Optional[Dict] = None) -> ApiResponse:
        """Make HTTP request to API with error handling"""
        
        # Check rate limit
        if not self.rate_limiter.check_limit():
            wait_time = self.rate_limiter.time_until_reset()
            return ApiResponse(
                success=False,
                error=f"Rate limit exceeded. Please wait {wait_time} seconds."
            )
        
        url = f"{self.base_url}{endpoint}"
        
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self.headers,
                json=data,
                timeout=30
            )
            
            if response.status_code in [200, 201, 204]:
                try:
                    response_data = response.json() if response.text else {}
                except json.JSONDecodeError:
                    response_data = {}
                    
                return ApiResponse(
                    success=True,
                    data=response_data,
                    status_code=response.status_code
                )
            else:
                error_msg = self._parse_error_response(response)
                return ApiResponse(
                    success=False,
                    error=error_msg,
                    status_code=response.status_code
                )
                
        except requests.exceptions.ConnectionError:
            return ApiResponse(
                success=False,
                error="Cannot connect to API. Please ensure Docker container is running."
            )
        except requests.exceptions.Timeout:
            return ApiResponse(
                success=False,
                error="API request timed out."
            )
        except Exception as e:
            return ApiResponse(
                success=False,
                error=f"Unexpected error: {str(e)}"
            )
    
    def _parse_error_response(self, response) -> str:
        """Parse error message from API response"""
        try:
            error_data = response.json()
            if 'message' in error_data:
                return error_data['message']
            elif 'error' in error_data:
                return error_data['error']
        except:
            pass
        
        # Status code specific messages
        status_messages = {
            400: "Invalid request parameters",
            401: "Authentication failed - check your Bearer token",
            403: "Permission denied",
            404: "Resource not found",
            409: "Resource already exists",
            422: "Request cannot be processed",
            500: "API server error"
        }
        
        return status_messages.get(
            response.status_code,
            f"API error (status {response.status_code})"
        )
    
    # Filespace Management
    def create_filespace(self, name: str, region: str = "us-east-1",
                        storage_provider: str = "AWS", 
                        storage_owner: str = "lucidlink") -> ApiResponse:
        """Create a new filespace"""
        data = {
            "name": name,
            "region": region,
            "storageProvider": storage_provider,
            "storageOwner": storage_owner
        }
        return self._make_request("POST", "/filespaces", data)
    
    def list_filespaces(self) -> ApiResponse:
        """List all filespaces"""
        return self._make_request("GET", "/filespaces")
    
    def get_filespace(self, filespace_id: str) -> ApiResponse:
        """Get specific filespace details"""
        return self._make_request("GET", f"/filespaces/{filespace_id}")
    
    def delete_filespace(self, filespace_id: str) -> ApiResponse:
        """Delete a filespace"""
        return self._make_request("DELETE", f"/filespaces/{filespace_id}")
    
    # Member Management
    def add_member(self, email: str) -> ApiResponse:
        """Add a new member to workspace"""
        data = {"email": email}
        return self._make_request("POST", "/members", data)
    
    def list_members(self) -> ApiResponse:
        """List all workspace members"""
        return self._make_request("GET", "/members")
    
    def get_member(self, member_id: str) -> ApiResponse:
        """Get specific member details"""
        return self._make_request("GET", f"/members/{member_id}")
    
    def remove_member(self, member_id: str) -> ApiResponse:
        """Remove member from workspace"""
        return self._make_request("DELETE", f"/members/{member_id}")
    
    # Group Management
    def create_group(self, name: str, description: str = "") -> ApiResponse:
        """Create a new group"""
        data = {
            "name": name,
            "description": description
        }
        return self._make_request("POST", "/groups", data)
    
    def list_groups(self) -> ApiResponse:
        """List all groups"""
        return self._make_request("GET", "/groups")
    
    def add_member_to_group(self, group_id: str, member_id: str) -> ApiResponse:
        """Add member to group"""
        data = {
            "memberships": [
                {
                    "groupId": group_id,
                    "memberId": member_id
                }
            ]
        }
        return self._make_request("PUT", "/groups/members", data)
    
    def remove_member_from_group(self, group_id: str, member_id: str) -> ApiResponse:
        """Remove member from group"""
        return self._make_request("DELETE", f"/groups/{group_id}/members/{member_id}")
    
    # Permission Management
    def grant_permission(self, filespace_id: str, principal_id: str,
                        path: str = "/", permissions: List[str] = None) -> ApiResponse:
        """Grant permissions to a member or group on a filespace"""
        if permissions is None:
            permissions = ["read"]
        
        data = {
            "path": path,
            "permissions": permissions,
            "principalId": principal_id
        }
        return self._make_request("POST", f"/filespaces/{filespace_id}/permissions", data)
    
    def list_permissions(self, filespace_id: str) -> ApiResponse:
        """List all permissions for a filespace"""
        return self._make_request("GET", f"/filespaces/{filespace_id}/permissions")
    
    def revoke_permission(self, filespace_id: str, permission_id: str) -> ApiResponse:
        """Revoke a specific permission"""
        return self._make_request("DELETE", f"/filespaces/{filespace_id}/permissions/{permission_id}")
    
    # Service Management
    def get_service_health(self) -> ApiResponse:
        """Check API service health"""
        return self._make_request("GET", "/health")

    def list_providers(self) -> ApiResponse:
        """List all available storage providers"""
        return self._make_request("GET", "/providers")

class InputValidator:
    """Validates and sanitizes user inputs"""
    
    @staticmethod
    def validate_filespace_name(name: str) -> tuple[bool, str]:
        """Validate filespace name according to LucidLink rules"""
        if not name:
            return False, "Filespace name cannot be empty"
        
        # LucidLink naming rules
        pattern = r'^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$'
        if not re.match(pattern, name):
            return False, "Filespace names can only contain letters, numbers, hyphens, and underscores (cannot start/end with special characters)"
        
        if len(name) < 3 or len(name) > 63:
            return False, "Filespace names must be 3-63 characters long"
        
        return True, name
    
    @staticmethod
    def validate_email(email: str) -> tuple[bool, str]:
        """Validate email address"""
        if not email:
            return False, "Email cannot be empty"
        
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(pattern, email):
            return False, "Invalid email address format"
        
        return True, email
    
    @staticmethod
    def validate_group_name(name: str) -> tuple[bool, str]:
        """Validate group name"""
        if not name:
            return False, "Group name cannot be empty"
        
        if len(name) < 1 or len(name) > 255:
            return False, "Group names must be 1-255 characters long"
        
        # Remove any potentially harmful characters
        clean_name = re.sub(r'[<>"/\\|?*]', '', name)
        
        return True, clean_name

# Initialize MCP Server
server = Server("lucidlink-admin-api")

# Global instances
docker_mgr = DockerManager()
api_client: Optional[LucidLinkAPIClient] = None
validator = InputValidator()

def get_bearer_token() -> Optional[str]:
    """Get bearer token from environment or keychain"""
    # Try environment variable first
    token = os.getenv("LUCIDLINK_BEARER_TOKEN")
    if token:
        return token
    
    # Try macOS keychain
    try:
        token = keyring.get_password("lucidlink-mcp", "bearer_token")
        if token:
            return token
    except Exception as e:
        logger.warning(f"Could not access keychain: {e}")
    
    return None

def format_success_message(operation: str, details: Dict) -> str:
    """Format success message for user"""
    message = f"✅ {operation} completed successfully!\n\n"
    
    if details:
        message += "📋 Details:\n"
        message += json.dumps(details, indent=2, default=str)
    
    return message

def format_error_message(operation: str, error: str) -> str:
    """Format error message for user"""
    user_friendly_errors = {
        "401": "Your authentication token is invalid or expired. Please update it in settings.",
        "404": "The requested resource was not found.",
        "409": "This resource already exists. Please choose a different name.",
        "ConnectionError": "Cannot connect to the API. Please ensure Docker Desktop is running.",
        "rate_limit": "Too many requests. Please wait a moment and try again."
    }
    
    for key, friendly_msg in user_friendly_errors.items():
        if key in str(error):
            error = friendly_msg
            break
    
    return f"❌ {operation} failed\n\n{error}\n\n💡 Tip: Check that Docker is running and your token is valid."

# MCP Server Tool Definitions
@server.list_tools()
async def list_tools():
    """List all available tools"""
    return [
        # Docker Management
        Tool(
            name="check_docker_status",
            description="Check if Docker Desktop is installed and running, and start it if needed",
            inputSchema={
                "type": "object",
                "properties": {},
            }
        ),
        Tool(
            name="start_api_container",
            description="Start the LucidLink API container",
            inputSchema={
                "type": "object",
                "properties": {},
            }
        ),
        Tool(
            name="stop_api_container",
            description="Stop the LucidLink API container",
            inputSchema={
                "type": "object",
                "properties": {},
            }
        ),
        Tool(
            name="view_container_logs",
            description="View recent logs from the API container",
            inputSchema={
                "type": "object",
                "properties": {
                    "lines": {
                        "type": "integer",
                        "description": "Number of log lines to retrieve (default: 50)",
                        "default": 50
                    }
                },
            }
        ),
        Tool(
            name="pull_container_image",
            description="Pull the LucidLink API container image from Docker Hub (lucidlink/lucidlink-api)",
            inputSchema={
                "type": "object",
                "properties": {},
            }
        ),
        Tool(
            name="check_container_image",
            description="Check if the LucidLink API container image is available locally",
            inputSchema={
                "type": "object",
                "properties": {},
            }
        ),

        # Filespace Management
        Tool(
            name="create_filespace",
            description="Create a new LucidLink filespace with specified name and configuration",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name for the new filespace (3-63 chars, alphanumeric with hyphens/underscores)"
                    },
                    "region": {
                        "type": "string",
                        "description": "Storage region (e.g., us-east-1, us-west-2, eu-west-1)",
                        "default": "us-east-1"
                    },
                    "storage_provider": {
                        "type": "string",
                        "description": "Storage provider (AWS, Azure, GCP, Wasabi)",
                        "default": "AWS"
                    }
                },
                "required": ["name"]
            }
        ),
        Tool(
            name="list_filespaces",
            description="List all filespaces in the workspace",
            inputSchema={
                "type": "object",
                "properties": {},
            }
        ),
        Tool(
            name="get_filespace_details",
            description="Get detailed information about a specific filespace",
            inputSchema={
                "type": "object",
                "properties": {
                    "filespace_id": {
                        "type": "string",
                        "description": "ID of the filespace"
                    }
                },
                "required": ["filespace_id"]
            }
        ),
        Tool(
            name="delete_filespace",
            description="Delete a filespace (use with caution - this is permanent)",
            inputSchema={
                "type": "object",
                "properties": {
                    "filespace_id": {
                        "type": "string",
                        "description": "ID of the filespace to delete"
                    },
                    "confirm": {
                        "type": "boolean",
                        "description": "Confirmation flag (must be true to proceed)",
                        "default": False
                    }
                },
                "required": ["filespace_id", "confirm"]
            }
        ),
        
        # Member Management
        Tool(
            name="add_member",
            description="Add a new member to the workspace by email address",
            inputSchema={
                "type": "object",
                "properties": {
                    "email": {
                        "type": "string",
                        "description": "Email address of the member to add"
                    }
                },
                "required": ["email"]
            }
        ),
        Tool(
            name="list_members",
            description="List all members in the workspace",
            inputSchema={
                "type": "object",
                "properties": {},
            }
        ),
        Tool(
            name="get_member_details",
            description="Get detailed information about a specific member",
            inputSchema={
                "type": "object",
                "properties": {
                    "member_id": {
                        "type": "string",
                        "description": "ID of the member"
                    }
                },
                "required": ["member_id"]
            }
        ),
        Tool(
            name="remove_member",
            description="Remove a member from the workspace",
            inputSchema={
                "type": "object",
                "properties": {
                    "member_id": {
                        "type": "string",
                        "description": "ID of the member to remove"
                    }
                },
                "required": ["member_id"]
            }
        ),

        # Group Management
        Tool(
            name="create_group",
            description="Create a new group for organizing members",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name for the new group"
                    },
                    "description": {
                        "type": "string",
                        "description": "Optional description of the group",
                        "default": ""
                    }
                },
                "required": ["name"]
            }
        ),
        Tool(
            name="list_groups",
            description="List all groups in the workspace",
            inputSchema={
                "type": "object",
                "properties": {},
            }
        ),
        Tool(
            name="add_member_to_group",
            description="Add a member to a group",
            inputSchema={
                "type": "object",
                "properties": {
                    "group_id": {
                        "type": "string",
                        "description": "ID of the group"
                    },
                    "member_id": {
                        "type": "string",
                        "description": "ID of the member to add"
                    }
                },
                "required": ["group_id", "member_id"]
            }
        ),
        Tool(
            name="remove_member_from_group",
            description="Remove a member from a group",
            inputSchema={
                "type": "object",
                "properties": {
                    "group_id": {
                        "type": "string",
                        "description": "ID of the group"
                    },
                    "member_id": {
                        "type": "string",
                        "description": "ID of the member to remove"
                    }
                },
                "required": ["group_id", "member_id"]
            }
        ),

        # Permission Management
        Tool(
            name="grant_permission",
            description="Grant permissions to a member or group on a filespace",
            inputSchema={
                "type": "object",
                "properties": {
                    "filespace_id": {
                        "type": "string",
                        "description": "ID of the filespace"
                    },
                    "principal_id": {
                        "type": "string",
                        "description": "ID of the member or group to grant permissions to"
                    },
                    "permissions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of permissions to grant (read, write, admin)",
                        "default": ["read"]
                    },
                    "path": {
                        "type": "string",
                        "description": "Path within filespace to grant access to",
                        "default": "/"
                    }
                },
                "required": ["filespace_id", "principal_id"]
            }
        ),
        Tool(
            name="list_permissions",
            description="List all permissions for a filespace",
            inputSchema={
                "type": "object",
                "properties": {
                    "filespace_id": {
                        "type": "string",
                        "description": "ID of the filespace"
                    }
                },
                "required": ["filespace_id"]
            }
        ),
        Tool(
            name="revoke_permission",
            description="Revoke/remove a permission from a filespace",
            inputSchema={
                "type": "object",
                "properties": {
                    "filespace_id": {
                        "type": "string",
                        "description": "ID of the filespace"
                    },
                    "permission_id": {
                        "type": "string",
                        "description": "ID of the permission to revoke"
                    }
                },
                "required": ["filespace_id", "permission_id"]
            }
        ),

        # Service Management
        Tool(
            name="check_api_health",
            description="Check if the API service is healthy and responding",
            inputSchema={
                "type": "object",
                "properties": {},
            }
        ),
        Tool(
            name="list_providers",
            description="List all available storage providers (AWS, Azure, GCP, Wasabi, etc.)",
            inputSchema={
                "type": "object",
                "properties": {},
            }
        ),
        Tool(
            name="initialize_api",
            description="Initialize the API client with authentication token",
            inputSchema={
                "type": "object",
                "properties": {
                    "token": {
                        "type": "string",
                        "description": "Bearer token for API authentication (optional, will use stored token if not provided)"
                    }
                },
            }
        ),
    ]

# Tool Implementation
@server.call_tool()
async def call_tool(name: str, arguments: dict):
    """Execute tool based on name and arguments"""
    global api_client
    
    try:
        # Docker Management Tools
        if name == "check_docker_status":
            installed = docker_mgr.is_docker_installed()
            running = docker_mgr.is_docker_running() if installed else False
            
            status = {
                "installed": installed,
                "running": running,
                "container_status": "unknown"
            }
            
            if not installed:
                status["message"] = "Docker Desktop is not installed. Please install from https://docker.com/products/docker-desktop"
            elif not running:
                if docker_mgr.start_docker():
                    status["running"] = True
                    status["message"] = "Docker Desktop started successfully"
                else:
                    status["message"] = "Failed to start Docker Desktop. Please start it manually."
            else:
                # Check container status
                container, error = docker_mgr.ensure_container_running()
                if container:
                    status["container_status"] = container.status
                    status["message"] = "Docker and API container are ready"
                else:
                    status["container_status"] = "not_ready"
                    status["message"] = error or "Docker is running but API container failed to start"
            
            return [TextContent(
                type="text",
                text=json.dumps(status, indent=2)
            )]
        
        elif name == "start_api_container":
            container, error = docker_mgr.ensure_container_running()
            if container:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "API Container Started",
                        {"container_id": container.short_id, "status": container.status}
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message(
                        "Start API Container",
                        error or "Failed to start container. Check Docker Desktop."
                    )
                )]

        elif name == "stop_api_container":
            success = docker_mgr.stop_container()
            if success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "API Container Stopped",
                        {"status": "Container stopped successfully"}
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message(
                        "Stop API Container",
                        "Failed to stop container. It may not be running or Docker Desktop may not be running."
                    )
                )]

        elif name == "view_container_logs":
            lines = arguments.get("lines", 50)
            logs = docker_mgr.get_container_logs(lines)
            return [TextContent(
                type="text",
                text=f"📜 Last {lines} lines of container logs:\n\n{logs}"
            )]

        elif name == "pull_container_image":
            success, message = docker_mgr.pull_image(CONTAINER_IMAGE)
            if success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "Container Image Pulled",
                        {
                            "image": CONTAINER_IMAGE,
                            "message": message,
                            "next_step": "You can now start the API container"
                        }
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Pull Container Image", message)
                )]

        elif name == "check_container_image":
            if docker_mgr.image_exists(CONTAINER_IMAGE):
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "Container Image Status",
                        {
                            "image": CONTAINER_IMAGE,
                            "status": "Available locally",
                            "message": "Container image is ready to use"
                        }
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=f"⚠️ Container image '{CONTAINER_IMAGE}' not found locally.\n\n"
                         f"The image will be automatically pulled from Docker Hub when you start the container.\n\n"
                         f"Or you can pull it now by saying: 'Pull the container image'"
                )]

        elif name == "initialize_api":
            token = arguments.get("token") or get_bearer_token()
            if not token:
                return [TextContent(
                    type="text",
                    text=format_error_message(
                        "Initialize API",
                        "No bearer token provided. Please set LUCIDLINK_BEARER_TOKEN environment variable or provide token."
                    )
                )]
            
            api_client = LucidLinkAPIClient(token)
            
            # Test the connection
            health = api_client.get_service_health()
            if health.success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "API Initialized",
                        {"status": "Connected", "endpoint": API_BASE_URL}
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message(
                        "Initialize API",
                        f"Failed to connect: {health.error}"
                    )
                )]
        
        # Ensure API client is initialized for remaining tools
        if not api_client:
            token = get_bearer_token()
            if not token:
                return [TextContent(
                    type="text",
                    text="⚠️ API not initialized. Please provide your bearer token first using the initialize_api tool."
                )]
            api_client = LucidLinkAPIClient(token)
        
        # Ensure Docker and container are running
        if not docker_mgr.is_docker_running():
            docker_mgr.start_docker()
        container, error = docker_mgr.ensure_container_running()
        if not container:
            return [TextContent(
                type="text",
                text=format_error_message(
                    "Container Setup",
                    error or "Failed to start API container. Please check Docker status."
                )
            )]

        # Filespace Management Tools
        if name == "create_filespace":
            # Validate name
            valid, clean_name = validator.validate_filespace_name(arguments["name"])
            if not valid:
                return [TextContent(
                    type="text",
                    text=format_error_message("Create Filespace", clean_name)
                )]
            
            response = api_client.create_filespace(
                name=clean_name,
                region=arguments.get("region", "us-east-1"),
                storage_provider=arguments.get("storage_provider", "AWS")
            )
            
            if response.success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        f"Created filespace '{clean_name}'",
                        response.data
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Create Filespace", response.error)
                )]
        
        elif name == "list_filespaces":
            response = api_client.list_filespaces()

            if response.success:
                # API returns {"data": [...]}
                data = response.data if response.data else {}
                filespaces = data.get('data', []) if isinstance(data, dict) else []
                if filespaces:
                    fs_list = "\n".join([
                        f"• {fs.get('name', 'Unknown')} (ID: {fs.get('id', 'N/A')}, Region: {fs.get('storage', {}).get('region', 'N/A')}, Status: {fs.get('status', 'N/A')})"
                        for fs in filespaces
                    ])
                    return [TextContent(
                        type="text",
                        text=f"📁 Found {len(filespaces)} filespace(s):\n\n{fs_list}"
                    )]
                else:
                    return [TextContent(
                        type="text",
                        text="📁 No filespaces found in this workspace."
                    )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("List Filespaces", response.error)
                )]
        
        elif name == "get_filespace_details":
            response = api_client.get_filespace(arguments["filespace_id"])
            
            if response.success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "Filespace Details",
                        response.data
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Get Filespace Details", response.error)
                )]
        
        elif name == "delete_filespace":
            if not arguments.get("confirm", False):
                return [TextContent(
                    type="text",
                    text="⚠️ Deletion not confirmed. Set confirm=true to proceed. This action is permanent!"
                )]
            
            response = api_client.delete_filespace(arguments["filespace_id"])
            
            if response.success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "Deleted Filespace",
                        {"filespace_id": arguments["filespace_id"]}
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Delete Filespace", response.error)
                )]
        
        # Member Management Tools
        elif name == "add_member":
            # Validate email
            valid, clean_email = validator.validate_email(arguments["email"])
            if not valid:
                return [TextContent(
                    type="text",
                    text=format_error_message("Add Member", clean_email)
                )]

            response = api_client.add_member(clean_email)

            if response.success:
                # Extract member details from API response
                data = response.data if response.data else {}
                member_data = data.get('data', {}) if isinstance(data, dict) else {}

                email = member_data.get('user', {}).get('email', clean_email)
                status = member_data.get('status', 'unknown')
                invite_link = member_data.get('pendingInvitationLinkSecret', '')

                # Build user-friendly message
                message = f"✅ Member Added Successfully!\n\n"
                message += f"📧 Email: {email}\n"
                message += f"📊 Status: {status}\n"

                if invite_link:
                    message += f"\n🔗 Invitation Link:\n{invite_link}\n\n"
                    message += "📋 Send this link to the new member to complete their registration."
                else:
                    message += f"\n📋 Details:\n{json.dumps(member_data, indent=2)}"

                return [TextContent(
                    type="text",
                    text=message
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Add Member", response.error)
                )]
        
        elif name == "list_members":
            response = api_client.list_members()

            if response.success:
                # API returns {"data": [...]}
                data = response.data if response.data else {}
                members = data.get('data', []) if isinstance(data, dict) else []
                if members:
                    member_list = "\n".join([
                        f"• {m.get('user', {}).get('email', 'Unknown')} - {m.get('status', 'unknown').upper()} (ID: {m.get('id', 'N/A')})"
                        for m in members
                    ])
                    return [TextContent(
                        type="text",
                        text=f"👥 Found {len(members)} member(s):\n\n{member_list}"
                    )]
                else:
                    return [TextContent(
                        type="text",
                        text="👥 No members found in this workspace."
                    )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("List Members", response.error)
                )]

        elif name == "get_member_details":
            response = api_client.get_member(arguments["member_id"])

            if response.success:
                data = response.data if response.data else {}
                member_data = data.get('data', {}) if isinstance(data, dict) else {}

                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "Member Details",
                        member_data
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Get Member Details", response.error)
                )]

        elif name == "remove_member":
            response = api_client.remove_member(arguments["member_id"])
            
            if response.success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "Removed Member",
                        {"member_id": arguments["member_id"]}
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Remove Member", response.error)
                )]
        
        # Group Management Tools
        elif name == "create_group":
            # Validate group name
            valid, clean_name = validator.validate_group_name(arguments["name"])
            if not valid:
                return [TextContent(
                    type="text",
                    text=format_error_message("Create Group", clean_name)
                )]
            
            response = api_client.create_group(
                name=clean_name,
                description=arguments.get("description", "")
            )
            
            if response.success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        f"Created group '{clean_name}'",
                        response.data
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Create Group", response.error)
                )]
        
        elif name == "list_groups":
            response = api_client.list_groups()

            if response.success:
                # API returns {"data": [...]}
                data = response.data if response.data else {}
                groups = data.get('data', []) if isinstance(data, dict) else []
                if groups:
                    group_list = "\n".join([
                        f"• {g.get('name', 'Unknown')} (ID: {g.get('id', 'N/A')})"
                        for g in groups
                    ])
                    return [TextContent(
                        type="text",
                        text=f"👥 Found {len(groups)} group(s):\n\n{group_list}"
                    )]
                else:
                    return [TextContent(
                        type="text",
                        text="👥 No groups found in this workspace."
                    )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("List Groups", response.error)
                )]
        
        elif name == "add_member_to_group":
            response = api_client.add_member_to_group(
                arguments["group_id"],
                arguments["member_id"]
            )
            
            if response.success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "Added Member to Group",
                        {
                            "group_id": arguments["group_id"],
                            "member_id": arguments["member_id"]
                        }
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Add Member to Group", response.error)
                )]

        elif name == "remove_member_from_group":
            response = api_client.remove_member_from_group(
                arguments["group_id"],
                arguments["member_id"]
            )

            if response.success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "Removed Member from Group",
                        {
                            "group_id": arguments["group_id"],
                            "member_id": arguments["member_id"]
                        }
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Remove Member from Group", response.error)
                )]

        # Permission Management Tools
        elif name == "grant_permission":
            response = api_client.grant_permission(
                filespace_id=arguments["filespace_id"],
                principal_id=arguments["principal_id"],
                path=arguments.get("path", "/"),
                permissions=arguments.get("permissions", ["read"])
            )
            
            if response.success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "Granted Permissions",
                        response.data
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Grant Permission", response.error)
                )]
        
        elif name == "list_permissions":
            response = api_client.list_permissions(arguments["filespace_id"])

            if response.success:
                # API returns {"data": [...]}
                data = response.data if response.data else {}
                perms = data.get('data', []) if isinstance(data, dict) else []
                if perms:
                    perm_list = "\n".join([
                        f"• {p.get('principalId', 'Unknown')} - {p.get('permissions', [])} on {p.get('path', '/')}"
                        for p in perms
                    ])
                    return [TextContent(
                        type="text",
                        text=f"🔐 Permissions for filespace:\n\n{perm_list}"
                    )]
                else:
                    return [TextContent(
                        type="text",
                        text="🔐 No permissions set for this filespace."
                    )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("List Permissions", response.error)
                )]

        elif name == "revoke_permission":
            response = api_client.revoke_permission(
                arguments["filespace_id"],
                arguments["permission_id"]
            )

            if response.success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "Revoked Permission",
                        {
                            "filespace_id": arguments["filespace_id"],
                            "permission_id": arguments["permission_id"]
                        }
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("Revoke Permission", response.error)
                )]

        # Service Management Tools
        elif name == "check_api_health":
            response = api_client.get_service_health()

            if response.success:
                return [TextContent(
                    type="text",
                    text=format_success_message(
                        "API Health Check",
                        {"status": "Healthy", "endpoint": API_BASE_URL}
                    )
                )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("API Health Check", response.error)
                )]

        elif name == "list_providers":
            response = api_client.list_providers()
            if response.success:
                data = response.data if response.data else {}
                providers = data.get('data', []) if isinstance(data, dict) else []
                if providers:
                    provider_list = "\n".join([
                        f"• {p.get('name', 'Unknown')} - {p.get('description', 'No description')}"
                        for p in providers
                    ])
                    return [TextContent(
                        type="text",
                        text=f"☁️ Available Storage Providers:\n\n{provider_list}"
                    )]
                else:
                    return [TextContent(
                        type="text",
                        text="☁️ No storage providers found."
                    )]
            else:
                return [TextContent(
                    type="text",
                    text=format_error_message("List Providers", response.error)
                )]

        else:
            return [TextContent(
                type="text",
                text=f"❌ Unknown tool: {name}"
            )]
    
    except Exception as e:
        logger.error(f"Tool execution error: {e}", exc_info=True)
        return [TextContent(
            type="text",
            text=f"❌ Unexpected error: {str(e)}\n\nPlease check the logs for more details."
        )]

# Resources (optional - provide helpful information)
@server.list_resources()
async def list_resources():
    """List available resources"""
    return [
        Resource(
            uri="lucidlink://help",
            name="LucidLink API Help",
            mimeType="text/plain",
            description="Help documentation for using the LucidLink MCP server"
        )
    ]

@server.read_resource()
async def read_resource(uri: str):
    """Read resource content"""
    if uri == "lucidlink://help":
        help_text = """
LucidLink MCP Server - Help Guide
=================================

This MCP server provides natural language access to the LucidLink Admin API.

PREREQUISITES:
1. Business or Enterprise LucidLink plan
2. Service Account with API access
3. Bearer token from Service Account
4. Docker Desktop installed

GETTING STARTED:
1. Say "Initialize API" to set up authentication
2. Say "Check Docker status" to ensure Docker is running
3. Start using natural language commands!

EXAMPLE COMMANDS:
- "Create a new filespace called project-alpha"
- "List all my filespaces"
- "Add john@example.com to the workspace"
- "Create a group called Marketing"
- "Grant read access to the Marketing group on project-alpha"

SECURITY:
- Bearer tokens are stored securely in macOS Keychain
- All inputs are validated before API calls
- Rate limiting prevents accidental abuse

TROUBLESHOOTING:
- If API calls fail, check Docker is running
- Verify your bearer token is valid
- Check container logs for detailed errors

For more help, visit: https://support.lucidlink.com
"""
        return [TextContent(type="text", text=help_text)]
    
    return []

# Main entry point
async def main():
    """Main entry point for the MCP server"""
    # Check for bearer token
    token = get_bearer_token()
    if not token:
        logger.warning("No bearer token found. User will need to provide one.")

    # Start the server
    logger.info("Starting LucidLink MCP Server...")
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options()
        )

if __name__ == "__main__":
    asyncio.run(main())
