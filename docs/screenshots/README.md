# Screenshots

The summary card uses documentation-only IP ranges (RFC 5737 and RFC 3849).
No live IP addresses or browsing data are shown.

The Windows and Linux captures were rendered by the real Electron app on each
platform. The macOS captures were rendered by the native SwiftUI app.

## macOS (native)

<p>
  <img src="macos/dashboard-clear.png" width="260" alt="ShieldBar on macOS showing a Clear result">
  <img src="macos/dashboard-leak.png" width="260" alt="ShieldBar on macOS showing a public IP leak">
  <img src="macos/dashboard-local.png" width="260" alt="ShieldBar on macOS showing a local IP exposure">
</p>

<p>
  <img src="macos/dashboard-welcome.png" width="260" alt="ShieldBar on macOS welcome card">
  <img src="macos/dashboard-update.png" width="260" alt="ShieldBar on macOS showing an update banner">
</p>

Menu-bar status icons:

![macOS menu-bar status icons](macos/menu-bar-icons.png)

Protection (Beta) window:

<p>
  <img src="macos/protection-ready.png" width="360" alt="ShieldBar Protection window on macOS">
  <img src="macos/protection-triggered.png" width="360" alt="ShieldBar protection triggered on macOS">
</p>

## Windows (Electron)

<p>
  <img src="windows/dashboard-clear.png" width="260" alt="ShieldBar on Windows showing a Clear result">
  <img src="windows/dashboard-leak.png" width="260" alt="ShieldBar on Windows showing a public IP leak">
  <img src="windows/dashboard-local.png" width="260" alt="ShieldBar on Windows showing a local IP exposure">
</p>

<p>
  <img src="windows/dashboard-welcome.png" width="260" alt="ShieldBar on Windows welcome card">
  <img src="windows/dashboard-inconclusive.png" width="260" alt="ShieldBar on Windows showing an inconclusive result">
  <img src="windows/dashboard-offline.png" width="260" alt="ShieldBar on Windows showing an offline result">
</p>

Protection (Beta) window:

<p>
  <img src="windows/protection-ready.png" width="360" alt="ShieldBar Protection window on Windows">
  <img src="windows/protection-triggered.png" width="360" alt="ShieldBar protection triggered on Windows">
</p>

## Linux (Electron)

<p>
  <img src="linux/dashboard-clear.png" width="260" alt="ShieldBar on Linux showing a Clear result">
  <img src="linux/dashboard-leak.png" width="260" alt="ShieldBar on Linux showing a public IP leak">
  <img src="linux/dashboard-local.png" width="260" alt="ShieldBar on Linux showing a local IP exposure">
</p>

<p>
  <img src="linux/dashboard-welcome.png" width="260" alt="ShieldBar on Linux welcome card">
  <img src="linux/dashboard-inconclusive.png" width="260" alt="ShieldBar on Linux showing an inconclusive result">
  <img src="linux/dashboard-offline.png" width="260" alt="ShieldBar on Linux showing an offline result">
</p>

Protection (Beta) window:

<p>
  <img src="linux/protection-ready.png" width="360" alt="ShieldBar Protection window on Linux">
  <img src="linux/protection-triggered.png" width="360" alt="ShieldBar protection triggered on Linux">
</p>

## Status colors

The shield color and glyph are consistent across platforms:

| Status | Color | Glyph |
| --- | --- | --- |
| Clear | Green | Check |
| Public IP leak | Red | X |
| Local IP exposed | Amber | Exclamation |
| Inconclusive | Amber | Question mark |
| Offline | Gray | Dash |
| Checking | Blue | Three dots |
| Not checked | Gray | Dot |

Windows renders flag emoji as the two-letter country code rather than a flag;
this is a Windows font limitation, not missing location data.
