# API Key Functionalities & Common Automation Scenarios

This guide details the available RESTful endpoints for managing your LucidLink workspace, structured to show the core functionality and practical application (common use case) for each call.

To ensure secure, programmatic access, all API calls must be authorized using a secret key generated from a dedicated Service Account. This feature is available to customers on any Business or Enterprise plan.

## Common Automation Scenarios

| Automation Scenario | API Endpoints Used | Value for Customers |
|---|---|---|
| Onboarding/Offboarding | POST /members, POST /groups, PUT /groups/members, DELETE /members | Seamless integration with existing Identity Management (IDM) or HR systems. When a new employee is added, a script automatically creates their account, adds them to the correct groups (e.g., 'VFX_Team'), and grants baseline filespace access. Offboarding automatically revokes access. |
| Filespace Provisioning | POST /filespaces, POST /permissions | Standardized and rapid deployment of project filespaces. Automatically spin up a new project filespace, assign a default set of users/groups, and apply required permissions with a single script. |
| Regular Auditing & Reporting | GET /filespaces, GET /members, GET /groups/{groupId}/members, GET /filespaces/{filespaceId}/permissions | Maintain compliance and security. Regularly check and report on who has access to which filespaces. Identify stale accounts or groups for cleanup. |
| Mass Group/Member Updates | PATCH /groups/{groupId}, PUT /groups/members | Efficient bulk administration. Quickly rename a group, or add hundreds of users to a new project group with a single API call, instead of manual clicking. |

## Endpoints: Workspace & Filespace Management

| HTTP Method | Endpoint | Functionality & Common Use Case |
|---|---|---|
| GET | /api/v1/filespaces | Lists all filespaces in the workspace. Use for inventory and auditing of all active project spaces. |
| POST | /api/v1/filespaces | Creates a new filespace. Use for automated provisioning of a new project space via script. |
| GET | /api/v1/filespaces/{filespaceId} | Retrieves detailed information for a single filespace. Use for checking the status or specific details of a project. |
| PATCH | /api/v1/filespaces/{filespaceId} | Updates the name of a filespace. Use for correcting a naming convention error. |
| DELETE | /api/v1/filespaces/{filespaceId} | Deletes a filespace. Use with caution for decommissioning an old project space. |

### Example: Creating a New Project Filespace

```bash
curl -i -X POST 'http://localhost:3003/api/v1/filespaces' \
  -H 'Authorization: Bearer <BEARER_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "project-alpha",
    "region": "us-east-1",
    "storageProvider": "AWS",
    "storageOwner": "lucidlink"
  }'
```

## Endpoints: Members & Groups Management

### Members Endpoints

| HTTP Method | Endpoint | Functionality & Common Use Case |
|---|---|---|
| POST | /api/v1/members | Adds a new member (user) to the workspace. Use for automated user onboarding via an integration script. |
| GET | /api/v1/members | Lists all members in the workspace. Use for auditing all current users. |
| GET | /api/v1/members/{memberId} | Retrieves detailed information for a single member. Use for auditing a specific user. |
| PATCH | /api/v1/members/{memberId} | Updates a member's role (e.g., from 'User' to 'Admin'). Use for elevating a user's privileges. |
| DELETE | /api/v1/members/{memberId} | Removes a member from the workspace. Use for automated user offboarding/access revocation. |
| GET | /api/v1/members/{memberId}/groups | Lists all groups a specific member belongs to. Use for troubleshooting a member's access permissions. |

### Groups Endpoints

| HTTP Method | Endpoint | Functionality & Common Use Case |
|---|---|---|
| POST | /api/v1/groups | Creates a new group in the workspace. Use for provisioning a new team or department (e.g., "Video_Editors") that needs a specific set of resource access. |
| GET | /api/v1/groups | Gets a list of all workspace groups. Use for displaying all available groups for management or reporting. |
| GET | /api/v1/groups/{groupId} | Gets a workspace group by principalId. Use for retrieving specific details of a known group. |
| PATCH | /api/v1/groups/{groupId} | Updates group properties. Use for renaming a group (e.g., from "Marketing" to "Creative_Team"). |
| DELETE | /api/v1/groups/{groupId} | Removes a group from the workspace. Use for decommissioning a project or team. |
| GET | /api/v1/groups/{groupId}/members | Gets a list of members in the given group. Use for auditing which users are currently part of a specific group. |
| PUT | /api/v1/groups/members | Bulk adds members to groups. Use for onboarding a large number of new employees by assigning multiple users to various groups simultaneously. |
| PUT | /api/v1/groups/{groupId}/members/{memberId} | Adds a single member to a group. Use for adding a single new user to an existing group after they've been provisioned. |
| DELETE | /api/v1/groups/{groupId}/members/{memberId} | Removes a member from a group. Use for offboarding a user or removing a user's access. |

### Example: Bulk Onboarding and Group Assignment

```bash
# Add Member to Workspace
curl -i -X POST 'http://localhost:3003/api/v1/members' \
  -H 'Authorization: Bearer <BEARER_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "johnDoe@email.com"
  }'
# Response will include the new memberId (principalId)

# Add Member to 'Marketing' Group (batch endpoint)
curl -i -X PUT 'http://localhost:3003/api/v1/groups/members' \
  -H 'Authorization: Bearer <BEARER_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "memberships": [
      {
        "groupId": "<GROUP_ID>",
        "memberId": "<MEMBER_ID>"
      }
    ]
  }'
```

## Endpoints: Permissions

This is the control layer for specifying who (memberId or groupId) has what level of access to a specific Filespace.

| HTTP Method | Endpoint | Functionality & Common Use Case |
|---|---|---|
| POST | /api/v1/filespaces/{filespaceId}/permissions | Grants a new permission (e.g., Read/Write) for a principal (Member or Group) on a filespace. Use for setting initial access control after filespace creation. |
| GET | /api/v1/filespaces/{filespaceId}/permissions | Lists all granted permissions for a specific filespace. Use for auditing access for a specific project. |
| PATCH | /api/v1/filespaces/{filespaceId}/permissions/{permissionId} | Updates an existing permission (e.g., changing 'Read' to 'Read/Write'). Use for adjusting a team's level of access mid-project. |
| DELETE | /api/v1/filespaces/{filespaceId}/permissions/{permissionId} | Revokes an existing permission. Use for removing a user's or group's access to a filespace. |

### Example: Granting Access to a Group

```bash
curl -i -X POST 'http://localhost:3003/api/v1/filespaces/<FILESPACE_ID>/permissions' \
  -H 'Authorization: Bearer <BEARER_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "path": "/",
    "permissions": ["read"],
    "principalId": "<GROUP_ID>"
  }'
```

## System and Utility Endpoints

| HTTP Method | Endpoint | Functionality & Common Use Case |
|---|---|---|
| GET | /api/v1/health | Checks if the LucidAPI instance is responsive. Used by monitoring systems (e.g., Nagios, Zabbix) to confirm the API service is up and running. |
| GET | /api/v1/providers | Gets available storage providers in JSON format. Used to dynamically populate dropdown menus to ensure the user only selects valid storage combinations when creating a filespace. |

## Directory Management API

The Directory Management API elevates the functionality currently available within the LucidLink client application, translating it into a robust, programmatic interface for developers. This API is specifically designed to allow software engineers and system administrators to seamlessly integrate directory management operations into their custom applications, scripts, and workflows.

### Core Capabilities

| Capability | Description |
|---|---|
| Create Directory | Allows developers to programmatically create new directories at any specified path within the LucidLink filespace. Critical for automated provisioning and file structure setup. |
| Delete Directory | Provides the ability to permanently remove an existing directory. Designed to support automated cleanup and decommissioning of unused or temporary file structures. |
| List Directory Contents | Enables the retrieval of an itemized list of all files and subdirectories contained within a specified directory path. Vital for navigating the filespace, synchronization, and generating file manifests. |
| Resolve Path to ID | A utility function that accepts a human-readable file path (e.g., /projects/alpha/data) and efficiently resolves it to the system's unique internal identifier (ID). Essential for subsequent API calls that require an entry ID. |
| Get Entry Info by ID | Allows the retrieval of comprehensive metadata and status information for a specific directory or file, using its unique internal ID. Bypasses path resolution for maximum performance. |

### Directory Management Endpoints

| HTTP Method | Endpoint | Functionality & Common Use Case |
|---|---|---|
| POST | /api/v1/filespaces/{filespaceId}/entries | Create directory |
| GET | /api/v1/filespaces/{filespaceId}/entries/resolve | Returns entry information for a filesystem path within the filespace. |
| GET | /api/v1/filespaces/{filespaceId}/entries/{entryId}/children | Returns a paginated list of entries within the specified directory. |
| GET | /api/v1/filespaces/{filespaceId}/entries/{entryId} | Returns entry information for a filesystem entry ID within the filespace. |
| DELETE | /api/v1/filespaces/{filespaceId}/entries/{entryId} | Deletes a directory from the filespace. Directories must be empty to be deleted. |

The Directory Management API adheres to LucidLink's zero-knowledge policy — the endpoint will not be hosted or managed by LucidLink's infrastructure.
