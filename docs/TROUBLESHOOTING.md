# Troubleshooting

> [!IMPORTANT]
> **If networking is currently disabled by Protection, restore it before doing anything else.** Do not uninstall the helper or reboot as a first step. See [Network is still disabled](#network-is-still-disabled).

## Quick recovery

Try these in order:

1. Open **Protection…** and choose **Restore Network**.
2. Right-click the menu bar or system tray icon and choose **Restore Network**.
3. App command line:

   macOS, as the user who installed the helper (no `sudo`; adjust the path if the app is in `/Applications`):

   ```sh
   ~/Applications/ShieldBar.app/Contents/MacOS/ShieldBar --restore-network
   ```

   Windows or Linux Electron app:

   ```sh
   # Windows: installed app or portable zip
   ShieldBar.exe --restore-network

   # Linux AppImage; use the installed shieldbar binary for a .deb
   ./ShieldBar-1.1.1-linux-x86_64.AppImage --restore-network
   ```

4. Helper command line, with administrator/root privileges:

   ```sh
   # macOS
   sudo /Library/PrivilegedHelperTools/com.local.shieldbar.helper restore

   # Linux
   sudo /usr/local/lib/shieldbar/shieldbar-helper restore
   ```

   ```powershell
   # Windows, elevated PowerShell
   & "$env:ProgramData\ShieldBar\shieldbar-helper.exe" restore
   ```

5. Restore the interfaces through the operating system:
   - **macOS:** System Settings → Network, enable the affected services.
   - **Windows:** Settings → Network & internet → Advanced network settings (or Change adapter options), enable the adapters.
   - **Linux:** `sudo ip link set dev <interface> up`, or use NetworkManager.

## Helper installation problems

### “Install the protection helper to enable the kill switch”

The app cannot reach the helper. Either it was never installed, its service is stopped, or the binary is missing.

| Platform | Check |
| --- | --- |
| macOS | `launchctl print system/com.local.shieldbar.helper` and `tail -50 /var/log/com.local.shieldbar.helper.log` |
| Linux | `systemctl status shieldbar-helper` and `journalctl -u shieldbar-helper -e` |
| Windows | `Get-ScheduledTask -TaskName ShieldBarProtectionHelper` and `Get-ScheduledTaskInfo -TaskName ShieldBarProtectionHelper` |

Reinstall from **Protection… → Install helper**. A reinstall is also the right fix after an app update that changes the helper protocol.

### Administrator approval was canceled

The helper is not installed and no interfaces were changed. Retry and approve the prompt. On Linux, run ShieldBar from a graphical desktop session with a polkit authentication agent available; `pkexec` needs one.

### The helper binary is missing

- **Release build:** reinstall ShieldBar from the release asset; the helper is bundled inside the app.
- **Source build:** run `npm run helper` from `desktop/`, or run `helper/build.sh` from the repository root, then rebuild the app.

The macOS native build script runs the helper build automatically.

### Security software blocks installation

Windows antivirus or EDR software may block creation of a scheduled task that runs as SYSTEM. Allow ShieldBar or its helper, then retry. macOS endpoint security tools can similarly block a LaunchDaemon. Check their logs before disabling anything globally.

### Gatekeeper blocks the macOS helper or app

The app and helper are ad-hoc signed, not notarized. If macOS reports an unidentified developer or a damaged app:

1. Control-click the app and choose **Open**.
2. On recent macOS, use **System Settings → Privacy & Security → Open Anyway**.
3. If the app was downloaded and quarantined, and you trust the build:

   ```sh
   xattr -dr com.apple.quarantine ~/Applications/ShieldBar.app
   ```

Do not disable Gatekeeper system-wide. If the helper itself is blocked, reinstall the app and approve the administrator prompt again.

## Network is still disabled

Restoring is manual and deliberate. Work through the quick recovery commands above.

### Partial restore

If some interfaces could not be restored, the helper keeps its triggered state and reports the failures. Run **Restore Network** again. If an interface still will not come up:

1. Check the helper log.
2. Enable the interface through the OS.
3. Run **Restore Network** once more to clear the helper's state.

Do not remove the helper until networking is restored.

### The app was quit or crashed while triggered

The helper keeps the interfaces disabled and its state persists. Relaunch ShieldBar and use **Restore Network**, or use the helper/OS commands above. The app does not need to be running for the helper CLI restore.

### Reboot did not restore the connection

A reboot is not a reliable recovery method. Some OS changes persist (macOS network services, Windows adapters); Linux link state usually resets. The helper's triggered state also persists, so ShieldBar may still display **Network disabled** even when the connection is back. Run an explicit restore after boot.

### App command-line restore is rejected

The native macOS `--restore-network` path authenticates to the helper by local user ID. Run it as the same account that installed the helper, without `sudo`. Running it as root or another user is rejected by design. The Electron flag uses the same local helper connection and follows the platform's pipe/socket permissions.

## Protection will not arm

Arming requires all of these:

- Protection enabled
- helper installed and reachable
- a baseline captured in the current session
- a latest **Clear** result
- no check currently running
- remote-session acknowledgement, if one was detected
- a likely VPN adapter, or manual VPN confirmation

Common causes:

- **Current result is Inconclusive, Offline, or a leak.** Fix the connection/VPN and wait for Clear.
- **No baseline.** Choose **Set current as safe** while the result is Clear.
- **Fields missing.** BrowserLeaks did not return every selected field. Deselect the missing field or wait for a complete report.
- **Network is triggered.** Restore it first; arming is blocked until then.
- **Remote session warning.** Acknowledge it only if you accept losing the session.
- **VPN adapter warning.** Confirm manually only if the VPN is actually connected.
- **Check in progress.** Wait for it to finish.

## Notifications do not appear

Checks and the kill switch still work without notifications; only the alert is suppressed.

- **macOS:** System Settings → Notifications → ShieldBar, allow notifications. Check Focus.
- **Windows:** Settings → System → Notifications, allow ShieldBar. Check Focus Assist. Toast notifications are associated with the installer's Start Menu shortcut; the portable zip may not show them unless you create a shortcut.
- **Linux:** notification delivery depends on a running notification daemon. Test with `notify-send test test`.
- **Protection:** on macOS, ShieldBar requests notification permission when you arm. On every platform, system settings can still suppress delivery.

## Linux system tray icon is missing

ShieldBar uses StatusNotifier/AppIndicator.

- **GNOME:** install the **AppIndicator and KStatusNotifierItem Support** extension.
- **KDE, XFCE, Cinnamon:** generally work without extra setup.
- **No system tray at all:** launch ShieldBar again from the application menu. The single-instance handler opens the summary popover. This is the fallback for desktops without StatusNotifier support.

Closing the popover or report window does not quit the app. Use **Quit ShieldBar** from the system tray menu.

## AppImage will not start

The AppImage requires FUSE.

```sh
chmod +x ShieldBar-1.1.1-linux-x86_64.AppImage
./ShieldBar-1.1.1-linux-x86_64.AppImage
```

If FUSE is unavailable:

```sh
./ShieldBar-1.1.1-linux-x86_64.AppImage --appimage-extract-and-run
```

Installing your distribution's FUSE 2 compatibility package is the permanent fix. The `.deb` does not need FUSE.

## Wayland positioning and always-on-top

Some Wayland compositors ignore requested popover positioning or always-on-top hints. ShieldBar falls back to positioning near the cursor. Use the system tray menu if the popover appears in an unexpected place. This is a compositor limitation, not a leak or protection failure.

## Windows SmartScreen warning

The Windows build is unsigned, so SmartScreen warns about an unknown publisher.

1. Choose **More info**.
2. Choose **Run anyway** only if you trust the build.
3. Verify the download against `SHA256SUMS.txt`:

   ```powershell
   Get-FileHash .\ShieldBar-1.1.1-win-x64.exe -Algorithm SHA256
   ```

There is no code-signing certificate and no auto-update.

## BrowserLeaks is Inconclusive or Offline

**Inconclusive** means the page or WebRTC test did not produce complete, comparable data. Common causes:

- BrowserLeaks changed its page layout
- UDP/STUN is blocked on the network
- a VPN, proxy, or firewall interferes with the test
- the page timed out (36-second limit)
- BrowserLeaks is rate-limiting or unavailable
- the WebRTC rows never settled

**Offline** means BrowserLeaks could not be loaded at all: no connection, DNS failure, captive portal, firewall, or an outage.

Neither state is ever treated as Clear. Try again after checking the connection and VPN. If the site loads normally in a browser but ShieldBar stays Inconclusive, the page layout may have changed; update ShieldBar.

### Rate limits and the 15-second armed cadence

While armed, ShieldBar loads the full BrowserLeaks page every 15 seconds. That can be rate-limited.

- Checks never overlap; a request during a check is queued once.
- When offline, retries slow to 60 seconds.
- ShieldBar does not retry faster when BrowserLeaks is slow or rate-limiting; the result is Inconclusive or Offline.
- With **fail-closed** enabled, an Inconclusive result can fire the kill switch. Disable fail-closed if that is not the behavior you want on a constrained network.
- Disarming Protection returns the app to its normal cadence: 30 seconds with the popover open, 15 minutes in the background, and 60 seconds while offline.

## Logs and diagnostic locations

| Item | Location |
| --- | --- |
| macOS helper log | `/var/log/com.local.shieldbar.helper.log` |
| Linux helper log | `journalctl -u shieldbar-helper -e` |
| Windows helper | Task Scheduler history / Event Viewer; no dedicated file |
| Native app preferences | `~/Library/Preferences/com.local.shieldbar.plist` |
| Electron settings (Windows) | `%APPDATA%\ShieldBar\settings.json` |
| Electron settings (Linux) | `~/.config/ShieldBar/settings.json` |
| Helper state (macOS) | `/var/db/com.local.shieldbar.helper/state.json` |
| Helper state (Linux) | `/var/lib/shieldbar-helper/state.json` |
| Helper state (Windows) | `%ProgramData%\ShieldBar\state.json` |

Logs contain interface names and states, not IP addresses. For Electron main-process errors, launch the app from a terminal to see stderr.

## Uninstalling the helper

Restore networking first. The app blocks removal while the network is triggered.

1. Open **Protection… → Restore Network** if needed.
2. Choose **Remove helper**.
3. If the app cannot remove it, run the helper uninstall command as administrator/root:

   ```sh
   # macOS
   sudo /Library/PrivilegedHelperTools/com.local.shieldbar.helper uninstall

   # Linux
   sudo /usr/local/lib/shieldbar/shieldbar-helper uninstall
   ```

   ```powershell
   # Windows, elevated PowerShell
   & "$env:ProgramData\ShieldBar\shieldbar-helper.exe" uninstall
   ```

If the binary is already gone but the service remains, remove the service manually. See [KILL-SWITCH.md](KILL-SWITCH.md#uninstall-the-helper).

Removing the helper does not remove ShieldBar's own settings. Delete the settings file if you want a clean slate.

## Before opening an issue

Include:

- ShieldBar version and platform
- whether Protection is enabled, armed, or triggered
- the exact status and Protection message
- helper version (from the Protection window)
- relevant log lines with interface names redacted if you prefer

Do not post public IP addresses, WebRTC candidates, or full logs containing addresses. The [issue tracker](https://github.com/TH3L30/ShieldBar/issues) is public.

## Related documentation

- [Protection kill switch](KILL-SWITCH.md)
- [Privacy](PRIVACY.md)
- [Architecture](ARCHITECTURE.md)
- [Build](BUILD.md)
