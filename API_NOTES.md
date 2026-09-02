# APK API notes

These notes document the API contract recovered from the supplied `app-universal-release.apk` and used by this addon.

## HTTP identity

The app's OkHttp interceptor adds:

- `User-Agent: Kodi/21.0 (Linux; Android) (sk;; ver2.6.6.0+k19)`
- `X-Uuid: <persistent Stream Cinema UUID>`

The addon generates one UUID per configured install and stores it inside the encrypted configuration token.

## KRA

Base URL: `https://api.kra.sk/`

### Login

`POST api/user/login`

```json
{
  "data": {
    "username": "...",
    "password": "..."
  }
}
```

Relevant response field: `session_id`.

### User info

`POST api/user/info`

```json
{
  "session_id": "..."
}
```

### Resolve file

`POST api/file/download`

```json
{
  "data": {
    "ident": "..."
  },
  "session_id": "..."
}
```

Relevant response field: `data.link`.

The APK also defines `api/file/list`, `api/file/create`, and `api/file/delete`, but this stream addon does not need them.

## Stream Cinema

Base URL: `https://stream-cinema.online/`

Default API arguments recovered from Kotlin default methods:

- `ver=2.0`
- `lang=sk`
- `skin=skin.estuary`
- `HDR=1`
- `DV=0`
- `old=1`
- persistent `uid`

### Auth token

`POST kodi/auth/token`

Query parameters include:

- `krt=<KRA session_id>`
- the default arguments above

Relevant response field: `token`.

Subsequent dynamic requests send the token as `X-AUTH-TOKEN`.

### Search

`GET kodi/Search/{searchId}`

Movie search ID: `search-movie`  
Series search ID: `search-series`

The app sends:

- `search=<query>`
- `id=<searchId>`
- normal default arguments and `X-AUTH-TOKEN`

The optional `ms` query argument is used for people search; normal movie/series search leaves it unset.

## Signed KRA identifiers

For a KRA-backed `ScStream`, the APK first follows `ScStream.url` through Stream Cinema. The resulting `ScResponse` contains:

- `version`
- `v1`
- `v2`

The app creates `v<version>:<payload>`.

Behavior recovered from `decryptStreamCinemaIdent`:

- unknown/non-version-prefixed input: return as-is
- `v0:<payload>`: return payload as-is
- `v1:<payload>` / `v2:<payload>`: RSA public operation + PKCS#1 v1.5 block-type-1 recovery
- unsupported versions: reject

The public RSA modulus and exponent (`0x10001`) are embedded in the APK and reproduced in `src/sc.js`. The recovered plaintext is the actual `ident` passed to KRA `api/file/download`.


## Search request verified from APK bytecode (v1.0.2)

For normal title search the Android app calls:

- path: `kodi/Search/search-movie` or `kodi/Search/search-series`
- `search=<title>`
- `id=search-movie` / `id=search-series` (the same value as the path parameter)
- `ms` omitted for title search
- `ms=1` only for `search-people*`
- defaults: `ver=2.0`, `lang=sk`, `skin=skin.estuary`, `HDR=1`, `DV=0`, `old=1`

The `id` parameter is **not** an IMDb ID.
