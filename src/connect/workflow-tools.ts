/**
 * High-level Connect workflow helpers.
 * ensure_folder_path, import_s3_object, bulk_import_s3_objects
 */
import { ApiClient, ApiResponse } from "../shared/api-client.js";

interface FolderResult {
  ok: boolean;
  leafId: string | null;
  error: string;
}

function extractId(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  if (data.id) return String(data.id);
  const inner = data.data as Record<string, unknown> | undefined;
  return inner?.id ? String(inner.id) : null;
}

export async function ensureFolderPath(
  client: ApiClient,
  filespaceId: string,
  path: string,
): Promise<FolderResult> {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (parts.length === 0) return { ok: true, leafId: null, error: "" };

  let currentPath = "";
  let currentId: string | null = null;

  for (const folder of parts) {
    currentPath += `/${folder}`;
    let success = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      const resolveRes = await client.resolveEntry(filespaceId, currentPath);
      if (resolveRes.success) {
        currentId = extractId(resolveRes.data);
        success = true;
        break;
      }

      const createRes = await client.createEntry(filespaceId, currentId ?? "", folder);
      if (createRes.success) {
        currentId = extractId(createRes.data);
        success = true;
        break;
      }

      if (createRes.statusCode === 409) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!success) {
      return { ok: false, leafId: null, error: `Failed to create/resolve '${currentPath}'` };
    }
  }

  return { ok: true, leafId: currentId, error: "" };
}

export async function importS3Object(
  client: ApiClient,
  filespaceId: string,
  dataStoreId: string,
  s3Key: string,
  llPath: string,
): Promise<ApiResponse> {
  // Ensure parent directory
  const pathParts = llPath.replace(/^\/+/, "").split("/");
  if (pathParts.length > 1) {
    const dirPath = "/" + pathParts.slice(0, -1).join("/");
    const folderResult = await ensureFolderPath(client, filespaceId, dirPath);
    if (!folderResult.ok) {
      return { success: false, error: `Directory creation failed for '${dirPath}': ${folderResult.error}` };
    }
  }

  return client.createExternalEntry(filespaceId, {
    path: llPath,
    kind: "SingleObjectFile",
    dataStoreId,
    singleObjectFileParams: { objectId: s3Key },
  });
}

export interface BulkObject {
  s3_key: string;
  ll_path: string;
}

export interface BulkResult {
  total: number;
  succeeded: number;
  failed: number;
  dirFailures: { dir: string; error: string }[];
  objectFailures: { s3Key: string; llPath: string; error: string }[];
}

export async function bulkImportS3Objects(
  client: ApiClient,
  filespaceId: string,
  dataStoreId: string,
  objects: BulkObject[],
  stopOnError = false,
): Promise<BulkResult> {
  const result: BulkResult = {
    total: objects.length,
    succeeded: 0,
    failed: 0,
    dirFailures: [],
    objectFailures: [],
  };

  // Collect unique directories
  const dirs = new Set<string>();
  for (const obj of objects) {
    const parts = obj.ll_path.replace(/^\/+/, "").split("/");
    if (parts.length > 1) {
      dirs.add("/" + parts.slice(0, -1).join("/"));
    }
  }

  // Ensure directories (sorted so parents come first)
  for (const dir of Array.from(dirs).sort()) {
    const folderResult = await ensureFolderPath(client, filespaceId, dir);
    if (!folderResult.ok) {
      result.dirFailures.push({ dir, error: folderResult.error });
      if (stopOnError) return result;
    }
  }

  // Link each object
  for (const obj of objects) {
    const res = await client.createExternalEntry(filespaceId, {
      path: obj.ll_path,
      kind: "SingleObjectFile",
      dataStoreId,
      singleObjectFileParams: { objectId: obj.s3_key },
    });

    if (res.success) {
      result.succeeded++;
    } else {
      result.failed++;
      result.objectFailures.push({ s3Key: obj.s3_key, llPath: obj.ll_path, error: res.error ?? "Unknown error" });
      if (stopOnError) break;
    }
  }

  return result;
}
