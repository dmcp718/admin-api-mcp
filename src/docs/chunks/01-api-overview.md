# LucidLink API Overview

The LucidLink API provides a robust, programmatic interface for managing and automating your LucidLink workspace. Built for administrators, engineers, and power users, the API lets you script operations, manage resources at scale, and seamlessly integrate LucidLink functionality into your existing systems.

## Architectural Model: Self-Hosted and Zero-Knowledge

The API service is self-hosted — it is NOT run in the cloud by LucidLink. Instead, the application is provided as a standard Docker container hosted in DockerHub. Users deploy and run this container on their own infrastructure.

### Why a Self-Hosted Model?

- **Guaranteed Zero-Knowledge**: Running the API service on your premises ensures that the API application never transmits or has access to your cryptographic keys or sensitive user data. LucidLink, as the provider, has no access to the protected information being managed by the API.
- **Infrastructure Control**: You retain complete control over the API's operational environment, including network configuration, access control, and scaling within your private network.

## Core API Capabilities

The LucidLink API is a RESTful API that exposes various capabilities via standard endpoints, enabling seamless integration with common tools and scripting languages.

This first API release is designed to automate key workspace management tasks, including comprehensive CRUD (Create, Read, Update, Delete) functionality for the following resources:

- **Member Management**: Programmatically manage the full lifecycle of users, including creation, deletion, updating roles/group memberships, and retrieving status.
- **Group Management**: Simplify access control by automating the creation, deletion, listing, and updating of workspace groups and their membership.
- **Permission & Share Management**: Gain granular control by automating the creation, reading, and revocation of access permissions for both individual members and groups.
- **Filespace Management**: Automate the provisioning and decommissioning of storage resources, including creating, deleting, listing, and retrieving detailed filespace information.

## Related Articles

- Authentication & Access: Guide on generating an API key for using the API.
- Deployment & Usage: Step-by-step instructions on deploying the Docker container, making initial calls, and accessing the integrated Swagger documentation.
- API Key Functionalities & Common Automation Scenarios: Detailed endpoint reference with use cases.
