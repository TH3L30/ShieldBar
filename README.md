# ShieldBar

A tray/menu-bar app that shows your public IP details and checks whether the
system's WebRTC path leaks a different public IP or a local/private IP.

The native macOS app is the primary implementation. A separate Electron
implementation for Windows and Linux lives in [`desktop/`](desktop/README.md)
and follows the same strict status rules, probe, cadence, and privacy model.

Data comes from <https://browserleaks.com/ip>. ShieldBar is an independent
project and is not affiliated with BrowserLeaks.

## Windows and Linux

The Windows/Linux build is an Electron + TypeScript tray app:

- **Windows x64:** NSIS installer and portable zip
- **Linux x64:** AppImage and `.deb`
- Summary popover, full BrowserLeaks report window, and leak-only notifications
- In-memory probe session with no IP history or telemetry

See [`desktop/README.md`](desktop/README.md) for build, test, packaging, and
platform caveats. The WebRTC check there runs in bundled Chromium rather than
WebKit, so it reflects Chromium's WebRTC stack on the same system network path,
not another browser's private stack.

## Screenshots

<p align="center">
  <img src="docs/screenshots/macos/dashboard-clear.png" width="280" alt="ShieldBar on macOS">
  <img src="docs/screenshots/windows/dashboard-clear.png" width="280" alt="ShieldBar on Windows">
  <img src="docs/screenshots/linux/dashboard-clear.png" width="280" alt="ShieldBar on Linux">
</p>

<p align="center"><em>macOS (native) · Windows · Linux — all showing a Clear result</em></p>

See the [screenshot gallery](docs/screenshots/README.md) for public-leak,
local-exposure, welcome, inconclusive, and offline states on every platform.
Screenshots use documentation-only IP ranges and contain no real data.

## What it shows

Click the shield in the menu bar to open the summary card:

- **Public IP** reported by BrowserLeaks, with copy button
- **Location** (country/city, flag when available) and **ISP**
- **IPv6** address when BrowserLeaks detects one
- **WebRTC leak check**: local IP results and the public IP seen through WebRTC
- Time since the last check and the next scheduled check

**Full Report** opens the live BrowserLeaks page in a separate window inside
the app. Navigation there is restricted to `browserleaks.com`; external links
open in the default browser. **Open in Safari** is available from that window's
toolbar.

Right-click the menu-bar icon for Refresh, Full Report, notification settings,
About, and Quit.

## Status rules

ShieldBar is deliberately strict. Green is shown only when all of these hold:

1. The BrowserLeaks page completed and returned a public IPv4 address.
2. The WebRTC test completed with a final public candidate.
3. Every WebRTC public address matches the page's public address (IPv4 and
   IPv6 are normalized before comparison).
4. No local/private WebRTC address is exposed.

| Status | Meaning |
| --- | --- |
| **Clear** (green) | WebRTC public IP matches BrowserLeaks and no local IP is exposed. |
| **Public IP leak** (red) | WebRTC sees a different public IP than the page. Takes precedence over local exposure. |
| **Local IP exposed** (amber) | Public IPs match, but a private/local WebRTC address is visible. |
| **Inconclusive** (amber) | The test was blocked, unsupported, timed out, or returned incomplete data. Never shown as green. |
| **Offline** (gray) | BrowserLeaks could not be reached. |
| **Checking** (blue) | A test is running. |
| **Not checked** (gray) | ShieldBar has not completed a check yet. |

Missing data is never treated as success. Notifications fire only when the
status changes to **Public IP leak**, and never contain IP addresses.

## Check cadence

The card's freshness line updates every second so the "next in…" countdown
feels live. That is a **UI heartbeat, not a network test**.

Actual BrowserLeaks checks run:

- immediately at launch and when you click the shield (if the last result is
  older than 8 seconds)
- every **30 seconds** while the popover is open
- every **15 minutes** while ShieldBar is in the background
- every 60 seconds while offline, to detect recovery
- immediately on a network path change or when the Mac wakes

Running a full BrowserLeaks page load every second would be hostile to the
service, wasteful of bandwidth, and would make results less reliable. The
1-second heartbeat is the intended interpretation of "update every second";
the network check stays at the cadence above.

## How the check works

ShieldBar embeds a hidden, borderless `WKWebView` offscreen and loads the real
BrowserLeaks `/ip` page with JavaScript enabled. It waits for the page and
WebRTC rows to settle, then reads the rendered IP, location, ISP, IPv6, and
WebRTC cells from the DOM. There is no private API, scraping proxy, or
third-party analytics service involved.

The probe fails closed: if the expected cells are missing, still loading, or
the page times out, the result is **Inconclusive**, not green.

### WebRTC scope and limits

The WebRTC test runs inside ShieldBar's embedded WebKit view. It exercises the
Mac's system network path and the VPN/proxy routing that WebKit uses, which is
the relevant system-wide check.

It cannot inspect another browser's private WebRTC stack. Chrome, Safari,
Firefox, and other browsers implement their own peer-connection policies and
may behave differently. Use each browser's own leak test if that is what you
need to verify.

BrowserLeaks can change its page layout or be unavailable. ShieldBar reports
those cases as Inconclusive/Offline rather than guessing. This tool is a
convenience check, not a guarantee of anonymity or VPN correctness.

## Privacy

- No analytics, telemetry, accounts, or IP history.
- Non-persistent WebKit data store: cookies, cache, and local storage are
  discarded.
- IP addresses are not written to notifications or application logs.
- The full report window can only navigate within `browserleaks.com`.
- Network access is limited to loading BrowserLeaks pages and its assets.

## Build and install

Requirements:

- macOS on Apple silicon (built and tested as arm64)
- Command Line Tools with Swift 6.x
- The **macOS 26.5 SDK** at
  `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`

The newer macOS 27 SDK available with Command Line Tools declares SwiftUI
property wrappers such as `@State` as macros but does not ship the
`SwiftUIMacros` compiler plugin, so this project builds against 26.5. Override
the SDK path if yours differs:

```sh
export SHIELDBAR_SDK=/path/to/MacOSX26.5.sdk
```

Build, ad-hoc sign, install to `~/Applications`, and create a zip backup:

```sh
Scripts/build-app.sh release
```

The app is installed at `~/Applications/ShieldBar.app` with a backup at
`~/Applications/ShieldBar.app.zip`. It is ad-hoc signed and intended for this
Mac only; it is not notarized for distribution.

Run the unit tests (Swift Testing):

```sh
Scripts/test.sh
```

Run the live integration self-test against BrowserLeaks from the installed
app. It prints only redacted addresses and exits non-zero if a complete IP +
WebRTC result could not be read. A red/amber strict verdict is a valid
finding, not a self-test failure:

```sh
Scripts/self-test.sh
```

Developer UI previews (documentation-only IP ranges, no network access):

```sh
~/Applications/ShieldBar.app/Contents/MacOS/ShieldBar \
  --render-preview /tmp/shieldbar-preview
```

## Project layout

```
Package.swift
Resources/Info.plist           LSUIElement=true, bundle metadata
Resources/Attribution.txt
Sources/ShieldBarCore/         report models, IP normalization, strict evaluator
Sources/ShieldBar/             AppKit lifecycle, status item, SwiftUI card,
                               WKWebView probe, full report window,
                               notifications, self-test, previews
Tests/ShieldBarCoreTests/      14 Swift Testing cases
Scripts/build-app.sh           build + icon + bundle + sign + zip
Scripts/test.sh                unit tests with CLT framework paths
Scripts/self-test.sh           integration check from the installed bundle
Scripts/make-icon.swift        vector app icon renderer
```

## Attribution

IP address and WebRTC data are provided by
[BrowserLeaks](https://browserleaks.com/ip). BrowserLeaks and its content
belong to their respective owners. ShieldBar is not affiliated with or
endorsed by BrowserLeaks. Use of the site is subject to BrowserLeaks' own
terms. Please be considerate: the default background cadence is 15 minutes,
not continuous polling.
