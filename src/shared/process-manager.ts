/**
 * Manages the LucidLink API as a native Node.js child process.
 * Replaces DockerManager — no Docker needed.
 */
import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default: look for the API in a sibling `api/` directory
const DEFAULT_API_DIR = resolve(__dirname, "..", "..", "api");
const DEFAULT_MAIN_JS = resolve(DEFAULT_API_DIR, "main.js");

const API_PORT = 3003;

let apiProcess: ChildProcess | null = null;
let logBuffer: string[] = [];
const MAX_LOG_LINES = 200;

function appendLog(line: string) {
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
}

export function getApiDir(): string {
  return process.env.LUCIDLINK_API_DIR ?? DEFAULT_API_DIR;
}

export function getMainJs(): string {
  return resolve(getApiDir(), "main.js");
}

export function isApiInstalled(): boolean {
  return existsSync(getMainJs());
}

export async function isApiRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${API_PORT}/api/v1/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function startApi(): Promise<{ ok: boolean; error?: string }> {
  if (await isApiRunning()) return { ok: true };

  const mainJs = getMainJs();
  if (!existsSync(mainJs)) {
    return { ok: false, error: `API not found at ${mainJs}. Run the installer first.` };
  }

  // Find node binary — prefer the bundled one, fall back to system
  const nodeBin = process.execPath; // use same node that's running this MCP server

  return new Promise((resolvePromise) => {
    logBuffer = [];
    apiProcess = spawn(nodeBin, [mainJs], {
      cwd: getApiDir(),
      env: { ...process.env, LUCID_API_PORT: String(API_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    apiProcess.stdout?.on("data", (chunk: Buffer) => {
      chunk.toString().split("\n").filter(Boolean).forEach(appendLog);
    });
    apiProcess.stderr?.on("data", (chunk: Buffer) => {
      chunk.toString().split("\n").filter(Boolean).forEach(appendLog);
    });
    apiProcess.on("exit", (code) => {
      appendLog(`[process-manager] API process exited with code ${code}`);
      apiProcess = null;
    });

    // Wait for the API to become healthy
    let attempts = 0;
    const check = setInterval(async () => {
      attempts++;
      if (await isApiRunning()) {
        clearInterval(check);
        resolvePromise({ ok: true });
      } else if (attempts > 30) {
        clearInterval(check);
        resolvePromise({ ok: false, error: "API failed to start within 15 seconds. Check logs." });
      }
    }, 500);
  });
}

export function stopApi(): boolean {
  if (apiProcess) {
    apiProcess.kill("SIGTERM");
    apiProcess = null;
    return true;
  }
  return false;
}

export function getApiLogs(lines = 50): string {
  return logBuffer.slice(-lines).join("\n");
}

export async function ensureApiRunning(): Promise<{ ok: boolean; error?: string }> {
  if (await isApiRunning()) return { ok: true };
  return startApi();
}
