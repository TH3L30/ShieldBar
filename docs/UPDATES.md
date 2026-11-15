# Update alerts

ShieldBar checks a signed release feed so it can tell you when a new version is available. It does **not** download or install updates automatically.

## Behavior

- Check about 8 seconds after launch and every 24 hours while ShieldBar is running.
- Manual **Check for Updates…** in Settings and the tray/menu bar.
- Show an in-app banner and one OS notification per new version.
- **View Release** opens the GitHub release page in your browser.
- Dismissing an update hides the banner for that version.
- The optional signature-protected security notice can appear even without a version change.
- Automatic checks can be disabled in Settings. Manual checks remain available.

The feed is public:

```text
https://github.com/TH3L30/ShieldBar/releases/latest/download/latest.json
https://github.com/TH3L30/ShieldBar/releases/latest/download/latest.json.sig
```

## Signed feed

Each release publishes `latest.json` and a detached Ed25519 signature in `latest.json.sig`. The apps verify the exact bytes of the manifest with an embedded public key before parsing it. The private key exists only as the `UPDATE_SIGNING_KEY` GitHub Actions secret.

The manifest contains:

```json
{
  "schema": 1,
  "version": "1.1.2",
  "releasedAt": "2026-11-15T00:00:00.000Z",
  "releaseUrl": "https://github.com/TH3L30/ShieldBar/releases/tag/v1.1.2",
  "notice": null
}
```

An optional notice can carry a short security message:

```json
{
  "id": "2026-11-security",
  "severity": "critical",
  "title": "Security notice",
  "message": "Please update to the latest release.",
  "url": "https://github.com/TH3L30/ShieldBar/releases/tag/v1.1.2"
}
```

Release URLs are restricted to `https://github.com/TH3L30/ShieldBar/releases/`. Invalid signatures, versions, dates, and URLs are rejected.

## Privacy

The update check fetches two small files from GitHub. GitHub receives the usual network metadata, including your IP address and user agent. ShieldBar sends no device identifier, account, or usage data. The only update state stored locally is the automatic-check preference and the last notified/dismissed version IDs.

Disable **Check for updates automatically** in Settings if you do not want these requests. Manual checks are always your choice.

## Publishing the feed

The release workflow generates and signs the manifest for every `v*` tag. The private signing key is configured once:

```sh
gh secret set UPDATE_SIGNING_KEY --repo TH3L30/ShieldBar < update-signing-key.pem
```

Tag the release and the workflow uploads `latest.json` and `latest.json.sig` alongside the installers. The public key is committed in the apps, never the private key.

## Troubleshooting

- **“The update feed is unavailable”** — GitHub may be unreachable or the latest release may not have a manifest yet.
- **“The update manifest signature is invalid”** — do not trust the feed. Check the release assets and signing key.
- **No banner appears** — the version may already be current, the update may be dismissed, or automatic checks may be disabled.
- **No notification** — the OS may have notifications disabled for ShieldBar.
- **1.1.1 and earlier** do not have the updater; they cannot be notified about later releases.
