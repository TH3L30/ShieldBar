# ShieldBar for Windows and Linux

An Electron + TypeScript tray app that shows the public IP reported by
[BrowserLeaks](https://browserleaks.com/ip) and checks whether WebRTC exposes a
different public IP or a local/private address.

This is the cross-platform companion to the native macOS app in the repository
root. It follows the same strict status rules, probe, check cadence, and
privacy model.

ShieldBar is an independent project and is not affiliated with BrowserLeaks.

## Features

- Tray icon whose color and glyph reflect the latest strict verdict
- Summary popover with public IP, location, ISP, IPv6, and WebRTC results
- Full BrowserLeaks report in a dedicated window
- Notifications only when the status changes to a **Public IP leak**
- No IP history, telemetry, accounts, or analytics
- In-memory probe and report sessions; browsing data is discarded after each
  check and when the app exits

## Status rules

Green is only possible when **all** of these hold:

1. The BrowserLeaks page completed and returned a public IPv4 address.
2. The WebRTC test completed with final local and public cells.
3. Every WebRTC public address matches a page address after IPv4/IPv6
   normalization.
4. No local/private WebRTC address is exposed.

| Status | Meaning |
| --- | --- |
| **Clear** (green) | WebRTC public IP matches BrowserLeaks and no local IP is exposed. |
| **Public IP leak** (red) | WebRTC sees a different public IP than the page. Takes precedence over local exposure. |
| **Local IP exposed** (amber) | Public IPs match, but a private/local WebRTC address is visible. |
| **Inconclusive** (amber) | The test was blocked, unsupported, timed out, or returned incomplete data. Never shown as green. |
| **Offline** (gray) | BrowserLeaks could not be reached. |
| **Checking** (blue) | A test is running. |
| **Not checked** (gray) | No check has completed yet. |

Missing data is never treated as success. A missing local-IP row is an
incomplete probe result, not “no local leak.”

## Check cadence

The popover's freshness line updates every second. That is a **renderer
heartbeat, not a network test**.

Actual BrowserLeaks checks run:

- immediately at launch and when the popover opens, if the last result is older
  than 8 seconds
- every **30 seconds** while the popover is open
- every **15 minutes** in the background
- every **60 seconds** while offline, to detect recovery
- immediately on a network transition and when the system resumes from sleep

Running a full page load every second would be hostile to BrowserLeaks and
unreliable. The background cadence is intentionally conservative.

## Privacy

- No analytics, telemetry, accounts, or IP history.
- Probe and report windows use non-persistent Electron sessions.
- Probe storage and cache are cleared after every check.
- IP addresses are not written to notifications. The notification body only
  says that a public leak was detected.
- The full report window only navigates within `browserleaks.com`; external
  links open in the default browser.
- All permission requests (camera, microphone, geolocation, notifications from
  the page, etc.) are denied in both the probe and report sessions.

The only local state is a settings file with two booleans: whether leak
notifications are enabled, and whether the welcome card was dismissed.

## How the probe works

A hidden Chromium window loads the real BrowserLeaks `/ip` page with a
non-persistent partition. Every 450 ms ShieldBar reads the rendered DOM:
`#client-ipv4`, `#client-ipv6`, `#rtc-local`, `#rtc-public`, `#rtc-leak`, and
the location/ISP table. The probe completes when the page is loaded and both
WebRTC cells have settled. It fails closed on timeouts (36 seconds), missing
cells, `.load-td` loading rows, or a missing page IP.

### WebRTC scope

The WebRTC test runs in **bundled Chromium**, not in Chrome, Edge, Firefox, or
Safari. It exercises the system network path and the VPN/proxy routing that
Chromium uses. Other browsers implement their own WebRTC policies and may
behave differently; use each browser's own leak test if that is what you need
to verify.

BrowserLeaks can change its layout or be unavailable. ShieldBar reports those
cases as Inconclusive/Offline rather than guessing. This is a convenience
check, not a guarantee of anonymity or VPN correctness.

## Build and test

Requirements: Node.js 22.12 or newer, npm, and the platform you want to
package on. Cross-packaging is supported only partially; GitHub Actions builds
both platforms reliably.

```sh
cd desktop
npm ci

npm run dev        # development window/tray
npm run typecheck
npm test           # pure unit tests, no network
npm run build
npm run self-test  # live BrowserLeaks integration check, redacted output
npm run smoke      # headless renderer/preload smoke test
npm run preview    # offscreen UI previews in desktop/preview/
```

The live self-test exits non-zero when a complete IP + WebRTC result cannot be
read. A red or amber strict verdict is a valid finding, not a test failure.

## Packaging

```sh
npm run dist:win    # NSIS installer + portable zip (x64)
npm run dist:linux  # AppImage + .deb (x64)
```

Artifacts are written to `desktop/release/`:

- `ShieldBar-1.0.0-win-x64.exe` — per-user NSIS installer
- `ShieldBar-1.0.0-win-x64.zip` — portable zip
- `ShieldBar-1.0.0-linux-x64.AppImage`
- `ShieldBar-1.0.0-linux-x64.deb`

Builds are **unsigned**. Windows SmartScreen will warn about an unknown
publisher; choose “More info” then “Run anyway” only if you trust the build.
Linux packages are unsigned too. There is no auto-updater.

Icons are generated from `../Resources/AppIcon.icns` when possible, with a
vector fallback:

```sh
npm run icons
```

## GitHub Actions

`.github/workflows/desktop-build.yml` runs on pushes to `main` that touch
`desktop/**`, on manual dispatch, and on `v*` tags:

1. Ubuntu: typecheck, unit tests, build, headless smoke test, and a
   non-blocking live self-test.
2. Windows and Ubuntu matrix: package the x64 targets, smoke-test the
   unpacked executable, and upload the installers.
3. Tag pushes: create a **draft** GitHub release with the artifacts.

No code-signing secrets are used.

## Platform caveats

### Windows

- x64 only.
- The installer is per-user and does not require administrator rights.
- Unsigned, so SmartScreen warns on first launch.
- Notifications require Windows notification settings to allow ShieldBar.

### Linux

- x64 only. Tested primarily on Ubuntu 24.04.
- The tray uses StatusNotifier/AppIndicator. GNOME requires the
  **AppIndicator and KStatusNotifierItem Support** extension; KDE, XFCE, and
  Cinnamon generally work without extra setup.
- On Wayland, compositors may ignore requested popover positioning or
  always-on-top hints. ShieldBar falls back to positioning near the cursor.
- AppImage requires FUSE. On systems without FUSE, run it with
  `--appimage-extract-and-run`.
- If the tray is unavailable, launch the app again or use the application
  menu/desktop entry; the popover can still be opened from the tray menu when
  the desktop supports one.
- Notification delivery depends on a running notification daemon.

### Both

- There is no auto-start at login; use the OS startup settings if desired.
- The full report window is a Chromium view of the live site, not a cached
  report.
- The app is tray-only: closing the popover or report window does not quit it.
  Use **Quit ShieldBar** from the tray menu or Settings.

## Project layout

```
desktop/
  src/core/            models, IP normalization, strict evaluator, schedule,
                       DOM extraction, pure probe/result logic
  src/main/            Electron lifecycle, monitor, probe, tray, popover,
                       report window, settings, notifications, self-test
  src/preload/         contextBridge API
  src/renderer/        React 19 dashboard + deterministic preview fixtures
  src/shared/          IPC contract and cadence constants
  scripts/             icon generation
  build/               Windows .ico and Linux icon set
  resources/           app icon and tray PNGs
  tests/               Vitest unit tests
```

## Attribution

IP address and WebRTC data are provided by
[BrowserLeaks](https://browserleaks.com/ip). BrowserLeaks and its content
belong to their respective owners. ShieldBar is not affiliated with or
endorsed by BrowserLeaks. Use of the site is subject to BrowserLeaks' own
terms. Please be considerate: the default background cadence is 15 minutes,
not continuous polling.
