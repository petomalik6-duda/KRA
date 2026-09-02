# KRA • Stream Cinema APK addon v2.0.0

Stremio/Nuvio addon reconstructed from the supplied Android APK. Unlike the older stream-only bridge, this version exposes Stream Cinema catalog paths from the APK and uses local `sc:` IDs so titles opened from a catalog can be resolved directly without searching the title again.

## Features

- KRA login and session handling
- Stream Cinema authentication
- movie and series catalogs from the APK
- local `sc:` IDs carrying the original SC navigation path
- metadata route
- series episode discovery by traversing the SC branch
- KRA stream resolving
- CZ/SK preference
- encrypted configuration using `CONFIG_SECRET`
- diagnostics for IMDb lookup and catalog transport

## Catalogs

Movies: Novinky, Novinky dabované, TOP dnes, TOP týždeň, Trendy, Najnovšie streamy.

Series: Novinky, Novinky dabované, Najnovšie pridané, Najnovšie epizódy, TOP dnes, TOP týždeň, Trendy.

Other movie-type catalogs: HDR novinky, Dokumenty novinky, Koncerty novinky.

See `APK_CATALOGS.md` for the paths extracted from the APK.

## Render

Recommended: deploy from `render.yaml` as a Blueprint. If using an existing Web Service, create a persistent environment variable named `CONFIG_SECRET` manually, for example with `openssl rand -base64 48`. Never change it after creating configured addon URLs.

After deploy:

1. Open `/health` and confirm version `2.0.0`.
2. Open `/configure` and enter the user's own KRA credentials.
3. Install the generated manifest in Stremio or Nuvio.
4. Test a catalog.

## Catalog diagnostics

For the Movies / New catalog:

`/<CONFIG>/diagnostics.json?catalog=sc-movie-latest`

For Series / New:

`/<CONFIG>/diagnostics.json?catalog=sc-series-new`

The response reports the APK path, selected transport route, number of extracted items, response shape, and safe raw preview when relevant.

## Legacy IMDb stream diagnostics

`/<CONFIG>/diagnostics.json?type=movie&id=tt0133093`

The `tt...` compatibility path remains available, but the preferred flow is catalog -> local `sc:` id -> direct SC branch -> KRA stream.
