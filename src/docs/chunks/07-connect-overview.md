# LucidLink Connect Overview

LucidLink Connect enables the connection of external data stores (such as S3 object storage) and the linking of stored assets directly within the filespace without the need to first download or copy the data into the filespace. Linked assets can then be streamed directly from any compatible LucidLink client (desktop, mobile, web) in the same manner as data added through conventional means.

LucidLink Connect is a purchased add-on available only to LucidLink Enterprise plans.

## Key Benefits and Use Cases

- Access and stream existing external data (such as cloud object storage) instantly without duplication or copying
- Integrate with platforms and tools backed by cloud object storage

## How It Works

LucidLink Connect uses a two-part system:

### 1. Data Stores

A Data Store contains the connection information and credentials needed to generate the pre-signed URLs that clients will use to stream data. Each data store is:

- Filespace-specific (not shared across filespaces)
- Encrypted with both hub and admin keys for security
- Configured once and can be reused for multiple files

### 2. External Entries

An External Entry is a record in your filespace that points to an object or file in your cloud storage. Once linked, you can:

- Instantly view and stream the file using normal filesystem operations
- Access the file from any Lucid client (Web, Desktop, Mobile)

## Supported Storage Types

| Storage Type | Support Status |
|---|---|
| S3-Compatible Storage | Supported |
| Azure Blob Storage | Planned |
| Other non-object storage types | Planned |

## Prerequisites

- LucidLink Enterprise workspace
- Filespace version 3.6 or above
- Filespace admin privileges
- Service account and bearer token configured for use with LucidLink API
- LucidLink Connect enabled for your filespace (contact sales)
- Object storage bucket and access credentials for said bucket with GetObject permissions
- LucidLink API container

## Quickstart Guide

### Step 1: Create a Data Store

Configure access to your S3 bucket by creating a data store:

```
POST /filespaces/{filespaceId}/external/data-stores
{
  "name": "my-s3-bucket",
  "kind": "S3DataStore",
  "s3StorageParams": {
    "accessKey": "AKIAIOSFODNN7EXAMPLE",
    "secretKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "bucketName": "my-company-data",
    "region": "us-east-1",
    "useVirtualAddressing": true,
    "urlExpirationMinutes": 10080
  }
}
```

LucidLink Connect requires only GetObject permissions for the bucket. Access credentials should always be scoped to allow only the minimum access required.

### Step 2: Link External Files

Once your data store is configured, link specific S3 objects to your filespace:

```
POST /filespaces/{filespaceId}/external/entries
{
  "path": "/reports/2024-annual-report.pdf",
  "kind": "SingleObjectFile",
  "dataStoreId": "bXktZGF0YS1zdG9yZQ",
  "singleObjectFileParams": {
    "objectId": "2024-annual-report.pdf"
  }
}
```

The file will now appear at `/reports/2024-annual-report.pdf` in your filespace. It is possible to link an object to multiple filespace entries at different paths, or even across multiple filespaces. Keep in mind that each link will be billed as additional storage.

### Step 3: Access Your Files

External entries are denoted by the LucidLink Connect icon (purple dot). They function like any other file in your filespace with the exception of being read-only, and can be accessed through:

- **Web Client**: Browse and download via web browser (requires CORS configuration on the source bucket)
- **Desktop Client**: Access through native filesystem
- **Mobile Apps**: View and download on iOS/Android

## Security & Encryption

### LucidLink Connect Is Not Zero-Knowledge

Due to the fact that assets linked via LucidLink Connect are stored outside of LucidLink in their native format and without client-side encryption, they are not covered by LucidLink's zero-knowledge guarantees.

This does not mean that LucidLink Connect is insecure — merely that it offers a more relaxed mode of data privacy on par with the data storage providers from whom the data is being streamed. LucidLink does not read or download the contents of externally linked storage as part of normal operations.

LucidLink's zero-knowledge guarantee continues to apply to all non-external data stored within the filespace even when LucidLink Connect is enabled.

## Access Control

- **Filespace Admin**: Required to create/delete data stores and link external entries
- **File Permissions**: Standard Lucid permissions apply to external entries
- **Audit Trail**: All operations are tracked in audit logs

## Limitations & Best Practices

### Current Limitations

- **Read-Only**: Cannot write, modify, or delete S3 objects
- **Individual Object Linking**: Each operation links a single object — bulk link operations are planned for a future release
- **Versioning Not Supported**: Object versioning is not supported at release but may be enabled in future versions
- **Instant retrieval classes only**: Non-instant retrieval classes such as Glacier are not supported
- **S3 Only**: Azure and other storage types planned for future releases
- **TeamCache**: External entries are not cacheable or pre-hydrateable via TeamCache at release — support to follow in future releases
- **Snapshots**: External entries are included in snapshots for accuracy and completeness; but their URLs will not be refreshed automatically and external entries in snapshots will cease to function once the URL expiration elapses. The data backing the entry will remain safe in the bucket.

### External Entry Filesystem Operations

External entries can be moved, renamed, copied, and/or deleted within the local filesystem. It is not possible to modify an external entry in place or alter the data in the bucket because external entries are read-only.

- **Move**: The external entry remains in the filesystem but is moved to a new location. Its access URL will continue to be refreshed by the hub. The data backing the entry remains in place in the bucket.
- **Rename**: The external entry remains but is renamed. Its access URL continues to be refreshed.
- **Delete**: The external entry is removed from the filesystem. Its access URL will no longer be refreshed. The data backing the entry remains in place in the bucket.
- **Copy**: The external entry remains, but the copied file is written to the bucket backing the filespace as a native LucidLink entry. The original external asset URL will continue to be refreshed, but the copy will not be subject to refresh as it will have been copied into the filespace.
- **Modify**: The write operation will fail and you will receive an error because you cannot write back to the bucket via LucidLink Connect.

### Saving External Files

Depending on the behavior of your applications, it may be possible to save changes once you've opened an external entry for reading. This is achieved through a combination of the filesystem operations listed above (move/rename/delete), and effectively overwrites the original entry. The file that replaces it will be a LucidLink-native entry stored in the bucket the filespace was initialized against.

### Security Best Practices

- Use access credentials with minimal permissions (s3:GetObject or equivalent only)
- Follow best practices for backup or replication of the source bucket — LucidLink is not responsible for the durability of data stored in customer-provided storage
- Regularly rotate access keys (possible using a patch request with the DataStore endpoint)

### Scalability

You can employ a Docker Compose file to automate deployment of a load-balanced, clustered set of API containers to improve linking performance with the LucidLink Connect API.
