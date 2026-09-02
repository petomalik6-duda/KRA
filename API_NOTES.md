# API notes – v2.4.0

- Bridge mode uses one private `UPSTREAM_STREMIO_BASE`.
- Derived dubbed catalogs do not require a second cder configuration. They filter the upstream latest catalog by inspecting `stream/{type}/{id}.json` and looking for CZ/CS/SK audio markers.
- Results are cached for 30 minutes.
- TMDB enrichment is optional and server-side only. Credentials are read from `TMDB_API_KEY` or `TMDB_READ_ACCESS_TOKEN` and are never included in the Stremio configuration URL.
- TMDB lookup flow: IMDb external ID (`/find/{imdb}`) -> movie/TV details; fallback to title/year search if no IMDb ID can be recovered.
- Native KRA/APK code remains as a fallback for routes where the bridge is unavailable.
