# Best Practices: Operating the LucidLink API Container

To ensure the security, stability, and efficiency of your automated administrative workflows, consider the following best practices when deploying and utilizing the self-hosted LucidLink API container.

## Security & Access Control

Since the API handles sensitive administrative functions, security is paramount.

1. **Enforce TLS/HTTPS for External Connections**: The API container serves the API over HTTP (e.g., on port 3003 as in the deployment guide). To prevent Service Account keys (Bearer tokens) from being intercepted in plain text, you must place the container behind a reverse proxy (e.g., Nginx, Apache, or a dedicated API Gateway) and enforce HTTPS/TLS for all external client communication. Never transmit your keys over an unencrypted connection.

2. **Strict Network Isolation and Firewall Rules**: Limit network access to the container's host port (e.g., 3003) only to trusted internal systems (e.g., automation servers, CI/CD runners) that specifically need to make API calls. Use firewall rules and network segmentation to prevent external or unauthorized access.

3. **Secure Service Account Key Management**:
   - **Treat Keys as Sensitive Secrets**: The Service Account key is equivalent to a master password for administrative access to your workspace. Do not hardcode keys in scripts; instead, use environment variables or a dedicated secrets manager (e.g., HashiCorp Vault, AWS Secrets Manager, Azure Key Vault) to store and inject the keys securely at runtime.
   - **Regular Key Rotation**: Leverage the Service Account capability to have multiple secret keys associated, enabling a smooth rotation process. Periodically generate a new key, update your consuming applications, and then revoke the old key.
   - **Reset Compromised Keys Immediately**: If you suspect a key has been compromised or leaked, revoke it immediately via the Service Account management portal.

## Infrastructure & Deployment

As a self-hosted container, its stability depends on your infrastructure choices.

1. **Controlled Resource Allocation**: Allocate dedicated resources (CPU and RAM) to the Docker container. This prevents resource contention with other services on the host and ensures the API can handle bursts of administrative activity without latency. A good starting point for similar services is typically 2 vCPU and 4 GB RAM, but adjust based on your usage frequency.

2. **Use Versioned Tags**: While the `:latest` tag is available for convenience, for production environments, specify an explicit version tag (x.y.z). This allows you to control exactly when you upgrade, avoiding unexpected breaking changes or downtime associated with automatic updates.

## Efficient API Usage

Use the API responsibly to maximize efficiency and stability.

1. **Optimize Batch Operations**: Where possible, structure your scripts to use batch operations rather than issuing many sequential, individual requests. For example, consolidating member role changes or group membership updates into the minimum number of API calls will reduce overhead and execution time.

2. **Be Respectful of the API**: While there may not be hard external rate limits imposed by the self-hosted container, remember that the API calls still interact with your LucidLink backend services. Avoid aggressive polling or rapid, unnecessary requests that could create undue load on your workspace management systems.
