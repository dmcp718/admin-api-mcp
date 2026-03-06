/**
 * macOS Keychain access via the `security` CLI.
 * No external dependencies — uses child_process.
 */
import { execSync } from "node:child_process";

const SERVICE = "lucidlink-mcp";
const ACCOUNT = "bearer_token";

export function getBearerToken(): string | null {
  // 1. Environment variable
  const envToken = process.env.LUCIDLINK_BEARER_TOKEN;
  if (envToken) return envToken;

  // 2. macOS Keychain
  try {
    const token = execSync(
      `security find-generic-password -a "${ACCOUNT}" -s "${SERVICE}" -w 2>/dev/null`,
      { encoding: "utf-8" },
    ).trim();
    if (token) return token;
  } catch {
    // Not found or not on macOS — fall through
  }

  return null;
}

export function storeBearerToken(token: string): void {
  // Delete existing entry (ignore errors if it doesn't exist)
  try {
    execSync(
      `security delete-generic-password -a "${ACCOUNT}" -s "${SERVICE}" 2>/dev/null`,
    );
  } catch {
    // OK — didn't exist
  }
  execSync(
    `security add-generic-password -a "${ACCOUNT}" -s "${SERVICE}" -w "${token.replace(/"/g, '\\"')}"`,
  );
}
