/**
 * UI Template Tests
 *
 * Validates that generated UI projects:
 * - Produce all required files
 * - Use correct fonts (Inter, not Aeonik)
 * - Use dark theme colors
 * - Include functional server code
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateConnectUI } from "../dist/connect/ui-template.js";
import { generateFilespacesBrowser } from "../dist/connect/browser-template.js";
import { generateSearchUI } from "../dist/connect/search-template.js";

describe("Connect UI template", () => {
  const project = generateConnectUI("test-fs-id", "test-ds-id");

  it("returns files object", () => {
    assert.ok(project.files, "Should return files");
    assert.ok(Object.keys(project.files).length > 0, "Should have at least one file");
  });

  it("includes server.js", () => {
    assert.ok("server.js" in project.files, "Should include server.js");
  });

  it("includes package.json", () => {
    assert.ok("package.json" in project.files, "Should include package.json");
    const pkg = JSON.parse(project.files["package.json"]);
    assert.ok(pkg.dependencies, "package.json should have dependencies");
  });

  it("uses Inter font family (not Aeonik)", () => {
    const allContent = Object.values(project.files).join("\n");
    assert.ok(!allContent.includes("Aeonik"), "Should not reference Aeonik");
    assert.ok(allContent.includes("Inter"), "Should use Inter font");
  });

  it("uses a dark theme background color", () => {
    const allContent = Object.values(project.files).join("\n");
    // Accept brand charcoal (#151519) or the template's dark (#0f1419)
    const hasDarkBg = allContent.includes("#151519") || allContent.includes("#0f1419");
    assert.ok(hasDarkBg, "Should use a dark background color (#151519 or #0f1419)");
  });

  it("pre-fills filespace and data store IDs", () => {
    const allContent = Object.values(project.files).join("\n");
    assert.ok(allContent.includes("test-fs-id"), "Should pre-fill filespace ID");
    assert.ok(allContent.includes("test-ds-id"), "Should pre-fill data store ID");
  });
});

describe("Filespace browser template", () => {
  const project = generateFilespacesBrowser(3099);

  it("returns files object", () => {
    assert.ok(project.files, "Should return files");
    assert.ok(Object.keys(project.files).length > 0, "Should have at least one file");
  });

  it("includes server.js", () => {
    assert.ok("server.js" in project.files, "Should include server.js");
  });

  it("includes package.json", () => {
    assert.ok("package.json" in project.files, "Should include package.json");
  });

  it("uses Inter font family (not Aeonik)", () => {
    const allContent = Object.values(project.files).join("\n");
    assert.ok(!allContent.includes("Aeonik"), "Should not reference Aeonik");
  });

  it("uses configured port", () => {
    const serverJs = project.files["server.js"];
    assert.ok(serverJs.includes("3099"), "Should use configured port");
  });
});

describe("Search UI template", () => {
  const project = generateSearchUI(3099, 3201);

  it("returns files object with 5 files", () => {
    assert.ok(project.files, "Should return files");
    assert.equal(Object.keys(project.files).length, 5, "Should have 5 files");
  });

  it("includes all required files", () => {
    assert.ok("package.json" in project.files);
    assert.ok("server.js" in project.files);
    assert.ok("public/index.html" in project.files);
    assert.ok("public/style.css" in project.files);
    assert.ok("public/app.js" in project.files);
  });

  it("uses Inter font family (not Aeonik)", () => {
    const allContent = Object.values(project.files).join("\n");
    assert.ok(!allContent.includes("Aeonik"), "Should not reference Aeonik");
    assert.ok(allContent.includes("Inter"), "Should use Inter font");
  });

  it("uses IBM Plex Mono for monospace", () => {
    const allContent = Object.values(project.files).join("\n");
    assert.ok(allContent.includes("IBM Plex Mono"), "Should use IBM Plex Mono");
  });

  it("uses dark theme background", () => {
    const css = project.files["public/style.css"];
    const hasDarkBg = css.includes("#0f1419") || css.includes("#151519");
    assert.ok(hasDarkBg, "Should use dark background (#0f1419 or #151519)");
  });

  it("uses blue accent (#4C8BFF)", () => {
    const css = project.files["public/style.css"];
    assert.ok(css.includes("#4C8BFF"), "Should use blue accent");
  });

  it("proxies to fs-index-server", () => {
    const serverJs = project.files["server.js"];
    assert.ok(serverJs.includes("3201"), "Should proxy to indexer port");
    assert.ok(serverJs.includes("/api/"), "Should proxy API routes");
    assert.ok(serverJs.includes("/sse/search"), "Should proxy SSE search");
  });

  it("uses configured ports", () => {
    const serverJs = project.files["server.js"];
    assert.ok(serverJs.includes("3099"), "Should use configured app port");
    assert.ok(serverJs.includes("3201"), "Should use configured indexer port");
  });

  it("has search functionality", () => {
    const appJs = project.files["public/app.js"];
    assert.ok(appJs.includes("search"), "Should have search logic");
    assert.ok(appJs.includes("/sse/search"), "Should call SSE search endpoint");
    assert.ok(appJs.includes("debounce"), "Should debounce search input");
  });

  it("has browse functionality", () => {
    const appJs = project.files["public/app.js"];
    assert.ok(appJs.includes("/api/files"), "Should call files API for browsing");
    assert.ok(appJs.includes("breadcrumb"), "Should have breadcrumb navigation");
  });

  it("has filespace filter chips", () => {
    const appJs = project.files["public/app.js"];
    assert.ok(appJs.includes("/api/mounts"), "Should load filespace list from mounts");
    assert.ok(appJs.includes("chip"), "Should render filter chips");
  });

  it("has crawl progress display", () => {
    const appJs = project.files["public/app.js"];
    assert.ok(appJs.includes("/api/crawl/stats"), "Should poll crawl stats");
  });

  it("has direct link column", () => {
    const appJs = project.files["public/app.js"];
    assert.ok(appJs.includes("/api/direct-link"), "Should call direct link API");
    assert.ok(appJs.includes("directLink"), "Should have directLink function");
    assert.ok(appJs.includes("copyLink"), "Should have copyLink function");
    const css = project.files["public/style.css"];
    assert.ok(css.includes(".link-btn"), "Should have link button styles");
    assert.ok(css.includes(".copy-btn"), "Should have copy button styles");
  });

  it("includes setup instructions", () => {
    assert.ok(project.instructions.includes("npm install"));
    assert.ok(project.instructions.includes("3099"));
    assert.ok(project.instructions.includes("fs-index-server"));
  });
});
