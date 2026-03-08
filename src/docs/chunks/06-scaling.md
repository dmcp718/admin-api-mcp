# Scaling LucidLink API with Docker Compose and NGINX

## Executive Summary

The LucidLink API (lucidlink/lucidlink-api) is designed to run within a Docker container. For production environments requiring high availability or high request throughput, a single instance may become a bottleneck. This article outlines a sample architecture and configuration required to scale the API horizontally using Docker Compose and an NGINX Load Balancer.

## Infrastructure Overview

The architecture consists of:

- **One Load Balancer (NGINX)**: Acts as the entry point, receiving external traffic and distributing it to the backend.
- **Multiple API Instances**: Clones of the LucidLink API container that process requests in parallel.
- **Internal Docker Network**: Allows NGINX to discover and communicate with the API containers by service name.

## Configuration Files

### NGINX Configuration (nginx.conf)

This file defines how traffic is distributed. NGINX will use Docker's internal DNS to resolve the lucidlink-api service name to all running container IPs.

```nginx
user nginx;
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    upstream lucid_api_cluster {
        # Docker internal DNS resolves this to all scaled container IPs
        server lucidlink-api:3003;
    }

    server {
        listen 80;

        location / {
            proxy_pass http://lucid_api_cluster;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Recommended for API stability
            proxy_connect_timeout 60s;
            proxy_read_timeout 60s;
        }
    }
}
```

### Docker Compose Configuration (docker-compose.yml)

This file defines the relationship between the load balancer and the API. Note that the API service does not expose a port to the host; only the load balancer is public.

```yaml
version: '3.8'

services:
  lucidlink-api:
    image: lucidlink/lucidlink-api:latest
    # Required for Apple Silicon (M1/M2/M3) or ARM instances
    # platform: linux/amd64
    restart: always
    environment:
      - LL_ENDPOINT=${LL_ENDPOINT}
      - LL_SECRET=${LL_SECRET}
    # Important: No 'ports' mapping here to allow scaling without conflicts.

  load-balancer:
    image: nginx:alpine
    container_name: lucid_lb
    restart: always
    ports:
      - "3003:80"  # Exposes the API on your usual port 3003
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - lucidlink-api
```

## Deployment & Scaling Instructions

### Initial Deployment

To launch the environment with 3 API instances:

```bash
docker-compose up -d --scale lucidlink-api=3
```

### Dynamic Scaling

To increase capacity during peak loads (e.g., to 6 instances) without bringing the system down:

```bash
docker-compose up -d --scale lucidlink-api=6
```

### Verification

Check the status of your containers to ensure they are healthy:

```bash
docker-compose ps
```

## Environment Variables

The API containers require the following environment variables:

- `LL_ENDPOINT`: The LucidLink endpoint URL
- `LL_SECRET`: The Service Account secret key

These should be stored in a `.env` file in the same directory as your `docker-compose.yml`, or injected via your secrets management system.
