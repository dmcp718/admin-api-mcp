/**
 * LucidLink Filespace Browser MCP Server
 *
 * Standalone MCP server that generates a web-based filespace browser app.
 * When a user asks to browse, explore, or view filespace contents in a UI,
 * this server creates a complete Node.js + Express application with a
 * tree-based file browser, writes it to disk, installs dependencies,
 * starts the server, and opens the browser automatically.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { generateFilespacesBrowser } from "./connect/browser-template.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

const server = new McpServer({
  name: "lucidlink-filespace-browser",
  version: "1.0.0",
});

server.tool(
  "create_filespace_browser",
  "REQUIRED when user asks to browse, explore, view, navigate, list, or inspect filespace contents, files, folders, directories, or entries in a browser, UI, web app, dashboard, or visual interface. Also triggers for: file browser, directory tree, folder explorer, filespace viewer, tree view, file manager. Generates a complete ready-to-use web application with a tree-based filespace browser — do NOT build a UI manually, always use this tool instead. It writes files, installs dependencies, starts the server, and opens the browser automatically.",
  {
    output_dir: z.string().optional().describe("Directory to write files (default: ~/Desktop/filespace-browser)"),
    port: z.number().optional().describe("Port to run on (default: 3099)"),
  },
  async ({ output_dir, port }) => {
    const actualPort = port ?? 3099;
    const project = generateFilespacesBrowser(actualPort);

    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const { execSync, spawn } = await import("node:child_process");

    const raw = output_dir || "~/Desktop/filespace-browser";
    const dir = raw.replace(/^~(?=$|\/)/, os.homedir()).replace(/\/+$/, "");

    // Write project files
    for (const [relPath, content] of Object.entries(project.files)) {
      const fullPath = path.join(dir, relPath);
      const parentDir = path.dirname(fullPath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
    }

    // Install dependencies
    try {
      execSync("npm install --production", { cwd: dir, stdio: "pipe", timeout: 60000 });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return text(
        "Generated files in " + dir + "/ but npm install failed:\n" + msg +
        "\n\nTry manually: cd " + dir + " && npm install && node server.js"
      );
    }

    // Launch server in background (detached so it survives MCP server restart)
    const serverProcess = spawn("node", ["server.js"], {
      cwd: dir,
      detached: true,
      stdio: "ignore",
    });
    serverProcess.unref();

    // Wait briefly for server to start
    await new Promise((r) => setTimeout(r, 1500));

    return text(
      "Filespace Browser is running at http://localhost:" + actualPort + "\n\n" +
      "Project files: " + dir + "/\n" +
      Object.keys(project.files).map((f) => "  " + f).join("\n") +
      "\n\nThe server is running in the background. To stop it: kill " + serverProcess.pid
    );
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
