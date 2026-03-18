/**
 * Discover mounted LucidLink filespaces via the lucid CLI.
 *
 * Uses `lucid list` to get instance IDs, names, and ports, then
 * `lucid --instance <id> status` to parse mount points.
 *
 * Mirrors the Go implementation in fs-index-server/mount_discovery.go.
 */
import { execFile } from "node:child_process";

export interface FilespaceMount {
  instanceId: string;
  name: string;
  mountPoint: string;
  port: number;
}

function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${cmd} ${args.join(" ")} failed: ${error.message}\n${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Parse `lucid list` output.
 *
 * Example:
 *   INSTANCE ID        FILESPACE                    PORT        MODE
 *   2004               nab.lucid-demo               9823        live
 */
function parseInstanceList(output: string): Array<{ id: string; name: string; port: number }> {
  const result: Array<{ id: string; name: string; port: number }> = [];
  const lineRe = /^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\S+)/;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("INSTANCE") || trimmed.startsWith("---")) continue;
    const m = lineRe.exec(trimmed);
    if (m) {
      result.push({ id: m[1], name: m[2], port: parseInt(m[3], 10) });
    }
  }
  return result;
}

/**
 * Parse `lucid --instance <id> status` output for mount point and filespace name.
 */
function parseMountPoint(output: string): string | null {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Mount point:")) {
      return trimmed.replace("Mount point:", "").trim();
    }
  }
  return null;
}

function parseFilespaceName(output: string): string | null {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("Filespace:")) {
      return trimmed.replace("Filespace:", "").trim();
    }
  }
  return null;
}

/**
 * Discover all mounted LucidLink filespaces.
 * Returns an array of mounts with instance ID, name, mount point, and port.
 */
export async function discoverMounts(lucidBin = "lucid"): Promise<FilespaceMount[]> {
  // Step 1: lucid list
  const { stdout: listOutput } = await exec(lucidBin, ["list"]);
  const instances = parseInstanceList(listOutput);

  if (instances.length === 0) {
    return [];
  }

  // Step 2: get mount point for each instance
  const mounts: FilespaceMount[] = [];
  for (const inst of instances) {
    try {
      const { stdout: statusOutput } = await exec(lucidBin, ["--instance", inst.id, "status"]);
      const mountPoint = parseMountPoint(statusOutput);
      if (mountPoint) {
        const name = parseFilespaceName(statusOutput) ?? inst.name;
        mounts.push({
          instanceId: inst.id,
          name,
          mountPoint,
          port: inst.port,
        });
      }
    } catch {
      // Skip instances that fail status check
    }
  }

  return mounts;
}
