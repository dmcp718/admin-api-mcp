# Deployment & Usage: LucidLink API Container

This article provides a step-by-step guide on how to deploy the self-hosted LucidLink API container, confirm its operational status, and begin interacting with your workspace using API calls and the integrated documentation.

## Prerequisites

Before deploying the container, ensure you meet the following requirements:

1. **Account Status**: You must be a registered user on app.lucidlink.com.
2. **Workspace**: You must have an existing workspace.
3. **Role**: You must be a workspace administrator of that workspace.
4. **Subscription**: You must have a Business or Enterprise subscription.
5. **Service Account**: You must have a dedicated Service Account with an active secret key for authentication, as the API is designed to be accessed exclusively through these accounts. For detailed information on setting up and managing service accounts, refer to: lucidlink.com/kb-service-accounts.
6. **Docker**: You must have Docker installed and running on your infrastructure.

## Step 1: Deploying the Docker Container

The LucidLink API service is provided as a container image available on Docker Hub under the name `lucidlink/lucidlink-api`.

To pull the latest stable image and run the container:

```bash
docker run -p 3003:3003 lucidlink/lucidlink-api:latest
```

This command maps the container's internal port 3003 to port 3003 on your host machine, making the API accessible locally.

| Component | Description |
|---|---|
| docker run | Command to run the container. |
| -p 3003:3003 | Maps host port 3003 to the container's exposed port 3003. |
| lucidlink/lucidlink-api:latest | The image name and the most recent stable tag. |

## Step 2: Confirmation and Health Check

After running the container, perform a basic health check to confirm that the service is running and ready to accept requests:

```bash
curl -i -X GET 'http://localhost:3003/api/v1/health'
```

A successful response will indicate that the container is fully operational.

## Step 3: Accessing the API Documentation (Swagger)

Once the container is live and fully operational, the complete, interactive Swagger documentation (OpenAPI documentation) for the API is automatically generated and hosted by the container itself.

Access the documentation in your web browser at:

```
http://localhost:3003/api/v1/docs
```

This documentation allows you to explore all available endpoints, required parameters, data models, and even execute sample calls directly from the browser after providing your authentication credentials.

## Step 4: Making an Authenticated API Call

Most operations require authorization using the secret key from your Service Account. You must pass this key in the Authorization header using the Bearer scheme.

```bash
curl -i -X GET 'http://localhost:3003/api/v1/filespaces' \
  -H 'Authorization: Bearer [your service key]' \
  -H 'Content-Type: application/json'
```

Replace `[your service key]` with the active secret key for the service account that you created. A successful command will return a JSON list of the filespaces within the workspace where the service account was created.
