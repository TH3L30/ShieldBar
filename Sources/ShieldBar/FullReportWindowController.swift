import AppKit
import WebKit

@MainActor
final class FullReportWindowController: NSWindowController, NSToolbarDelegate, WKNavigationDelegate, WKUIDelegate {
    private static let reportURL = URL(string: "https://browserleaks.com/ip")!

    private let webView: WKWebView
    private let progressIndicator = NSProgressIndicator()

    init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(
            frame: NSRect(x: 0, y: 0, width: 1080, height: 820),
            configuration: configuration
        )

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1080, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "BrowserLeaks Report"
        window.subtitle = "browserleaks.com/ip"
        window.minSize = NSSize(width: 720, height: 500)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.titlebarAppearsTransparent = false

        self.webView = webView
        super.init(window: window)

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true

        configureContent(in: window)
        configureToolbar(for: window)

        if UserDefaults.standard.object(forKey: "NSWindow Frame ShieldBar.FullReport") == nil {
            window.center()
        }
        window.setFrameAutosaveName("ShieldBar.FullReport")

        loadReport()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func present() {
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }

        if !webView.isLoading {
            if webView.url == nil {
                loadReport()
            } else {
                webView.reload()
            }
        }
    }

    private func configureContent(in window: NSWindow) {
        let container = NSView(frame: window.contentLayoutRect)
        container.autoresizingMask = [.width, .height]

        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)

        progressIndicator.style = .bar
        progressIndicator.isIndeterminate = true
        progressIndicator.controlSize = .small
        progressIndicator.isDisplayedWhenStopped = false
        progressIndicator.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(progressIndicator)

        NSLayoutConstraint.activate([
            progressIndicator.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            progressIndicator.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            progressIndicator.topAnchor.constraint(equalTo: container.topAnchor),
            progressIndicator.heightAnchor.constraint(equalToConstant: 3)
        ])

        window.contentView = container
    }

    private func configureToolbar(for window: NSWindow) {
        let toolbar = NSToolbar(identifier: "ShieldBar.ReportToolbar")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        window.toolbarStyle = .unified
    }

    private func loadReport() {
        webView.load(
            URLRequest(
                url: Self.reportURL,
                cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
                timeoutInterval: 30
            )
        )
    }

    private func setLoading(_ loading: Bool) {
        if loading {
            progressIndicator.startAnimation(nil)
            window?.subtitle = "Loading…"
        } else {
            progressIndicator.stopAnimation(nil)
            window?.subtitle = "browserleaks.com/ip"
        }
    }

    @objc private func reloadPage(_ sender: Any?) {
        if webView.isLoading {
            webView.stopLoading()
        }
        webView.reload()
    }

    @objc private func openInSafari(_ sender: Any?) {
        NSWorkspace.shared.open(webView.url ?? Self.reportURL)
    }

    // MARK: - NSToolbarDelegate

    func toolbar(
        _ toolbar: NSToolbar,
        itemForItemIdentifier itemIdentifier: NSToolbarItem.Identifier,
        willBeInsertedIntoToolbar flag: Bool
    ) -> NSToolbarItem? {
        switch itemIdentifier {
        case .reportReload:
            let item = NSToolbarItem(itemIdentifier: itemIdentifier)
            item.label = "Reload"
            item.paletteLabel = "Reload"
            item.toolTip = "Reload the BrowserLeaks report"
            item.image = NSImage(
                systemSymbolName: "arrow.clockwise",
                accessibilityDescription: "Reload"
            )
            item.target = self
            item.action = #selector(reloadPage(_:))
            return item

        case .reportOpenInSafari:
            let item = NSToolbarItem(itemIdentifier: itemIdentifier)
            item.label = "Open in Safari"
            item.paletteLabel = "Open in Safari"
            item.toolTip = "Open this report in your default browser"
            item.image = NSImage(
                systemSymbolName: "safari",
                accessibilityDescription: "Open in Safari"
            )
            item.target = self
            item.action = #selector(openInSafari(_:))
            return item

        default:
            return nil
        }
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.reportReload, .flexibleSpace, .reportOpenInSafari]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.reportReload, .flexibleSpace, .space, .reportOpenInSafari]
    }

    // MARK: - WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if url.scheme == "about" {
            decisionHandler(.allow)
            return
        }

        if url.scheme == "https",
           let host = url.host,
           host == "browserleaks.com" || host.hasSuffix(".browserleaks.com") {
            decisionHandler(.allow)
            return
        }

        if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        setLoading(true)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        setLoading(false)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        setLoading(false)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        setLoading(false)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        setLoading(false)
        webView.reload()
    }

    // MARK: - WKUIDelegate

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.deny)
    }
}

private extension NSToolbarItem.Identifier {
    static let reportReload = NSToolbarItem.Identifier("ShieldBar.Report.Reload")
    static let reportOpenInSafari = NSToolbarItem.Identifier("ShieldBar.Report.OpenInSafari")
}
