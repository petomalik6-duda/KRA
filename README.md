# Stream Cinema / KRA addon v2.2.0

Stremio/Nuvio addon with catalogs, metadata and streams.

## Modes

1. **Bridge mode (recommended now):** proxies catalog/meta/stream requests to a known working Stream Cinema Stremio addon. Configure `UPSTREAM_STREMIO_BASE` on Render. This keeps the working upstream URL private and lets your own Render URL be installed in Stremio/Nuvio.
2. **Native KRA/APK fallback:** if `UPSTREAM_STREMIO_BASE` is empty, the addon uses the reconstructed KRA + Stream Cinema API implementation from the supplied APK.

## Catalogs

- SC: Najnovšie filmy
- SC: Populárne filmy
- SC: Najnovšie seriály
- SC: Populárne seriály
- SC: Filter filmov (genre/year/letter)
- SC: Filter seriálov (genre/year/letter)

The manifest structure mirrors the working cder.club Stream Cinema addon: resources `catalog`, `meta`, `stream`, types `movie`,`series`, IDs `tt` and `sc`.

## Render deployment

Upload the repository and deploy it. Keep `CONFIG_SECRET` unchanged.

In **Render → Environment**, add:

`UPSTREAM_STREMIO_BASE`

Set it to the working addon URL **without** `/manifest.json`.

Example shape only:

`https://example.com/stremio/your-private-id`

Do not commit this value to GitHub.

Then redeploy and check:

- `/health` → should show `version: 2.2.0` and `bridge: true`
- `/configure` → create your own addon URL

The generated manifest URL can be installed in both Stremio and Nuvio.

## Security

Treat `UPSTREAM_STREMIO_BASE` as private because it may identify an already-configured upstream account. Store it only as a Render environment variable.


## Rozšírené katalógy v2.2.0
Okrem pôvodných cder katalógov táto verzia pridáva odvodené katalógy podľa roku a žánru. V bridge režime sa mapujú na upstream `sc-movie-filter` / `sc-series-filter`, takže nevyžadujú nové upstream route.

Filmy: 2026, 2025, Akčné, Komédie, Horory, Sci‑Fi, Krimi, Thrillery, Dokumenty, Animované, Rodinné, Romantické.

Seriály: 2026, 2025, Dráma, Komédie, Krimi, Sci‑Fi, Thriller, Dokumentárne, Animované.
