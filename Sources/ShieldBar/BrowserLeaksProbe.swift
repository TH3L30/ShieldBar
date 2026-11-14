import AppKit
import Foundation
import ShieldBarCore
import WebKit

enum ProbeError: LocalizedError {
    case busy
    case timedOut
    case pageDidNotLoad
    case navigation(String)
    case webContentTerminated

    var errorDescription: String? {
        switch self {
        case .busy:
            return "A BrowserLeaks check is already running."
        case .timedOut:
            return "The BrowserLeaks check timed out."
        case .pageDidNotLoad:
            return "BrowserLeaks did not return the expected IP data. The site may be unavailable or its layout may have changed."
        case .navigation(let message):
            return "Could not load BrowserLeaks: \(message)"
        case .webContentTerminated:
            return "The WebKit process running the BrowserLeaks page stopped unexpectedly."
        }
    }
}

@MainActor
final class BrowserLeaksProbe: NSObject, WKNavigationDelegate, WKUIDelegate {
    private final class Session: @unchecked Sendable {
        let webView: WKWebView
        let window: NSWindow
        let completion: (Result<BrowserLeaksReport, Error>) -> Void
        let startedAt: Date
        var loadedAt: Date?
        var pollTimer: Timer?
        var timeoutTimer: Timer?
        var lastPayload: ProbePayload?
        var finished = false

        init(
            webView: WKWebView,
            window: NSWindow,
            completion: @escaping (Result<BrowserLeaksReport, Error>) -> Void
        ) {
            self.webView = webView
            self.window = window
            self.completion = completion
            self.startedAt = Date()
        }
    }

    private struct ProbePayload: Decodable {
        struct Address: Decodable {
            let address: String
            let country: String?
            let countryCode: String?
        }

        let readyState: String?
        let pageIPv4: String?
        let pageIPv4CountryCode: String?
        let pageIPv6: String?
        let countryCode: String?
        let country: String?
        let region: String?
        let city: String?
        let isp: String?
        let organization: String?
        let rtcSupported: Bool?
        let rtcLocalText: String?
        let rtcPublicText: String?
        let rtcLocal: [Address]?
        let rtcPublic: [Address]?
        let rtcLocalLoading: Bool?
        let rtcPublicLoading: Bool?
        let rtcLeakText: String?
        let rtcMismatchText: String?
    }

    private var activeSession: Session?
    private var running = false

    func probe() async throws -> BrowserLeaksReport {
        try await withCheckedThrowingContinuation { continuation in
            start { result in
                continuation.resume(with: result)
            }
        }
    }

    private func start(completion: @escaping (Result<BrowserLeaksReport, Error>) -> Void) {
        guard !running else {
            completion(.failure(ProbeError.busy))
            return
        }
        running = true

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(
            frame: NSRect(x: 0, y: 0, width: 960, height: 900),
            configuration: configuration
        )
        webView.navigationDelegate = self
        webView.uiDelegate = self

        let window = NSWindow(
            contentRect: NSRect(x: -20_000, y: -20_000, width: 960, height: 900),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.contentView = webView
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.isReleasedWhenClosed = false
        window.collectionBehavior = [.transient, .ignoresCycle]

        let session = Session(webView: webView, window: window, completion: completion)
        activeSession = session

        let timeout = Timer(timeInterval: 36, repeats: false) { [weak self, weak session] _ in
            Task { @MainActor [weak self, weak session] in
                guard let self, let session else { return }
                self.handleTimeout(for: session)
            }
        }
        session.timeoutTimer = timeout
        RunLoop.main.add(timeout, forMode: .common)

        window.orderFront(nil)
        webView.load(
            URLRequest(
                url: URL(string: "https://browserleaks.com/ip")!,
                cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
                timeoutInterval: 30
            )
        )
    }

    private func startPolling(for session: Session) {
        session.pollTimer?.invalidate()
        let timer = Timer(timeInterval: 0.45, repeats: true) { [weak self, weak session] _ in
            Task { @MainActor [weak self, weak session] in
                guard let self, let session else { return }
                self.poll(session)
            }
        }
        session.pollTimer = timer
        RunLoop.main.add(timer, forMode: .common)
        poll(session)
    }

    private func poll(_ session: Session) {
        guard !session.finished else { return }
        session.webView.evaluateJavaScript(Self.extractionJavaScript) { [weak self, weak session] result, _ in
            guard let self, let session, !session.finished else { return }
            guard
                let json = result as? String,
                let data = json.data(using: .utf8),
                let payload = try? JSONDecoder().decode(ProbePayload.self, from: data)
            else {
                return
            }

            session.lastPayload = payload

            if self.shouldFinish(payload, session: session) {
                guard let report = self.makeReport(
                    from: payload,
                    session: session,
                    completed: self.isWebRTCFinal(payload)
                ) else {
                    self.finish(session, with: .failure(ProbeError.pageDidNotLoad))
                    return
                }
                self.finish(session, with: .success(report))
            }
        }
    }

    private func shouldFinish(_ payload: ProbePayload, session: Session) -> Bool {
        guard payload.readyState == "complete", let loadedAt = session.loadedAt else {
            return false
        }
        let elapsed = Date().timeIntervalSince(loadedAt)
        let hasPageIP = !(payload.pageIPv4 ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        guard hasPageIP else { return false }

        if payload.rtcSupported == false {
            return elapsed >= 1.0
        }

        let loading = (payload.rtcLocalLoading ?? false) || (payload.rtcPublicLoading ?? false)
        if loading { return false }

        if isWebRTCFinal(payload) {
            // The STUN test usually needs a moment even after the rows settle.
            return elapsed >= 1.2
        }

        // The page has loaded but the WebRTC test never produced a final
        // public-IP row. Return an incomplete report rather than guessing.
        return elapsed >= 8.0
    }

    /// The test is only considered complete when both WebRTC cells have final
    /// values (a local cell may legitimately say "n/a") and neither row is
    /// still animating. The IP page does not always render the separate
    /// leak-verdict row, so that row is optional here; the strict evaluator
    /// still decides the verdict.
    private func isWebRTCFinal(_ payload: ProbePayload) -> Bool {
        let localText = payload.rtcLocalText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let publicText = payload.rtcPublicText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let loading = (payload.rtcLocalLoading ?? false) || (payload.rtcPublicLoading ?? false)
        return !localText.isEmpty && !publicText.isEmpty && !loading
    }

    private func handleTimeout(for session: Session) {
        guard !session.finished else { return }
        if let payload = session.lastPayload,
           let report = makeReport(from: payload, session: session, completed: false) {
            finish(session, with: .success(report))
        } else {
            finish(session, with: .failure(ProbeError.timedOut))
        }
    }

    private func makeReport(
        from payload: ProbePayload,
        session: Session,
        completed: Bool
    ) -> BrowserLeaksReport? {
        guard
            let rawIPv4 = payload.pageIPv4?.trimmingCharacters(in: .whitespacesAndNewlines),
            !rawIPv4.isEmpty,
            !isPlaceholder(rawIPv4)
        else {
            return nil
        }

        let countryCode = normalizedCountryCode(payload.countryCode ?? payload.pageIPv4CountryCode)
        let local = (payload.rtcLocal ?? []).compactMap { value -> WebRTCAddress? in
            let address = value.address.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !address.isEmpty, !isPlaceholder(address) else { return nil }
            return WebRTCAddress(
                address: address,
                country: trimmed(payload: value.country),
                countryCode: normalizedCountryCode(value.countryCode)
            )
        }
        let publicAddresses = (payload.rtcPublic ?? []).compactMap { value -> WebRTCAddress? in
            let address = value.address.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !address.isEmpty, !isPlaceholder(address) else { return nil }
            return WebRTCAddress(
                address: address,
                country: trimmed(payload: value.country),
                countryCode: normalizedCountryCode(value.countryCode)
            )
        }

        return BrowserLeaksReport(
            pageIPv4: rawIPv4,
            pageIPv6: sanitizedAddress(payload.pageIPv6),
            countryCode: countryCode,
            country: cleanedCountry(payload.country, code: countryCode),
            region: trimmed(payload: payload.region),
            city: trimmed(payload: payload.city),
            isp: trimmed(payload: payload.isp),
            organization: trimmed(payload: payload.organization),
            rtcSupported: payload.rtcSupported ?? false,
            rtcTestCompleted: completed,
            rtcLocal: local,
            rtcPublic: publicAddresses,
            rtcLocalText: trimmed(payload: payload.rtcLocalText),
            rtcPublicText: trimmed(payload: payload.rtcPublicText),
            rtcLeakText: trimmed(payload: payload.rtcLeakText),
            rtcMismatchText: trimmed(payload: payload.rtcMismatchText),
            checkedAt: Date(),
            duration: Date().timeIntervalSince(session.startedAt)
        )
    }

    private func finish(_ session: Session, with result: Result<BrowserLeaksReport, Error>) {
        guard !session.finished else { return }
        session.finished = true
        session.pollTimer?.invalidate()
        session.timeoutTimer?.invalidate()
        session.webView.stopLoading()
        session.webView.navigationDelegate = nil
        session.webView.uiDelegate = nil
        session.window.orderOut(nil)
        session.window.contentView = nil
        session.window.close()
        activeSession = nil
        running = false
        session.completion(result)
    }

    private func isPlaceholder(_ value: String) -> Bool {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalized == "n/a" || normalized == "-" || normalized == "−" || normalized == "unknown"
    }

    private func sanitizedAddress(_ value: String?) -> String? {
        guard let value = trimmed(payload: value), !isPlaceholder(value) else { return nil }
        return value
    }

    private func trimmed(payload value: String?) -> String? {
        guard let value else { return nil }
        let result = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? nil : result
    }

    private func normalizedCountryCode(_ value: String?) -> String? {
        guard let value else { return nil }
        let code = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard code.count == 2, code.range(of: #"^[A-Z]{2}$"#, options: .regularExpression) != nil else {
            return nil
        }
        return code
    }

    private func cleanedCountry(_ value: String?, code: String?) -> String? {
        guard var value = trimmed(payload: value) else { return nil }
        if let code {
            value = value.replacingOccurrences(
                of: #"\s*\(\#(code)\)\s*$"#,
                with: "",
                options: .regularExpression
            )
        }
        value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if url.scheme == "about" {
            decisionHandler(.allow)
            return
        }

        if url.scheme == "https", let host = url.host, (host == "browserleaks.com" || host.hasSuffix(".browserleaks.com")) {
            decisionHandler(.allow)
            return
        }

        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let session = activeSession, webView === session.webView, !session.finished else { return }
        if session.loadedAt == nil {
            session.loadedAt = Date()
            startPolling(for: session)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard let session = activeSession, webView === session.webView, !session.finished else { return }
        finish(session, with: .failure(ProbeError.navigation(error.localizedDescription)))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard let session = activeSession, webView === session.webView, !session.finished else { return }
        finish(session, with: .failure(ProbeError.navigation(error.localizedDescription)))
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard let session = activeSession, webView === session.webView, !session.finished else { return }
        finish(session, with: .failure(ProbeError.webContentTerminated))
    }

    // MARK: - WKUIDelegate

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        nil
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

    // MARK: - Page extraction

    private static let extractionJavaScript = #"""
    (() => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();

      const rowValue = (label) => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const row = rows.find((candidate) => {
          return candidate.cells &&
            candidate.cells.length >= 2 &&
            clean(candidate.cells[0].innerText) === label;
        });
        return row ? clean(row.cells[1].innerText) : null;
      };

      const readAddresses = (selector) => {
        const element = document.querySelector(selector);
        if (!element) {
          return { present: false, text: null, addresses: [] };
        }

        const text = clean(element.innerText);
        let addresses = Array.from(element.querySelectorAll('.flag-container')).map((container) => {
          const img = container.querySelector('img');
          const flagText = container.querySelector('.flag-text');
          return {
            address: clean(flagText ? flagText.innerText : container.innerText),
            country: img ? img.getAttribute('title') : null,
            countryCode: img ? img.getAttribute('alt') : null
          };
        }).filter((entry) => entry.address.length > 0);

        if (addresses.length === 0) {
          const direct = clean(element.innerText);
          const lower = direct.toLowerCase();
          if (direct && lower !== 'n/a' && lower !== '-' && lower !== 'unknown') {
            addresses = [{ address: direct, country: null, countryCode: null }];
          }
        }

        return { present: true, text, addresses };
      };

      const ipv4Element = document.querySelector('#client-ipv4');
      const ipv6 = readAddresses('#client-ipv6');
      const local = readAddresses('#rtc-local');
      const publicWebRTC = readAddresses('#rtc-public');
      const leakRow = document.querySelector('#rtc-leak');
      const mismatchRow = document.querySelector('.rtc-leak-tr');
      const lookupFlag = document.querySelector('#lookup-flag');

      const parentIsLoading = (selector) => {
        const element = document.querySelector(selector);
        return Boolean(element && element.parentElement && element.parentElement.classList.contains('load-td'));
      };

      return JSON.stringify({
        readyState: document.readyState,
        pageIPv4: ipv4Element ? (ipv4Element.dataset.ip || clean(ipv4Element.innerText)) : null,
        pageIPv4CountryCode: ipv4Element ? (ipv4Element.dataset.iso_code || null) : null,
        pageIPv6: ipv6.addresses.length > 0 ? ipv6.addresses[0].address : null,
        countryCode: lookupFlag ? (lookupFlag.dataset.iso_code || null) : (ipv4Element ? (ipv4Element.dataset.iso_code || null) : null),
        country: rowValue('Country') || (lookupFlag ? clean(lookupFlag.innerText) : null),
        region: rowValue('State/Region'),
        city: rowValue('City'),
        isp: rowValue('ISP'),
        organization: rowValue('Organization'),
        rtcSupported: typeof RTCPeerConnection === 'function',
        rtcLocalText: local.text,
        rtcPublicText: publicWebRTC.text,
        rtcLocal: local.addresses,
        rtcPublic: publicWebRTC.addresses,
        rtcLocalLoading: parentIsLoading('#rtc-local'),
        rtcPublicLoading: parentIsLoading('#rtc-public'),
        rtcLeakText: leakRow ? clean(leakRow.innerText) : null,
        rtcMismatchText: mismatchRow ? clean(mismatchRow.innerText) : null
      });
    })()
    """#
}
