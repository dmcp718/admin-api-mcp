# Getting Started with Service Accounts: API Authentication

The LucidLink API is designed for secure, automated, and programmatic access to your administrative functions. Most API interactions must be authenticated using credentials tied to a dedicated Service Account.

## What are Service Accounts?

Service Accounts are special, non-user accounts created specifically to enable secure, programmatic API access to the LucidLink platform. They serve to decouple API interactions from individual user accounts, offering a dedicated and manageable mechanism for external applications and scripts to interact with your services.

## How to Add Service Accounts

- **Where to find them**: Service Accounts are managed at the workspace level. Administrators can create, view, and delete Service Accounts within their respective workspaces. Access the management interface through the "Service Accounts" tab within your workspace settings in the Web or Desktop Applications.
- **Availability**: This feature is exclusive to Business and Enterprise tier customers. You are not billed for the creation or usage of the Service Accounts themselves, as access is bundled with these subscriptions.
- **Permissions**: For the initial release, a Service Account inherits the full permissions/scope of a workspace administrator, granting access to all available API functionalities.

## Service Account Capabilities

| Capability | Description |
|---|---|
| Identification | You can assign a custom, human-readable name to each Service Account for easy identification within the UI. |
| Creation & Display | When a Service Account is created, the system generates a unique Service Account ID, records the date of creation, and identifies the administrator who created it. |
| Deletion | Service Accounts can be deleted via the User Interface (UI). Deleting an account immediately invalidates all associated credentials, revoking programmatic access. |

## Secret Keys

Each Service Account uses one or more associated secret keys for authentication. These credentials are what you use to authorize your API calls.

- **Generation**: A unique programmatic credential (e.g., API key, token) is generated upon creation of the Service Account. For security, new credentials are securely displayed only once upon generation or rotation.
- **Key Rotation**: Service Accounts can have multiple secret keys associated with them. The system provides a mechanism for administrators to rotate or regenerate the credentials of an existing Service Account. This feature supports key rotation policies, as you can replace an old key with a new one without interrupting service until the replacement is complete.

## How to Authenticate an API Call

To successfully call the LucidLink API, you must include an active Service Account key in the Authorization header of your HTTP request using the Bearer scheme.

### Header Format

```
Authorization: Bearer [your service key]
```

### Example (using cURL)

```bash
curl -i -X GET 'http://localhost:3003/api/v1/filespaces' \
  -H 'Authorization: Bearer [your service key]' \
  -H 'Content-Type: application/json'
```

Replace `[your service key]` with the active secret key obtained from your Service Account management console.
