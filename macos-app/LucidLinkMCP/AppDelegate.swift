import Cocoa
import UserNotifications
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var apiProcess: Process?
    private var apiStatusTimer: Timer?
    private var startApiItem: NSMenuItem!
    private var stopApiItem: NSMenuItem!
    private var helpWindow: NSWindow?

    private let apiPort = 3003
    private let configPath: String = {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/Library/Application Support/Claude/claude_desktop_config.json"
    }()

    private var bundlePath: String { Bundle.main.bundlePath }
    private var nodePath: String { "\(bundlePath)/Contents/Resources/node" }
    private var apiDir: String { "\(bundlePath)/Contents/Resources/api" }
    private var mainJsPath: String { "\(apiDir)/main.js" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        clearQuarantine()
        setupMenuBar()
        requestNotificationPermission()
        autoConfigureIfNeeded()
        startApiProcess()
        startHealthPolling()
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopApiProcess()
    }

    // MARK: - Quarantine

    private func clearQuarantine() {
        let resourcesDir = "\(bundlePath)/Contents/Resources"
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/xattr")
        task.arguments = ["-cr", resourcesDir]
        try? task.run()
        task.waitUntilExit()
    }

    // MARK: - Menu Bar

    private func setupMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = makeStatusIcon(filled: false)
        }

        let menu = NSMenu()

        startApiItem = NSMenuItem(title: "Start API", action: #selector(startApiClicked), keyEquivalent: "")
        stopApiItem = NSMenuItem(title: "Stop API", action: #selector(stopApiClicked), keyEquivalent: "")
        stopApiItem.isHidden = true

        menu.addItem(startApiItem)
        menu.addItem(stopApiItem)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Configure Claude Desktop", action: #selector(configureClaude), keyEquivalent: "c"))
        menu.addItem(NSMenuItem(title: "Check API Status", action: #selector(checkApiStatus), keyEquivalent: "s"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "About LucidLink MCP", action: #selector(showAbout), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Help", action: #selector(showHelp), keyEquivalent: "h"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))
        statusItem.menu = menu
    }

    // MARK: - API Lifecycle

    @objc private func startApiClicked() {
        startApiProcess()
    }

    @objc private func stopApiClicked() {
        stopApiProcess()
        updateStatusIcon(healthy: false)
    }

    private func startApiProcess() {
        // Don't start if already running
        if apiProcess?.isRunning == true { return }

        let node = nodePath
        let mainJs = mainJsPath
        let cwd = apiDir

        guard FileManager.default.fileExists(atPath: node) else {
            showAlert(title: "Error", message: "Bundled Node.js not found at:\n\(node)")
            return
        }
        guard FileManager.default.fileExists(atPath: mainJs) else {
            showAlert(title: "Error", message: "LucidLink API not found at:\n\(mainJs)")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [mainJs]
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
        process.environment = ProcessInfo.processInfo.environment.merging(
            ["LUCID_API_PORT": String(apiPort)],
            uniquingKeysWith: { _, new in new }
        )

        // Discard stdout/stderr (API is a background service)
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.updateStatusIcon(healthy: false)
                self?.updateMenuItems(running: false)
            }
        }

        do {
            try process.run()
            apiProcess = process
            updateMenuItems(running: true)
        } catch {
            showAlert(title: "Error", message: "Failed to start API:\n\(error.localizedDescription)")
        }
    }

    private func stopApiProcess() {
        guard let process = apiProcess, process.isRunning else { return }
        process.terminate()
        apiProcess = nil
        updateMenuItems(running: false)
    }

    private func updateMenuItems(running: Bool) {
        startApiItem.isHidden = running
        stopApiItem.isHidden = !running
    }

    // MARK: - Health Polling

    private func startHealthPolling() {
        apiStatusTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.pollHealth()
        }
    }

    private func pollHealth() {
        let url = URL(string: "http://localhost:\(apiPort)/api/v1/health")!
        let task = URLSession.shared.dataTask(with: url) { [weak self] _, response, _ in
            let healthy = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                self?.updateStatusIcon(healthy: healthy)
                self?.updateMenuItems(running: healthy)
            }
        }
        task.resume()
    }

    // MARK: - Auto-configure on first launch

    private func autoConfigureIfNeeded() {
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: "hasConfigured") {
            if mergeClaudeConfig() {
                defaults.set(true, forKey: "hasConfigured")
                sendNotification(
                    title: "Claude Desktop Configured",
                    body: "Restart Claude Desktop to activate LucidLink MCP servers."
                )
            }
        }
    }

    // MARK: - Claude Desktop Config

    @objc private func configureClaude() {
        if mergeClaudeConfig() {
            showAlert(title: "Configuration Updated",
                      message: "Claude Desktop config updated. Restart Claude Desktop to apply.")
            UserDefaults.standard.set(true, forKey: "hasConfigured")
        }
    }

    private func mergeClaudeConfig() -> Bool {
        // Read server list from manifest (single source of truth)
        let manifestPath = "\(bundlePath)/Contents/Resources/mcp-servers.json"
        let mcpDir = "\(bundlePath)/Contents/Resources/mcp"
        var servers: [String: Any] = [:]

        if let data = FileManager.default.contents(atPath: manifestPath),
           let entries = try? JSONSerialization.jsonObject(with: data) as? [[String: String]] {
            for entry in entries {
                if let name = entry["name"], let script = entry["script"] {
                    servers[name] = [
                        "command": nodePath,
                        "args": ["\(mcpDir)/\(script)"]
                    ]
                }
            }
        } else {
            showAlert(title: "Error", message: "Cannot read mcp-servers.json manifest")
            return false
        }

        let mcpEntry: [String: Any] = ["mcpServers": servers]

        let configDir = (configPath as NSString).deletingLastPathComponent
        let fm = FileManager.default

        if !fm.fileExists(atPath: configDir) {
            do {
                try fm.createDirectory(atPath: configDir, withIntermediateDirectories: true)
            } catch {
                showAlert(title: "Error", message: "Cannot create config directory: \(error.localizedDescription)")
                return false
            }
        }

        var config: [String: Any] = [:]
        if fm.fileExists(atPath: configPath),
           let data = fm.contents(atPath: configPath),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            config = json
        }

        var existingServers = config["mcpServers"] as? [String: Any] ?? [:]
        let newServers = mcpEntry["mcpServers"] as! [String: Any]
        for (key, value) in newServers {
            existingServers[key] = value
        }
        config["mcpServers"] = existingServers

        do {
            let data = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: URL(fileURLWithPath: configPath))
            return true
        } catch {
            showAlert(title: "Error", message: "Failed to write config: \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - API Status (manual check)

    @objc private func checkApiStatus() {
        let url = URL(string: "http://localhost:\(apiPort)/api/v1/health")!
        let task = URLSession.shared.dataTask(with: url) { [weak self] _, response, error in
            DispatchQueue.main.async {
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    self?.updateStatusIcon(healthy: true)
                    let port = self?.apiPort ?? 3003
                    self?.showAlert(title: "API Status",
                        message: "LucidLink API is running (healthy).\n\nBase URL:  http://localhost:\(port)\nAPI Docs:  http://localhost:\(port)/api/v1/docs",
                        minWidth: 340)
                } else {
                    self?.updateStatusIcon(healthy: false)
                    let detail = error?.localizedDescription ?? "Not reachable"
                    self?.showAlert(title: "API Status", message: "LucidLink API is not running.\n\(detail)")
                }
            }
        }
        task.resume()
    }

    private func updateStatusIcon(healthy: Bool) {
        statusItem.button?.image = makeStatusIcon(filled: healthy)
    }

    private func makeStatusIcon(filled: Bool) -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let img = NSImage(size: size, flipped: false) { rect in
            let dotSize: CGFloat = 10
            let dotRect = NSRect(
                x: (rect.width - dotSize) / 2,
                y: (rect.height - dotSize) / 2,
                width: dotSize,
                height: dotSize
            )
            let path = NSBezierPath(ovalIn: dotRect)
            // Dark warm purple
            let purple = NSColor(red: 0.38, green: 0.08, blue: 0.60, alpha: 1.0) // #61149A
            if filled {
                purple.setFill()
                path.fill()
            } else {
                purple.setStroke()
                path.lineWidth = 1.5
                path.stroke()
            }
            return true
        }
        img.isTemplate = false
        return img
    }

    // MARK: - About

    @objc private func showAbout() {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        showAlert(title: "LucidLink MCP", message: "Version \(version)\nMCP servers and bundled LucidLink API for Claude Desktop.\n\nThe LucidLink API is normally deployed as a Docker container.\nThis app bundles it as a native process for local convenience.")
    }

    // MARK: - Help

    @objc private func showHelp() {
        if let existing = helpWindow, existing.isVisible {
            existing.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 540, height: 520),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "LucidLink MCP Help"
        window.minSize = NSSize(width: 400, height: 300)
        window.center()
        window.isReleasedWhenClosed = false

        let config = WKWebViewConfiguration()
        config.preferences.isElementFullscreenEnabled = false
        config.mediaTypesRequiringUserActionForPlayback = .all
        let webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")

        let html = """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <style>
            :root { color-scheme: light dark; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
                font-size: 13px;
                line-height: 1.5;
                color: var(--text);
                padding: 28px 32px 40px;
                --text: #1d1d1f;
                --dim: #86868b;
                --accent: #0071e3;
                --border: #d2d2d7;
                --card-bg: rgba(0,0,0,0.03);
                --code-bg: rgba(0,0,0,0.05);
                --kbd-bg: #f5f5f7;
            }
            @media (prefers-color-scheme: dark) {
                body {
                    --text: #f5f5f7;
                    --dim: #86868b;
                    --accent: #2997ff;
                    --border: #424245;
                    --card-bg: rgba(255,255,255,0.05);
                    --code-bg: rgba(255,255,255,0.08);
                    --kbd-bg: #2a2a2c;
                }
            }
            h2 {
                font-size: 16px;
                font-weight: 600;
                color: var(--text);
                margin: 24px 0 8px;
                padding-bottom: 6px;
                border-bottom: 1px solid var(--border);
            }
            h2:first-child { margin-top: 0; }
            p { margin: 6px 0; color: var(--text); }
            .dim { color: var(--dim); font-size: 12px; }
            .card {
                background: var(--card-bg);
                border-radius: 8px;
                padding: 12px 16px;
                margin: 10px 0;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin: 8px 0;
            }
            td {
                padding: 4px 0;
                vertical-align: top;
            }
            td:first-child {
                white-space: nowrap;
                padding-right: 16px;
                font-weight: 500;
            }
            td:last-child { color: var(--dim); }
            .icon-row td:first-child {
                font-size: 16px;
                width: 28px;
                text-align: center;
            }
            ol {
                margin: 6px 0 6px 20px;
                color: var(--text);
            }
            ol li { margin: 2px 0; }
            code {
                font-family: "SF Mono", Menlo, monospace;
                font-size: 11.5px;
                background: var(--code-bg);
                padding: 1px 5px;
                border-radius: 4px;
            }
            kbd {
                font-family: -apple-system, sans-serif;
                font-size: 11px;
                background: var(--kbd-bg);
                border: 1px solid var(--border);
                border-radius: 4px;
                padding: 1px 6px;
            }
            .menu-item { margin: 10px 0; }
            .menu-item strong { display: block; margin-bottom: 2px; }
            .trouble-item { margin: 10px 0; }
            .trouble-item strong {
                display: block;
                margin-bottom: 2px;
                color: var(--text);
            }
            .trouble-item p { color: var(--dim); font-size: 12px; margin: 0; }
        </style>
        </head>
        <body>

        <h2>Getting Started</h2>
        <p>LucidLink MCP provides five MCP servers and a bundled LucidLink API for Claude Desktop:</p>
        <div class="card">
            <table>
                <tr><td>Admin API</td><td>Manage filespaces, members, groups, and permissions (30 tools + API docs search)</td></tr>
                <tr><td>Connect API</td><td>Manage data stores, entries, and S3 workflows via LucidLink Connect</td></tr>
                <tr><td>Filespace Search</td><td>Full-text search across indexed filespaces with a generated web UI</td></tr>
                <tr><td>Filespace Browser</td><td>Generate a web-based filespace browser for navigating mounted filespaces</td></tr>
                <tr><td>Audit Trail</td><td>File operation analytics &mdash; deploy OpenSearch stack, query events, set up alerts and Slack notifications (15 tools)</td></tr>
            </table>
        </div>

        <h2>About the Bundled API</h2>
        <p>The LucidLink API is normally deployed as a <strong>self-hosted Docker container</strong> (<code>lucidlink/lucidlink-api</code>) that customers run on their own infrastructure. This is the standard, production deployment model.</p>
        <p>This macOS app bundles the same API as a <strong>native Node.js process</strong> for local convenience &mdash; no Docker required. The bundled version is functionally identical to the container version.</p>
        <p class="dim">For production deployments, scaling, and best practices, ask Claude to <code>search_api_docs</code> or see the LucidLink support documentation.</p>

        <h2>First Launch</h2>
        <p>On first launch, the app automatically:</p>
        <ol>
            <li>Starts the bundled LucidLink API on port <code>\(apiPort)</code></li>
            <li>Configures Claude Desktop with all five MCP server entries</li>
            <li>Shows a notification to restart Claude Desktop</li>
        </ol>
        <p class="dim">After restarting Claude Desktop, the MCP tools will be available.</p>

        <h2>Filespace Search</h2>
        <p>The Search MCP server works with <strong>fs-index-server</strong>, a Go binary that crawls and indexes mounted LucidLink filespaces using SQLite FTS5.</p>
        <div class="card">
            <table>
                <tr><td>Search UI</td><td>Ask Claude to <em>"build a search UI"</em> &mdash; generates a full web app at <code>localhost:3099</code></td></tr>
                <tr><td>Features</td><td>Full-text search, directory browsing, breadcrumb navigation, direct links to files</td></tr>
                <tr><td>Direct Links</td><td>Each file and folder has a direct link button that opens the LucidLink web URL</td></tr>
                <tr><td>Indexer</td><td>fs-index-server runs on port <code>3201</code>, auto-discovers all mounted filespaces</td></tr>
            </table>
        </div>

        <h2>Audit Trail Analytics</h2>
        <p>The Audit Trail MCP server manages a Docker Compose stack (OpenSearch + Dashboards + Fluent Bit) that indexes file operation events from LucidLink filespaces.</p>
        <div class="card">
            <table>
                <tr><td>Setup</td><td>Ask Claude to <em>"set up audit trail for my filespace"</em> &mdash; configures and starts the stack</td></tr>
                <tr><td>Dashboard</td><td>OpenSearch Dashboards at <code>localhost:5601</code> with pre-built visualizations</td></tr>
                <tr><td>Queries</td><td>Search events by user, action, path, and time range directly through Claude</td></tr>
                <tr><td>Alerting</td><td>Create monitors for specific events (e.g., file deletions) with optional Slack notifications</td></tr>
                <tr><td>Requires</td><td>Docker Desktop running. The filespace must be mounted with <code>.lucid_audit</code> logs enabled.</td></tr>
            </table>
        </div>

        <h2>Menu Bar Icon</h2>
        <div class="card">
            <table class="icon-row">
                <tr><td>&#9679;</td><td>Filled circle &mdash; API is running and healthy</td></tr>
                <tr><td>&#9675;</td><td>Empty circle &mdash; API is not running or unreachable</td></tr>
            </table>
        </div>

        <h2>Menu Items</h2>
        <div class="menu-item">
            <strong>Start / Stop API</strong>
            <span class="dim">Manually control the LucidLink API process. The API starts automatically on app launch.</span>
        </div>
        <div class="menu-item">
            <strong>Configure Claude Desktop</strong>
            <span class="dim">Writes all five MCP server entries into Claude Desktop's config. Preserves your other MCP servers. Use this after moving the app or updating.</span>
        </div>
        <div class="menu-item">
            <strong>Check API Status</strong>
            <span class="dim">Performs a health check against <code>localhost:\(apiPort)</code>.</span>
        </div>

        <h2>Authentication</h2>
        <p>MCP tools that require authentication will prompt you to provide your LucidLink credentials through Claude Desktop. Tokens are stored securely in the macOS Keychain.</p>

        <h2>Troubleshooting</h2>
        <div class="trouble-item">
            <strong>API won't start</strong>
            <p>Check that the app bundle is intact and contains <code>Contents/Resources/api/main.js</code> and <code>WasmModule.wasm</code>.</p>
        </div>
        <div class="trouble-item">
            <strong>Claude Desktop doesn't see the MCP servers</strong>
            <p>Click <strong>Configure Claude Desktop</strong> from the menu and restart Claude Desktop.</p>
        </div>
        <div class="trouble-item">
            <strong>"API returned 502" error</strong>
            <p>The API is still starting up. Wait a few seconds and retry. If it persists, stop and restart the API from the menu.</p>
        </div>
        <div class="trouble-item">
            <strong>Search UI shows "No filespaces mounted"</strong>
            <p>Ensure LucidLink filespaces are mounted and fs-index-server is running on port <code>3201</code>. The indexer auto-discovers mounts via <code>lucid list</code>.</p>
        </div>
        <div class="trouble-item">
            <strong>App blocked by macOS Gatekeeper</strong>
            <p>Right-click the app and select <strong>Open</strong>, then confirm. The app clears quarantine flags automatically on launch.</p>
        </div>

        </body>
        </html>
        """

        webView.loadHTMLString(html, baseURL: nil)
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        helpWindow = window
    }

    // MARK: - Quit

    @objc private func quit() {
        stopApiProcess()
        NSApplication.shared.terminate(nil)
    }

    // MARK: - Helpers

    private func showAlert(title: String, message: String, minWidth: CGFloat = 0) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .informational
        if minWidth > 0 {
            let spacer = NSView(frame: NSRect(x: 0, y: 0, width: minWidth, height: 0))
            alert.accessoryView = spacer
        }
        alert.runModal()
    }

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { _, _ in }
    }

    private func sendNotification(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}

// MARK: - Entry Point

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
