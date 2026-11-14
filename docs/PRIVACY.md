# Privacy

ShieldBar has no accounts, analytics, telemetry, or IP history. The app needs your public IP to show it and to compare it with WebRTC, but it keeps that data in memory and does not send it anywhere except the BrowserLeaks page you asked it to load.

This document describes exactly what is handled, where it lives, and when it is discarded.

## Data inventory

| Data | Where it lives | Retention |
| --- | --- | --- |
| Public IPv4 and IPv6 | App memory | Replaced by the next check; gone when the app exits |
| Country, region, city, ISP, organization | App memory | Same |
| WebRTC local and public candidates | App memory | Same |
| Status, report, error, timestamps | App memory | Same |
| Protection baseline (country/region/city/ISP) | App memory | Session only; cleared on trigger, restore, field change, or app exit |
| Protection exact-IP hash | App memory | Session only; salted SHA-256, never the address |
| Settings | Local disk | Until you change or delete them |
| Helper triggered state and interface snapshot | Local disk, root/admin-owned | Until restore or helper uninstall |
| Helper logs | Local disk or systemd journal | According to the OS log policy |
| Notifications | Operating system | According to the OS notification settings |
| Screenshots and preview fixtures | Repository | Static files with documentation-only addresses |

## IP addresses and reports

ShieldBar does not write IP addresses, WebRTC candidates, or reports to disk. There is no history view, database, cache file, or export.

- The current report is held in memory and replaced after each check.
- The menu bar or system tray tooltip can show the current public IP while the app is running.
- Notifications never contain IP addresses. A public-leak notification says only that WebRTC sees a different public IP; a Protection notification names the trigger.
- Self-tests print redacted addresses.
- Application logs do not include IP addresses by design.

The report window shows the live BrowserLeaks page. That page may render your IP on screen, but ShieldBar does not copy it into persistent storage.

## Browser sessions

Both apps use disposable browsing sessions:

- **macOS:** the probe and report windows use `WKWebsiteDataStore.nonPersistent()`. Cookies, cache, and local storage are not persisted.
- **Windows/Linux:** the probe uses the `shieldbar-probe` non-persistent Electron partition, and the report uses `shieldbar-report`. The probe destroys its window and clears storage and cache after every check.
- **Permissions:** the Electron probe and report sessions deny all page permission requests, including camera, microphone, geolocation, and page notifications.
- **Navigation:** the report window only navigates within `browserleaks.com`; external links open in the default browser.

Any cookies BrowserLeaks sets live only in the in-memory session and disappear when the session or app exits.

## Protection baseline

The baseline is the reference used by the location guard. It is held in memory only.

- Country, region, city, and ISP/ASN are stored as plain text in memory.
- The exact-IP option stores `SHA-256(salt + ":" + address)`, not the address.
- The salt is random per app launch and is never written to disk.
- The baseline is cleared when you change the selected fields, restore networking, trigger Protection, or restart ShieldBar.

The helper never receives the baseline. It receives only `status`, `disable`, and `restore` commands and returns interface names and states.

## Settings

ShieldBar stores UI preferences and Protection choices, never reports or addresses.

| Platform | Location |
| --- | --- |
| macOS | `~/Library/Preferences/com.local.shieldbar.plist` (UserDefaults) |
| Windows | `%APPDATA%\ShieldBar\settings.json` |
| Linux | `~/.config/ShieldBar/settings.json` |

Stored values are limited to:

- whether leak notifications are enabled
- whether the welcome card was dismissed
- whether Protection is enabled
- which triggers are enabled
- which baseline fields are selected
- whether fail-closed is enabled
- whether ShieldBar starts at login
- native window position and size

No IP address, baseline value, report, or check timestamp is stored in settings.

## Helper state and logs

The helper runs with administrator/root privileges but has a narrow job. It does not have network code and does not collect or store IP addresses.

Its state file contains:

- whether networking is currently disabled
- when the trigger happened
- the name, kind, and up/down state of each interface in the snapshot

Its logs contain startup information, errors, and interface names/states. They do not contain IP addresses or reports.

| Platform | State | Logs |
| --- | --- | --- |
| macOS | `/var/db/com.local.shieldbar.helper/state.json` (mode `0600`) | `/var/log/com.local.shieldbar.helper.log` |
| Linux | `/var/lib/shieldbar-helper/state.json` (mode `0600`) | `journalctl -u shieldbar-helper` |
| Windows | `%ProgramData%\ShieldBar\state.json` | No dedicated file; use Task Scheduler/Event Viewer |

## Notifications

Notifications are generated locally by the operating system. ShieldBar does not use a push service.

- Public-leak notification: "ShieldBar: public IP leak" with a generic body.
- Protection notification: "ShieldBar disabled networking" and the trigger label.
- No IP addresses are included in either.
- The OS may retain delivered notifications in Notification Center according to its own settings.

Notification permission is requested when needed. If you deny it, checks and Protection still work; only the notification is suppressed.

## Screenshots and fixtures

Repository screenshots and preview fixtures use documentation-only address ranges:

- IPv4: RFC 5737 (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`)
- IPv6: RFC 3849 (`2001:db8::/32`)

They contain no live IP addresses, account data, or browsing history.

## BrowserLeaks requests

ShieldBar loads `https://browserleaks.com/ip` and its assets directly. BrowserLeaks receives what any website receives:

- your source IP address
- standard request headers and a browser user agent
- the page and asset requests
- timing information

BrowserLeaks handles that data under its own terms and privacy policy. ShieldBar is not affiliated with BrowserLeaks and cannot control its logging or retention.

While Protection is armed, ShieldBar performs a **full BrowserLeaks page load every 15 seconds**. That is a substantial request rate and is visible to BrowserLeaks. It can also trigger rate limiting, which ShieldBar reports as Inconclusive or Offline rather than hiding. The default background cadence is 15 minutes; the aggressive cadence exists only while you have armed the kill switch.

ShieldBar does not proxy BrowserLeaks traffic, does not use a private API, and does not send data to any other service.

## No telemetry or update pings

ShieldBar has no analytics SDK, account system, telemetry endpoint, or configured crash-report upload. It does not check for updates, because there is no auto-updater. ShieldBar itself makes no other network requests; the BrowserLeaks pages are the only remote content it asks for.

## Local inspection

Some features inspect local state without sending it anywhere:

- Protection reads non-loopback interface names to show detected adapters and to warn about likely VPNs.
- Remote-session detection reads SSH environment variables and checks for common screen-sharing process names on macOS/Linux; on Windows it checks the RDP session name.
- The helper lists interface names and states.

None of this local information is transmitted.

## Your controls

- Turn off leak notifications in the menu bar or system tray.
- Turn off Protection and restore networking at any time.
- Quit ShieldBar to clear all in-memory reports and baselines.
- Delete the settings file to remove stored preferences.
- Remove the helper to delete its state and service.
- Use BrowserLeaks' own controls and policies for data held by BrowserLeaks.

## Changes

If a future version adds persistence, telemetry, or a new network destination, this document and the app's behavior must be updated together. The current v1.1.0 build does not include any such feature.
