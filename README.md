# Stream Cinema / KRA Stremio & Nuvio addon v2.4.1

This build uses one known-working Stremio upstream (`UPSTREAM_STREMIO_BASE`) for catalogs/meta/streams and keeps the native KRA/APK resolver as fallback.

## What changed in 2.4.1

- **Only one cder/upstream configuration is needed.** `UPSTREAM_STREMIO_BASE_DUBBED` is no longer used.
- Added derived catalogs:
  - `🇨🇿🇸🇰 SC: Novinky dabované – filmy`
  - `🇨🇿🇸🇰 SC: Novinky dabované – seriály`
- The dubbed catalogs load the normal latest catalog and inspect each title's returned stream labels/metadata. Titles with CZ/CS/SK/Czech/Slovak audio markers are kept.
- Dubbed detection is cached for 30 minutes and checked in parallel to avoid re-scanning the whole latest catalog on every request.
- Added optional **TMDB metadata enrichment** for movie/series details: Czech title/plot where available, poster, backdrop, genres, cast, director, runtime, country, release year and rating.
- Existing upstream metadata is preserved when TMDB has no replacement.

## Required Render environment variables

```text
CONFIG_SECRET=<long random secret>
UPSTREAM_STREMIO_BASE=https://cder.club/stremio/YOUR_PRIVATE_CONFIG_ID
```

`UPSTREAM_STREMIO_BASE` must not end with `/manifest.json`.

## Optional TMDB metadata

Set **one** of these in Render → Environment:

```text
TMDB_API_KEY=your_tmdb_v3_api_key
```

or:

```text
TMDB_READ_ACCESS_TOKEN=your_tmdb_read_access_token
```

After redeploy, `/health` should show:

```json
{
  "version": "2.4.1",
  "bridge": true,
  "tmdb": true
}
```

TMDB matching first uses an IMDb ID when one is available, then falls back to title + year. Metadata is requested in `cs-CZ`.

## ČSFD

There is no ČSFD API dependency in this build. If the upstream metadata already contains a ČSFD link/field it is preserved. TMDB is used as the stable enrichment source.

## Useful checks

```text
/health
/bridge-check.json
/<CONFIG>/diagnostics.json?catalog=sc-movie-latest-dubbed
/<CONFIG>/diagnostics.json?catalog=sc-series-latest-dubbed
```

The first request for a dubbed catalog can be slower because it has to inspect streams for the latest titles. Subsequent requests use a 30-minute in-memory cache.

## Catalogs

The manifest includes the base cder catalogs plus derived year/genre catalogs, CZ/SK dubbed latest movies/series, and Music/Concerts.


## v2.4.1 stream compatibility
- Stremio idPrefixes corrected to `tt` and `sc` exactly like the working cder addon.
- Stream bridge preserves the upstream item ID and forwards it directly to cder.
- New diagnostic: `/bridge-stream-check.json?type=movie&id=tt...` (or an `sc...` id).
