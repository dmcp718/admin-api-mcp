/**
 * LucidLink brand design tokens as an MCP resource.
 * Shared across all MCP servers so Claude Desktop always
 * has brand context when generating UIs.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const BRAND_TOKENS = `LucidLink Brand Design Tokens
==============================

COLORS (dark theme by default):
  Background:  #151519 (charcoal)
  Text:        #FFFFFF (white on dark)
  Accent:      #B0FB15 (neon green — CTAs, active states, focus rings ONLY)
  Indigo:      #5E53E0 (info states, running indicators)
  Pink:        #FB68B7 (secondary accent)
  Orange:      #FF7E3D (warnings, pending)
  Sand:        #EBE8E0 (neutral/light backgrounds)
  Error:       #F8685A
  Success:     #B0FB15 (same as accent)

TYPOGRAPHY:
  Headings:    font-family: 'Inter', sans-serif; font-weight: 700
  Body:        font-family: 'Inter', sans-serif; font-weight: 400
  Mono:        font-family: 'IBM Plex Mono', monospace
  Google Fonts: https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap

RULES:
  - Sentence case only (never title case or ALL CAPS)
  - Left or center alignment only (never right-align or justify)
  - Neon (#B0FB15) for accents only — never for large areas or body text
  - Dark theme default: charcoal background, white text
  - Border radius: 8-12px for cards/buttons
  - Transitions: 150-200ms ease

CSS CUSTOM PROPERTIES:
  :root {
    --color-charcoal: #151519;
    --color-neon: #B0FB15;
    --color-indigo: #5E53E0;
    --color-pink: #FB68B7;
    --color-orange: #FF7E3D;
    --color-sand: #EBE8E0;
    --color-error: #F8685A;
    --font-body: 'Inter', sans-serif;
    --font-mono: 'IBM Plex Mono', monospace;
  }`;

export function registerBrandResource(server: McpServer): void {
  server.resource(
    "brand-guidelines",
    "lucidlink://brand/design-tokens",
    {
      description: "LucidLink brand design tokens — colors, typography, and rules. Read this before generating any UI.",
      mimeType: "text/plain",
    },
    async () => ({
      contents: [{
        uri: "lucidlink://brand/design-tokens",
        text: BRAND_TOKENS,
      }],
    }),
  );
}
