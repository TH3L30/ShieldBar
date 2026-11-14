# Protection (Beta) kill switch

Protection is ShieldBar's optional network kill switch. It is **off by default**, requires a one-time privileged helper, and is armed manually after your VPN is connected. When a configured condition fires, the helper disables every non-loopback network interface and leaves them disabled until you restore them yourself.

Protection is **Beta**. It has not been validated against physical network adapters on Windows and macOS. Treat it as a supplementary safety check, not as your only kill switch.

> [!WARNING]
> **This feature can take you offline immediately.** Arming Protection can terminate calls, downloads, remote sessions, backups, and local network access. Restoring the connection is a manual action. Do not enable it on a machine you cannot reach physically, and do not rely on it for personal safety or anonymity.

## At a glance

| Item | Detail |
| --- | --- |
| Platforms | macOS arm64 · Windows x64 · Linux x64 |
| Default | Off |
| Helper | Go daemon, installed once with admin/root approval |
| Armed checks | Full BrowserLeaks page every 15 seconds |
| Restore | Manual only — no timeout and no auto-restore |
| Trigger notification | Yes, when the OS allows notifications |
| Status | Beta; physical-NIC validation pending on Windows and macOS |

## Threat model

**Designed for:** a VPN tunnel dropping or rerouting while ShieldBar is running and armed; WebRTC exposing a public IP that differs from the BrowserLeaks page; an exit location changing outside the expected baseline; optionally, a local/private WebRTC address being exposed.

**Not designed for:** malware, a compromised operating system, a kernel-level attacker, or a network adversary who controls the machine. It is not a firewall, not a VPN, and not an anonymity system. It cannot inspect another browser's private WebRTC stack, and it cannot protect traffic that has already left the machine.

A real firewall-based kill switch is stronger. ShieldBar's helper disables interfaces; it does not install firewall rules, filter per application, or block individual routes.

## What it does and does not do

| It does | It does not |
| --- | --- |
| Disable all non-loopback interfaces that were up when triggered | Restore them automatically |
| Snapshot the interfaces before changing anything | Re-disable interfaces added after the trigger |
| Require a Clear result and a captured baseline before arming | Detect a VPN cryptographically |
| Check the full BrowserLeaks page every 15 seconds while armed | Monitor another browser's WebRTC stack |
| Notify you when it fires | Keep protecting after ShieldBar quits or crashes |
| Restore only the interfaces in its snapshot | Replace a firewall, VPN, or OS-level kill switch |

## Before you enable it

1. Connect your VPN and confirm ShieldBar reports **Clear**.
2. Make sure you have a way to restore networking: physical access to the machine, or a local terminal that does not depend on the connection being up.
3. If you are on a remote session, assume arming will disconnect you when it fires.
4. Read the recovery section below and keep the commands available offline.

## Install the helper

The helper is a small Go daemon bundled with ShieldBar. It runs with administrator/root privileges because disabling network interfaces requires them. It exposes only a local JSON protocol with `status`, `disable`, and `restore` commands.

Open **Protection…** from the menu bar or system tray, enable Protection, and choose **Install helper**. The operating system asks for approval:

| Platform | Approval | Installed as |
| --- | --- | --- |
| macOS | Administrator prompt via `osascript` | LaunchDaemon `com.local.shieldbar.helper` |
| Windows | UAC prompt | Scheduled task `ShieldBarProtectionHelper`, running as SYSTEM |
| Linux | polkit / `pkexec` prompt | systemd service `shieldbar-helper` |

| Platform | Helper and state |
| --- | --- |
| macOS | Binary `/Library/PrivilegedHelperTools/com.local.shieldbar.helper`; socket `/var/run/com.local.shieldbar.helper.sock`; state `/var/db/com.local.shieldbar.helper`; log `/var/log/com.local.shieldbar.helper.log` |
| Linux | Binary `/usr/local/lib/shieldbar/shieldbar-helper`; socket `/run/shieldbar-helper.sock`; state `/var/lib/shieldbar-helper`; logs in the systemd journal |
| Windows | Binary `%ProgramData%\ShieldBar\shieldbar-helper.exe`; named pipe `\\.\pipe\shieldbar-protection-helper`; state `%ProgramData%\ShieldBar`; no dedicated log file |

The helper does not contact the network, does not collect or store IP addresses, and does not store reports. It logs interface names and states only. It follows the app's signing state: ad-hoc signed on macOS, unsigned on Windows and Linux.

## Capture a baseline

A baseline is the reference the location guard compares against. **Set current as safe** is available only when the latest result is **Clear** and the report contains every selected field.

| Field | Default | Notes |
| --- | --- | --- |
| Country | On | Stable default. Will not catch a VPN server change within the same country. |
| Region | Off | More sensitive; geo databases may disagree at borders. |
| City | Off | More sensitive still; CDN and mobile networks can move results. |
| ISP / ASN | Off | Catches a different provider; some networks rotate between organizations. |
| Exact IP | Off | Strictest. Every VPN server rotation will trigger. |

The baseline is held **in memory only** and is never written to disk. The exact-IP option stores a salted SHA-256 hash, not the address; the salt is random per app launch. The baseline is cleared when you change the selected fields, trigger Protection, restore the network, or restart ShieldBar. You must capture a new baseline after any of those events.

If a selected field is missing from the BrowserLeaks report, ShieldBar refuses to capture the baseline and lists the missing fields.

## Arm Protection

Arming requires all of the following:

- Protection is enabled and the helper is installed.
- A baseline has been captured in this session.
- The latest check is **Clear** and a report is available.
- No check is currently running.
- You have acknowledged a detected remote session, if there is one.
- A likely VPN adapter was detected, or you have confirmed manually that the VPN is connected.

ShieldBar starts a full BrowserLeaks check immediately after arming, then every 15 seconds. It also polls the interface list every 5 seconds, checks on network path changes, and checks after wake.

### VPN adapter warning

VPN detection is a **name heuristic**, not proof. ShieldBar flags adapters whose names suggest WireGuard, OpenVPN, Tailscale, Mullvad, Proton, IPsec, PPP, ZeroTier, and similar tools. A VPN with an unremarkable adapter name will not be recognized. If no likely adapter is found, arming requires an explicit confirmation that the VPN is connected.

A recognized adapter does not prove the tunnel is healthy. Confirm the VPN is actually connected and that the current result is Clear.

### Remote session warning

ShieldBar detects SSH sessions and common screen-sharing processes on macOS and Linux, and RDP sessions on Windows. If a remote session is detected, arming requires an explicit acknowledgement that the session will be disconnected if Protection fires.

This detection is advisory. A remote session that ShieldBar does not recognize will not produce a warning.

### Start at login

The Protection settings include **Start ShieldBar at login**. It starts the app, not the kill switch. Protection is **not armed automatically** after login or reboot.

## What triggers a kill

| Trigger | Default | Fires when |
| --- | --- | --- |
| Public IP leak | On | Any WebRTC public address differs from the BrowserLeaks page address. |
| Local IP exposure | Off | A local/private WebRTC address is exposed. Common on ordinary LANs, so it is off by default. |
| IP location change | On | A selected baseline field differs on two consecutive reads, 2 seconds apart. |
| Inconclusive result | Off | The WebRTC test is blocked or incomplete and **fail-closed** is enabled. |

Precedence is public IP leak, then local IP exposure, then location change, then inconclusive. An offline result is **not** a kill trigger: ShieldBar has no data to evaluate and reports **Protection degraded** instead.

A location mismatch is re-read after 2 seconds before it fires. This filters a single stale or inconsistent geolocation response. It does not filter a real server rotation, which will still trigger on the second read.

## While armed

- A full BrowserLeaks page load runs every **15 seconds**. This is intentionally aggressive and generates real traffic to BrowserLeaks.
- Network path changes, adapter changes, and wake trigger a check after a short settle delay (adapter polling is every 5 seconds).
- If BrowserLeaks is slow, rate-limiting, or unavailable, the result may be **Inconclusive** or **Offline**. With fail-closed enabled, an Inconclusive result can fire the kill switch. Offline does not fire automatically; ShieldBar rechecks when connectivity returns.

### Rate limits and backoff

The next check is scheduled only after the current one finishes, so checks never overlap. A trigger during a check collapses into one pending check. Offline retries slow to **60 seconds**. ShieldBar does not run a separate HTTP 429 retry loop: a blocked or rate-limited page is reported as Inconclusive or Offline. Fail-closed can fire on Inconclusive; Offline never fires the kill switch automatically, because connectivity is already down or unverifiable.

## What happens on a kill

1. ShieldBar asks the helper to disable networking.
2. The helper lists the non-loopback interfaces that are currently up, writes that snapshot to its state file **before** changing anything, and disables each entry.
3. The helper reports the network as triggered. ShieldBar disarms, clears the baseline, stops the interface poll, and shows **Network disabled** in the menu bar or system tray.
4. ShieldBar posts a notification naming the trigger, if notifications are allowed.
5. Nothing restores the network automatically.

Protection fires once per arming. After a trigger it is disarmed and will not fire again until you restore networking, capture a new baseline, and arm it again.

ShieldBar tries the helper's disable request twice, one second apart. If the helper returns a triggered state after a partial failure, ShieldBar still treats protection as triggered and shows **Network disabled with errors**. Some interfaces may remain up. Check the helper log or the operating system's network settings if you need to confirm that every interface is down.

Interfaces that appear **after** the trigger are not part of the snapshot and are not disabled. The kill is a one-time snapshot action, not a continuous firewall.

## Recovery

Restoring networking is always a manual action. Use the first method available to you.

### 1. ShieldBar UI

Open **Protection…** from the menu bar or system tray and choose **Restore Network**. On macOS, the Protection window also opens automatically when ShieldBar starts and finds a triggered helper state.

### 2. Menu bar or system tray

When networking is disabled, the context menu shows **Restore Network** at the top. On macOS, right-click the menu bar icon. On Windows and Linux, right-click the system tray icon.

### 3. App command line

The native macOS app and the Electron app both support `--restore-network` and exit after the restore attempt.

Run the macOS command as the same user who installed the helper, without `sudo`:

```sh
~/Applications/ShieldBar.app/Contents/MacOS/ShieldBar --restore-network
```

Adjust the path if the app is installed elsewhere. The helper authenticates the local user by UID; running the command as a different user will be rejected.

On Windows and Linux, run the Electron executable with the same flag:

```sh
# Windows: installed app or portable zip
ShieldBar.exe --restore-network

# Linux AppImage
./ShieldBar-1.1.0-linux-x86_64.AppImage --restore-network
```

For a `.deb` install, use the installed `shieldbar` executable. The helper still needs to be installed and running.

### 4. Helper command line

These commands require administrator/root privileges. Restore only the interfaces in the helper's snapshot.

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

Use `status` in place of `restore` to check the helper's triggered state without changing anything. If the helper CLI is unavailable, use the app's `--restore-network` flag or the operating system controls below.

### 5. Operating system controls

If the helper is unavailable, restore the interfaces directly:

| Platform | Manual recovery |
| --- | --- |
| macOS | System Settings → Network, enable the affected services. Or: `networksetup -listallnetworkservices`, then `sudo networksetup -setnetworkserviceenabled "Wi-Fi" on` and `sudo ifconfig en0 up`. |
| Windows | Settings → Network & internet → Advanced network settings (or Change adapter options), enable the adapters. Or, in elevated PowerShell: `Get-NetAdapter`, then `Enable-NetAdapter -Name "Wi-Fi" -Confirm:$false`. |
| Linux | `ip link` to list interfaces, then `sudo ip link set dev wlan0 up`. With NetworkManager, `sudo nmcli networking on` and `sudo nmcli device connect wlan0` may also be needed. |

After a manual OS restore, the helper may still believe it is triggered. Run **Restore Network** or the helper `restore` command to clear its state and re-enable anything it still tracks.

### Partial restore

If some interfaces fail to restore, the helper keeps the triggered state and reports which entries failed. Run restore again, check the helper log, and use the operating system controls for anything still down. Do not uninstall the helper until networking is restored.

### Reboot is not a recovery method

A reboot may or may not bring interfaces back. Some changes persist (macOS network services, Windows adapters); Linux `ip link` state normally resets. The helper's triggered state persists across reboots, so ShieldBar can still show **Network disabled** even if the connection is back. Run an explicit restore after boot.

## Quit, disarm, and crashes

- **Disarm** stops monitoring and leaves networking untouched. The in-memory baseline remains available until you change fields, trigger Protection, restore, or quit.
- **Quit while armed** shows a warning and disarms the kill switch. No checks run after the app exits.
- **Quit while triggered** shows a critical warning. Quitting leaves networking disabled; the helper and its state remain until you restore it.
- **Crash or force quit while armed** stops checks without firing the kill switch. The helper does not monitor the network on its own. This is a protection gap: ShieldBar must be running for Protection to evaluate anything.
- **Crash or force quit while triggered** leaves the interfaces disabled. Use the command line or OS controls.

## Uninstall the helper

Restore networking first. The app blocks helper removal until an active trigger has been restored.

1. Open **Protection…**, choose **Restore Network** if needed, then **Remove helper**.
2. Or run the helper's uninstall command with administrator/root privileges:

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

The uninstall removes the LaunchDaemon, systemd unit, or scheduled task, the helper binary, and the helper state directory. ShieldBar's own settings are separate and remain until you remove them.

If the helper binary is already gone but the service remains, remove the service manually:

```sh
# macOS
sudo launchctl bootout system/com.local.shieldbar.helper
sudo rm -f /Library/LaunchDaemons/com.local.shieldbar.helper.plist

# Linux
sudo systemctl disable --now shieldbar-helper
sudo rm -f /etc/systemd/system/shieldbar-helper.service
```

```powershell
# Windows, elevated PowerShell
schtasks.exe /End /TN ShieldBarProtectionHelper
schtasks.exe /Delete /TN ShieldBarProtectionHelper /F
```

## Failure modes

| Situation | What happens | What to do |
| --- | --- | --- |
| Helper not installed | Protection shows **Helper missing**; arming is blocked. | Install the helper, or use ShieldBar without Protection. |
| Admin/root approval canceled | Installation stops; no interfaces are changed. | Retry and approve, or leave Protection off. |
| Helper stops while armed | The app may not notice until a trigger or helper call; the network may not be cut. | Reinstall/restart the helper, then re-arm. |
| Helper cannot disable anything | Protection reports an error; the network may still be up. | Check the helper service and log; use OS controls. |
| Partial disable | Helper state is triggered and the app shows **Network disabled with errors**, even if some interfaces remain up. | Check the helper log and OS network settings; restore when ready. |
| Partial restore | Helper keeps the triggered state and lists failures. | Retry restore; use OS controls; do not uninstall yet. |
| BrowserLeaks unreachable | Protection is degraded; no kill because there is no data. | Restore connectivity; confirm the VPN; check again. |
| Inconclusive with fail-closed on | Kill switch fires. | Restore, investigate the blocked check, then decide whether fail-closed is appropriate. |
| New interface after trigger | It is not disabled; the snapshot is closed. | Restore, recapture a baseline, and re-arm if needed. |
| Reboot | Interfaces may return; helper state may still say triggered. | Run Restore Network or the helper restore command. |
| App crash or force quit while armed | No checks, no kill. | Relaunch, re-arm, and recapture the baseline. |
| App quit while triggered | Network stays disabled. | Use the menu bar or system tray, CLI, helper, or OS controls. |

## Remote sessions

Arming from SSH, RDP, VNC, or screen sharing is risky by design. If Protection fires, the interface carrying your session is disabled and you lose access. ShieldBar warns and requires acknowledgement when it detects a remote session, but detection is not guaranteed.

If you must arm remotely, make sure someone on site can restore the machine, or use an out-of-band management path that does not depend on the disabled interfaces.

## VPN detection limits

ShieldBar does not perform hard VPN detection. It looks at interface names and asks you to confirm. It cannot prove that traffic is inside the tunnel, that the VPN provider is trustworthy, or that the public IP belongs to the VPN. A VPN can be connected while selected traffic bypasses it; the WebRTC check is what catches a public mismatch, and it only covers ShieldBar's embedded engine.

## Beta status and test matrix

Protection is Beta because the destructive path has not been validated against real physical NICs on Windows and macOS, and end-to-end helper installation/restore on real machines is still pending.

| Area | Coverage |
| --- | --- |
| Strict evaluator and baseline logic | Swift Testing and Vitest unit tests |
| Helper snapshot, restore, idempotency, partial failures | Go unit tests with a fake backend |
| Helper service and protocol | Go unit tests exercise request handling; CI builds the packaged service. Peer-UID/SID checks are enforced in code. |
| Safe interface paths | A test-mode build restricts operations to `sbtest`, `feth`, and `bridge`; CI never cuts the runner's interfaces. |
| Renderer and protection window | Headless Electron smoke test |
| Live BrowserLeaks probe | Native and Electron self-tests; the CI live check is non-blocking |
| End-to-end helper install, restore, and reboot recovery | **Pending** on Windows and macOS |
| Physical NIC disable/restore | **Pending** on Windows and macOS |

Do not treat a green CI run as proof that the kill switch will cut every real adapter on your machine.

## Privacy

The baseline lives in memory only. Exact IPs are stored as salted hashes, and the salt is per app launch. The helper stores interface names, kinds, and up/down states; it does not store IP addresses, reports, or history. ShieldBar has no telemetry. While armed, the 15-second full page loads are visible to BrowserLeaks and may be rate-limited.

See [PRIVACY.md](PRIVACY.md) for the complete data-handling description.

## Related documentation

- [Troubleshooting](TROUBLESHOOTING.md)
- [Architecture](ARCHITECTURE.md)
- [Privacy](PRIVACY.md)
- [Build](BUILD.md)
