/**
 * LucidLink API Documentation Search
 *
 * Loads markdown doc chunks at startup and provides:
 * 1. A `search_api_docs` tool with keyword search (AND→OR fallback)
 * 2. Individual `lucidlink://docs/{topic}` resources for each chunk
 *
 * Mirrors the pattern from the Datastar MCP server.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Types ──

interface DocChunk {
  id: string;
  title: string;
  content: string;
  keywords: string[];
}

// ── Load chunks from disk ──

const __dir = dirname(fileURLToPath(import.meta.url));
const CHUNKS_DIR = join(__dir, "chunks");

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1] : "Untitled";
}

function extractKeywords(content: string): string[] {
  // Lowercase all words, deduplicate, filter noise
  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_/]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return [...new Set(words)];
}

function loadChunks(): DocChunk[] {
  // In development, chunks are in src/docs/chunks/
  // In production (dist/), chunks are still in src/docs/chunks/ (not compiled)
  // Try multiple locations
  const candidates = [
    CHUNKS_DIR,
    join(__dir, "..", "docs", "chunks"),
    join(__dir, "..", "..", "src", "docs", "chunks"),
  ];

  let chunksDir = "";
  for (const dir of candidates) {
    try {
      const files = readdirSync(dir);
      if (files.some((f) => f.endsWith(".md"))) {
        chunksDir = dir;
        break;
      }
    } catch {
      // not found, try next
    }
  }

  if (!chunksDir) {
    console.error("docs-search: Could not find chunks directory");
    return [];
  }

  const files = readdirSync(chunksDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  return files.map((file) => {
    const content = readFileSync(join(chunksDir, file), "utf-8");
    const id = basename(file, ".md").replace(/^\d+-/, "");
    return {
      id,
      title: extractTitle(content),
      content,
      keywords: extractKeywords(content),
    };
  });
}

const chunks = loadChunks();

// ── Search logic ──

function scoreChunk(chunk: DocChunk, terms: string[]): number {
  let score = 0;
  const lowerContent = chunk.content.toLowerCase();
  const lowerTitle = chunk.title.toLowerCase();

  for (const term of terms) {
    // Title match = heavy weight
    if (lowerTitle.includes(term)) {
      score += 10;
    }

    // Count content occurrences
    let idx = 0;
    let count = 0;
    while ((idx = lowerContent.indexOf(term, idx)) !== -1) {
      count++;
      idx += term.length;
    }
    score += count;
  }

  return score;
}

function searchDocs(query: string, maxResults: number = 3): DocChunk[] {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (terms.length === 0) return chunks.slice(0, maxResults);

  // AND mode: all terms must appear
  let results = chunks.filter((chunk) => {
    const lc = chunk.content.toLowerCase();
    return terms.every((t) => lc.includes(t));
  });

  // OR fallback if AND returns nothing
  if (results.length === 0) {
    results = chunks.filter((chunk) => {
      const lc = chunk.content.toLowerCase();
      return terms.some((t) => lc.includes(t));
    });
  }

  // Score and sort
  return results
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, terms) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((r) => r.chunk);
}

// ── Registration ──

export function registerDocsSearch(server: McpServer): void {
  // Register the search tool
  server.tool(
    "search_api_docs",
    `Search LucidLink API documentation for answers about authentication, deployment, best practices, scaling, Connect, permissions, endpoints, audit trail analytics, OpenSearch queries, alerting, and more. Uses keyword matching with AND→OR fallback. Returns the most relevant documentation sections.`,
    {
      query: z
        .string()
        .describe(
          "Search query — use natural language or keywords (e.g., 'key rotation', 'docker compose scaling', 'external entry permissions')",
        ),
      max_results: z
        .number()
        .min(1)
        .max(8)
        .default(3)
        .describe("Maximum number of doc sections to return (default: 3)"),
    },
    async ({ query, max_results }) => {
      const results = searchDocs(query, max_results);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No documentation found for "${query}". Available topics: ${chunks.map((c) => c.title).join(", ")}`,
            },
          ],
        };
      }

      const text = results
        .map(
          (chunk, i) =>
            `--- Result ${i + 1}: ${chunk.title} (lucidlink://docs/${chunk.id}) ---\n\n${chunk.content}`,
        )
        .join("\n\n");

      return {
        content: [{ type: "text" as const, text }],
      };
    },
  );

  // Register individual doc resources
  for (const chunk of chunks) {
    server.resource(
      `docs-${chunk.id}`,
      `lucidlink://docs/${chunk.id}`,
      {
        description: chunk.title,
        mimeType: "text/markdown",
      },
      async () => ({
        contents: [
          {
            uri: `lucidlink://docs/${chunk.id}`,
            text: chunk.content,
          },
        ],
      }),
    );
  }

  // Register a docs index resource listing all available topics
  const docsIndex = chunks
    .map((c) => `- lucidlink://docs/${c.id} — ${c.title}`)
    .join("\n");

  server.resource(
    "docs-index",
    "lucidlink://docs/index",
    {
      description:
        "Index of all LucidLink API documentation topics. Read this to see what documentation is available.",
      mimeType: "text/plain",
    },
    async () => ({
      contents: [
        {
          uri: "lucidlink://docs/index",
          text: `LucidLink API Documentation Index\n==================================\n\nAvailable topics:\n${docsIndex}\n\nUse the search_api_docs tool to search across all documentation,\nor read individual topics via their resource URI.`,
        },
      ],
    }),
  );
}
