/**
 * Docker Compose lifecycle manager for the audit trail stack.
 * Follows the process-manager.ts pattern: spawn from node:child_process.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface DockerResult {
  success: boolean;
  output?: string;
  error?: string;
}

function run(
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<DockerResult> {
  return new Promise((resolve) => {
    const proc = spawn("docker", args, { cwd, stdio: "pipe" });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ success: false, error: `Timed out after ${timeoutMs / 1000}s` });
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({
          success: false,
          error: stderr.trim() || stdout.trim() || `Exit code ${code}`,
        });
      }
    });

    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ success: false, error: e.message });
    });
  });
}

export class DockerManager {
  constructor(private workDir: string) {}

  get composeFile(): string {
    return join(this.workDir, "docker-compose.yml");
  }

  get envFile(): string {
    return join(this.workDir, ".env");
  }

  hasComposeFile(): boolean {
    return existsSync(this.composeFile);
  }

  /** Configure the .env file with the filespace mount point */
  configureEnv(fsMountPoint: string, extras?: Record<string, string>): void {
    const lines: string[] = [];

    // Preserve existing .env entries
    if (existsSync(this.envFile)) {
      const existing = readFileSync(this.envFile, "utf-8");
      for (const line of existing.split("\n")) {
        const key = line.split("=")[0]?.trim();
        if (key === "FSMOUNTPOINT" || (extras && key && key in extras)) continue;
        if (line.trim()) lines.push(line);
      }
    }

    lines.push(`FSMOUNTPOINT=${fsMountPoint}`);
    if (extras) {
      for (const [k, v] of Object.entries(extras)) {
        lines.push(`${k}=${v}`);
      }
    }
    writeFileSync(this.envFile, lines.join("\n") + "\n", "utf-8");
  }

  async up(): Promise<DockerResult> {
    // docker compose up -d may exit non-zero if a sidecar/setup container
    // fails its dependency check, even though core services started fine.
    // Treat as success if containers are running afterward.
    const result = await run(
      ["compose", "-f", this.composeFile, "up", "-d"],
      this.workDir,
      180_000,
    );
    if (!result.success) {
      const ps = await this.ps();
      if (ps.success && ps.output && ps.output.includes('"running"')) {
        return { success: true, output: result.error };
      }
    }
    return result;
  }

  async down(removeVolumes = false): Promise<DockerResult> {
    const args = ["compose", "-f", this.composeFile, "down"];
    if (removeVolumes) args.push("-v");
    return run(args, this.workDir);
  }

  async ps(): Promise<DockerResult> {
    return run(
      ["compose", "-f", this.composeFile, "ps", "--format", "json"],
      this.workDir,
    );
  }

  async logs(service?: string, lines = 50): Promise<DockerResult> {
    const args = ["compose", "-f", this.composeFile, "logs", "--tail", String(lines)];
    if (service) args.push(service);
    return run(args, this.workDir);
  }
}

/** Check if Docker is available and running */
export async function checkDocker(): Promise<DockerResult> {
  return run(["info", "--format", "{{.ServerVersion}}"], process.cwd(), 10_000);
}
