/**
 * User-friendly response formatting.
 */

/** MCP CallToolResult shape (index signature required by SDK) */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function formatSuccess(operation: string, details: Record<string, unknown>): string {
  let msg = `${operation} completed successfully.\n\n`;
  if (details && Object.keys(details).length > 0) {
    msg += "Details:\n" + JSON.stringify(details, null, 2);
  }
  return msg;
}

export function formatError(operation: string, error: string): string {
  const friendly: Record<string, string> = {
    "401": "Your authentication token is invalid or expired. Please update it in settings.",
    "404": "The requested resource was not found.",
    "409": "This resource already exists. Please choose a different name.",
    ConnectionError: "Cannot connect to the API. Is the LucidLink API process running?",
    rate_limit: "Too many requests. Please wait a moment and try again.",
  };

  for (const [key, msg] of Object.entries(friendly)) {
    if (error.includes(key)) {
      error = msg;
      break;
    }
  }

  return `${operation} failed: ${error}`;
}

/** Return a success text result */
export function ok(s: string): ToolResult {
  return { content: [{ type: "text" as const, text: s }] };
}

/** Return an error text result with isError flag */
export function err(s: string): ToolResult {
  return { content: [{ type: "text" as const, text: s }], isError: true };
}
