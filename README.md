# KRA • Stream Cinema – Stremio / Nuvio addon

Stream-only addon reconstructed from the API contracts and playback logic in the supplied Android APK.
It uses the user's own KRA account and Stream Cinema metadata/search. It does **not** contain a catalog; install it alongside Cinemeta or another movie/series catalog.

## What is implemented

- Stremio addon protocol for `movie` and `series`, IMDb IDs (`tt...`).
- Series IDs in the standard `tt...:season:episode` form.
- KRA login: `POST https://api.kra.sk/api/user/login`.
- KRA subscription/account check: `/api/user/info`.
- Stream Cinema authentication using the KRA session: `POST https://stream-cinema.online/kodi/auth/token`.
- Stream Cinema search IDs `search-movie` and `search-series`.
- The APK's request identity headers (`User-Agent` and `X-Uuid`).
- The APK's `v0:`, `v1:` and `v2:` Stream Cinema identifier handling, including RSA/PKCS#1 signed-ident recovery before `/api/file/download`.
- KRA stream resolving via `POST /api/file/download`.
- Multiple streams, quality/language ordering, CZ/SK preference.
- Encrypted configuration tokens when `CONFIG_SECRET` is set.
- `/health` and per-install `/diagnostics.json` endpoints.

## Deploy on Render

1. Create a new GitHub repository and upload all files from this folder.
2. In Render choose **New → Blueprint** and select the repository. `render.yaml` contains the service configuration.
3. Render generates `CONFIG_SECRET` automatically. Do not remove it. If you deploy manually, create a long random `CONFIG_SECRET` yourself.
4. When deployment is live, open:

   `https://YOUR-SERVICE.onrender.com/configure`

5. Enter your KRA username/password. The configurator validates KRA login and Stream Cinema authentication before returning the addon URL.
6. Install the returned manifest URL in Stremio. In Nuvio, add the same manifest URL as a Stremio-compatible addon.

## Diagnostics

Basic server health:

`/health`

Configured account/API check:

`/<CONFIG_TOKEN>/diagnostics.json`

Test a concrete title without exposing tokens in server logs:

`/<CONFIG_TOKEN>/diagnostics.json?type=movie&id=tt0133093`

Series example:

`/<CONFIG_TOKEN>/diagnostics.json?type=series&id=tt1234567:1:1`

The diagnostic response reports the stage (`search`, `branch`, `resolve`, or `ok`) and counts, but does not return the KRA password, KRA session, or Stream Cinema auth token.

## Environment variables

- `PORT` – server port; Render sets it automatically.
- `CONFIG_SECRET` – **required for production**; AES-256-GCM encrypts the config payload embedded in the manifest URL.
- `DEBUG=1` – optional verbose logs. Sensitive query values are redacted where logging is performed.

## Important notes

- Upstream KRA / Stream Cinema APIs are private implementation details of the supplied app and can change without notice.
- A valid KRA account/subscription is required.
- Direct stream URLs can be short-lived, so the addon resolves them when Stremio/Nuvio requests streams rather than caching them long-term.
- End-to-end playback cannot be validated without a real KRA account. Unit tests validate local routing/helpers and the identifier algorithm structure.

## Local run

Requires Node.js 20+.

```bash
export CONFIG_SECRET='choose-a-long-random-secret'
npm start
```

Open `http://localhost:3000/configure`.

Run tests:

```bash
npm test
```
