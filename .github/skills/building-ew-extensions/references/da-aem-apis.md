# DA and AEM APIs an extension can call

All calls use the author's IMS token: `Authorization: Bearer ${token}`. They work from the browser (CORS allowed) unless noted.

## Contents
- [Document source (admin.da.live)](#document-source-admindalive)
- [Listing and config](#listing-and-config)
- [Preview, publish and status (admin.hlx.page)](#preview-publish-and-status-adminhlxpage)
- [Published pages and indexes](#published-pages-and-indexes)
- [Error handling](#error-handling)

## Document source (admin.da.live)

| Purpose | Call |
|---|---|
| Read draft | `GET https://admin.da.live/source/{org}/{site}{path}.html` with `cache: 'no-store'`. `/` and folders map to `/index` |
| Exists / can read | `HEAD` same URL (200 / 404 / 401 / 403) |
| Create or overwrite | `PUT` same URL, multipart `FormData` field **`data`** = `Blob([html], {type:'text/html'})` |
| Upload media | `PUT https://admin.da.live/source/{org}/{site}/media/…/{file}` field `data` |
| Write permission | Response header `x-da-actions` on GET or HEAD (contains `write` when allowed) |
| Versions | DA keeps a version list per document (`/versionlist/…`). **Unverified** from extensions; test before building block history on it |

The newer AEM source API is `https://api.aem.live/{org}/sites/{site}/source{path}.html`. Use it as a fallback **on 404 only**.

A draft is an HTML document whose `<main>` holds section `div`s, and blocks appear as **tables** inside them. The Metadata block is present in the draft, unlike in the live-document stream.

## Listing and config

| Purpose | Call |
|---|---|
| List folder | `GET https://admin.da.live/list/{org}/{site}{folder}` returns `[{path, name, ext, lastModified}]` |
| Site config | `GET https://admin.da.live/config/{org}/{site}/`. Fallback: `https://api.aem.live/{org}/sites/{site}/config/editor/da.json` |
| Org config | `GET https://admin.da.live/config/{org}/` |
| Write config | `PUT` multipart field **`config`** = full JSON (keep the other sheets) |
| Private content | `https://content.da.live/{org}/{site}/…` needs the bearer token (401 without it). External services can't fetch it |

## Preview, publish and status (admin.hlx.page)

```js
const opts = { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'x-content-source-authorization': `Bearer ${token}` } };
await fetch(`https://admin.hlx.page/preview/${org}/${site}/main${path}`, opts); // then:
await fetch(`https://admin.hlx.page/live/${org}/${site}/main${path}`, opts);
```

- Run preview **before** live, in sequence. Newer AEM fallback (on 404 only): `POST https://api.aem.live/{org}/sites/{site}/{preview|live}{path}`.
- Lowercase the path. Read the `x-error` response header for the reason on failures.
- 401/403 means the author can't publish. Say so and point them at EW's own Publish button.
- Status: `GET https://admin.hlx.page/status/{org}/{site}/main{path}` returns `{preview: {status, lastModified}, live: {status, lastModified}, edit: {…}}`. Use it to show "Not live yet" and "Draft newer than live".
- Unpublish: `DELETE` on `/live/…`. Ask the author to confirm first.
- Hosts: preview `https://main--{site}--{org}.aem.page{path}`, live `https://main--{site}--{org}.aem.live{path}`.

## Published pages and indexes

- `https://main--{site}--{org}.aem.live{path}.plain.html` gives the `<main>` content only. It **can lag** the full page on the CDN. For freshness, fetch the full page with `?nocache={Date.now()}` and extract `<main>` and `<head>`.
- `query-index.json` (`/query-index.json`, or the configured index) lists published pages for duplicate checks and link pickers. Reading it cross-origin from a panel needs CORS headers on the site (`headers` config). If you can't set that, read it through your worker or the DA list API.
- Published `<head>` holds the final metadata (`og:*`, `twitter:*`, `description`). Compare draft and live through these.

## Error handling

| Status | Meaning | Do |
|---|---|---|
| 401 | Token expired or missing | "Your session expired. Reload Experience Workspace." Do **not** fall back to another URL |
| 403 | No access | "You don't have access to this page." Do not fall back |
| 404 | Not found | Fall back to the next source, or treat as "doesn't exist" |
| 409/412 | Write conflict | Re-read and ask the author |
| 5xx / network | Service problem | Retry an idempotent read once, then show the error. Never auto-retry a PUT or POST |

Put the HTTP status in error messages ("Document Authoring answered 502") so authors can report it.
