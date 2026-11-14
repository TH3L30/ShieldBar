# Architecture

ShieldBar ships as two independent applications that share a product contract, not code:

- **Native macOS app** in `Sources/` — Swift, SwiftUI, AppKit, WebKit.
- **Windows/Linux app** in `desktop/` — Electron, TypeScript, React, Chromium.
- **Shared privileged helper** in `helper/` — Go, built separately for each platform.

Both apps implement the same strict status rules, check cadence, Protection semantics, and privacy model. Their core logic is tested independently.

## Process boundaries

### macOS

```text
Menu bar icon · popover · report window · protection window
                         │
              Monitor ───┴─── ProtectionController
                 │                    │
                 ▼                    ▼
      hidden WKWebView        HelperClient (Unix socket)
                 │                    │
                 ▼                    ▼
        browserleaks.com      launchd helper (root)
                                      │
                                      ▼
                          networksetup / ifconfig
```

- The app runs as the normal user and owns the UI, schedule, evaluations, and notifications.
- BrowserLeaks loads in a hidden, borderless `WKWebView` with a non-persistent data store.
- The Protection helper is a separate root LaunchDaemon. The app reaches it over a local Unix socket.
- The helper is the only component that changes interfaces.

### Windows and Linux

```text
Main process: tray · monitor · probe · protection · windows
      │             │              │
      │             ▼              ▼
      │      hidden BrowserWindow  HelperClient
      │             │              │  (named pipe / Unix socket)
      │             ▼              ▼
      │      browserleaks.com   helper service (SYSTEM/root)
      │                            │
      ▼                            ▼
Renderer processes        Disable-NetAdapter / ip link
(dashboard, protection, report)
```

- The Electron main process coordinates all windows and owns the monitor and Protection state.
- The dashboard, Protection window, and report window are sandboxed renderers with `contextIsolation`, no Node integration, and a narrow preload bridge.
- The probe is a hidden `BrowserWindow` using the `shieldbar-probe` non-persistent partition.
- The helper runs as a Windows scheduled task under SYSTEM, a systemd service, or a macOS LaunchDaemon.

## Probe

Both implementations load the real `https://browserleaks.com/ip` page with JavaScript enabled and read the rendered DOM. There is no private API, scraping proxy, or analytics service.

| Property | macOS | Windows/Linux |
| --- | --- | --- |
| Engine | WebKit | Bundled Chromium |
| Surface | Offscreen `WKWebView` | Hidden `BrowserWindow` |
| Storage | `.nonPersistent()` | Non-persistent Electron partition |
| Poll interval | 450 ms | 450 ms |
| Timeout | 36 s | 36 s |
| Cleanup | Session discarded | Window destroyed; storage and cache cleared |
| Permissions | Media capture denied | All permission requests denied |

The probe waits for the document to finish, a public IPv4 address to appear, and both WebRTC rows to settle. It allows a short grace period for STUN, and returns an incomplete report rather than guessing when the WebRTC rows never settle. Missing cells, loading rows, placeholders, a timeout, or a changed layout produce **Inconclusive** or **Offline**, never green.

The WebRTC test runs inside ShieldBar's embedded engine. It exercises the system network path and the VPN/proxy routing that engine uses. It cannot inspect Chrome's, Safari's, Firefox's, Edge's, or another browser's private WebRTC stack.

Both report windows load the live site in a non-persistent session, restrict navigation to `browserleaks.com`, and open external links in the default browser.

## Strict evaluator

The evaluator is deliberately conservative. It returns **Clear** only when all of these hold:

1. The page completed and returned a public IPv4 address.
2. The WebRTC test completed with a final public candidate.
3. Every WebRTC public address matches a page address after IPv4/IPv6 normalization.
4. No local/private WebRTC address is exposed.

Evaluation order:

1. Unsupported WebRTC → Inconclusive.
2. Incomplete WebRTC test → Inconclusive.
3. Missing page address → Inconclusive.
4. Missing public WebRTC candidate → Inconclusive.
5. Any public mismatch → Public IP leak.
6. Any local address → Local IP exposed.
7. Otherwise → Clear.

Missing data is never treated as success. A missing local-IP row is an incomplete result, not evidence that no local address leaked. IPv4 and IPv6 forms are normalized before comparison, including bracketed IPv6 and zone identifiers.

## Monitor cadence

| Situation | Interval |
| --- | --- |
| Popover open | 30 s |
| Background | 15 min |
| Offline | 60 s |
| Protection armed | 15 s |
| Popover opened with a stale result | Immediate if older than 8 s |
| Launch | Immediate |
| Network path change | Native: immediate after a settle delay; Electron: polled every 15 s |
| Wake/resume | After about 2 s |

The visible "next check" countdown updates every second. That is a **UI heartbeat, not a network test**. The network cadence stays at the intervals above.

Checks are serialized. If a check is already running, another request sets a single pending flag and runs after the current check finishes. This prevents overlapping page loads and trigger storms.

macOS uses `NWPathMonitor` for path changes. Electron polls `net.isOnline()` every 15 seconds and listens for `powerMonitor` resume.

## Protection state machine

```text
unavailable --install--> ready <--disarm-- armed --trigger--> triggering --> triggered
                           ^                                                 |
                           |                                                 |
                           +------------- restoring <----restore-------------+
                                          |  success
                                          +--> ready
                                          |  failure
                                          +--> triggered (retry)
```

| Phase | Meaning |
| --- | --- |
| `unavailable` | Helper is missing or not reachable. |
| `ready` | Helper is available; Protection is not armed. |
| `armed` | Checks run every 15 s; a trigger will disable networking. |
| `triggering` | The helper disable request is in flight. |
| `triggered` | Networking was disabled; manual restore is required. |
| `restoring` | The helper restore request is in flight. |
| `error` | A helper operation failed or the helper disappeared. |

Arming requires Protection enabled, a reachable helper, a baseline captured in this session, a latest **Clear** report, no running check, acknowledgement of a detected remote session, and either a likely VPN adapter or manual VPN confirmation.

Both apps keep Protection state in the controller and the baseline in memory. The helper persists only its install config, triggered state, and interface snapshot.

## Protection evaluation

The evaluator checks, in order:

1. **Public IP leak** — enabled by default. Any public WebRTC mismatch triggers.
2. **Local IP exposure** — off by default. Any local/private WebRTC address triggers.
3. **Location change** — on by default. Compares the selected baseline fields.
4. **Inconclusive** — only when fail-closed is enabled.

A location mismatch is re-read after **2 seconds**. If the next check still mismatches, the kill fires. This filters one stale geolocation response without hiding a real server change.

While armed, the app also polls interface names every **5 seconds** and rechecks on network or adapter changes and after wake. A trigger request is attempted twice, one second apart. If the helper reports a triggered state, the app disarms, clears the baseline, stops polling, and notifies the user.

Offline is not a trigger. If BrowserLeaks cannot be reached, the app reports **Protection degraded** and keeps the last result.

## Helper protocol and security

The helper speaks newline-delimited JSON over a local socket or named pipe. Requests are capped at 64 KiB, connections have an 8-second deadline, and the protocol version is 1.

| Command | Effect |
| --- | --- |
| `status` | Reports helper version, triggered state, and interface names that are up. |
| `disable` | Snapshots up interfaces and disables them. |
| `restore` | Re-enables only the interfaces in the snapshot and clears state. |
| `version` | Protocol/version probe. |

The helper also has CLI subcommands `install`, `uninstall`, `status`, `restore`, and `version`. Install, uninstall, and direct restore require root/administrator.

### Authorization

| Platform | Boundary |
| --- | --- |
| macOS | Unix socket peer UID via `LOCAL_PEERCRED`, matching the installing user. |
| Linux | Unix socket peer UID via `SO_PEERCRED`, matching the installing user. |
| Windows | Named-pipe DACL grants access to SYSTEM and the installing user's SID. |

The socket is mode `0660`, owned by root and the installing group where applicable. Config and state directories are `0700`; config and state files are `0600`.

### State and restore semantics

Before disabling anything, the helper writes a state file containing:

- whether the network is triggered
- the trigger timestamp
- the name, kind, and up/down state of each interface in the snapshot

Only interfaces that were **up at trigger time** are snapshotted. Restore iterates that snapshot and re-enables only those entries. If any restore fails, the state is retained so restore can be retried. If a disable partially fails, the helper still reports triggered; some interfaces may remain up.

The helper does not monitor the network continuously, does not re-disable interfaces added later, and does not auto-restore. It is a command executor with a persisted snapshot, not a firewall.

### Platform operations

| Platform | Disable | Restore |
| --- | --- | --- |
| macOS | `networksetup -setnetworkserviceenabled … off` for services; `ifconfig … down` for interfaces | The inverse, only for snapshot entries |
| Linux | `ip link set dev … down` for non-loopback links | `ip link set dev … up` |
| Windows | `Disable-NetAdapter -Name … -Confirm:$false` | `Enable-NetAdapter -Name … -Confirm:$false` |

### Install locations

| Platform | Service | Binary | Socket/pipe | State |
| --- | --- | --- | --- | --- |
| macOS | LaunchDaemon `com.local.shieldbar.helper` | `/Library/PrivilegedHelperTools/com.local.shieldbar.helper` | `/var/run/com.local.shieldbar.helper.sock` | `/var/db/com.local.shieldbar.helper` |
| Linux | `shieldbar-helper.service` | `/usr/local/lib/shieldbar/shieldbar-helper` | `/run/shieldbar-helper.sock` | `/var/lib/shieldbar-helper` |
| Windows | Scheduled task `ShieldBarProtectionHelper` | `%ProgramData%\ShieldBar\shieldbar-helper.exe` | `\\.\pipe\shieldbar-protection-helper` | `%ProgramData%\ShieldBar` |

## Privacy invariants

- Reports, IP addresses, WebRTC candidates, and baseline values are never written to disk.
- The exact-IP baseline is a salted SHA-256 hash held in memory; the salt is random per app launch.
- Settings store only UI preferences, booleans, enum choices, selected field names, and native window geometry.
- Helper state stores interface names, kinds, and up/down states only.
- Helper logs contain interface names and states, not addresses.
- Notifications contain no IP addresses.
- No telemetry, analytics, accounts, or IP history.
- Network access is limited to BrowserLeaks pages and their assets. The report window restricts navigation to `browserleaks.com`.
- Screenshots and preview fixtures use RFC 5737 and RFC 3849 documentation ranges.

The 15-second armed cadence performs full page loads and is visible to BrowserLeaks. See [PRIVACY.md](PRIVACY.md).

## Test strategy

| Layer | What is tested |
| --- | --- |
| Swift Testing | Strict evaluator, IP normalization, status precedence, baseline capture, exact-IP hashing, location comparison, trigger selection |
| Vitest | Evaluator, normalization, DOM extraction, probe completion rules, baseline/evaluator parity, settings normalization |
| Go tests | Helper snapshot, idempotent disable, restore-only-snapshot, partial failures, state retention |
| Smoke tests | Electron dashboard and Protection renderers with the preload bridge |
| Self-tests | Native and Electron live BrowserLeaks probes; redacted output |
| CI | Typecheck, unit tests, Go tests, bundle build, headless smoke test, Windows/Linux packaging |

The helper tests use a fake backend. A `testmode` build restricts operations to `sbtest`, `feth`, and `bridge` interfaces so the real OS commands can be exercised without cutting the test runner's management interface. Real physical-NIC disable/restore on Windows and macOS remains pending; that is why Protection is Beta.

## Related documentation

- [Protection kill switch](KILL-SWITCH.md)
- [Privacy](PRIVACY.md)
- [Build](BUILD.md)
- [Troubleshooting](TROUBLESHOOTING.md)
