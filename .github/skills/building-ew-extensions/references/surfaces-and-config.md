# Surfaces and configuration

## Contents
- [File layout](#file-layout)
- [Registering the extension](#registering-the-extension)
- [Loading code from a branch or localhost](#loading-code-from-a-branch-or-localhost)
- [Your own settings sheet](#your-own-settings-sheet)
- [Reading site config in code](#reading-site-config-in-code)
- [Choosing the surface](#choosing-the-surface)

## File layout

```
tools/{name}.html            entry page (EW loads this)
tools/{name}/{name}.js       controller: SDK, state, actions
tools/{name}/panel.js        rendering only (receives state + actions)
tools/{name}/{name}.css      scoped styles
tools/{name}/icon.svg        menu icon (24×24 viewBox, currentColor)
tools/{name}/lib/*.js        pure logic, unit tested, no SDK import
tools/{name}/demo/*.json     demo fixtures (served; Northwind-style fictional data)
tools/{name}/test/*.test.js  node:test (in .hlxignore)
tools/{name}/worker/         Cloudflare Worker (in .hlxignore)
tools/{name}/docs/           screenshots for README (in .hlxignore)
tools/{name}/README.md       *.md is already in .hlxignore
tools/{name}/marketplace.png 1200×896 Marketplace card image
```

Extra Prepare dialogs are more pages: `tools/{name}/publish.html` plus `publish.js`, sharing `lib/`.

## Registering the extension

Sheets go in the site config at `https://da.live/config#/{org}/{site}`, or `#/{org}/` to apply to every site in the org. Paths are full URLs, usually `https://main--{site}--{org}.aem.live/tools/...`.

**`library`** adds the panel to the Extensions menu:

| title | path | icon | experience | ref | format |
|---|---|---|---|---|---|
| My Tool | `https://main--site--org.aem.live/tools/my-tool.html` | `https://…/tools/my-tool/icon.svg` | `inline` | optional | optional |

**`prepare`** adds a dialog to the **⋯** menu next to Publish:

| title | path | icon | experience |
|---|---|---|---|
| Publish & Share | `https://…/tools/my-tool/publish.html` | `https://…/icon.svg` | `fullsize-dialog` |

**`apps`** adds a fullscreen app, opened at `https://da.live/app/{org}/{site}/{path-without-.html}`:

| title | description | image | path | ref |
|---|---|---|---|---|

After saving the config, **reload EW**. Config is read when EW loads.

Hosted vs self-hosted: any site can point its `library` row at *your* published URL (`main--{site}--{owner}.aem.live/tools/{name}.html`). The code runs in the author's browser with their token, so this is safe. Write the README with both options: "use the hosted copy" and "copy into your repo".

## Loading code from a branch or localhost

- `?ref=local` on the da.live URL loads plugin paths from `http://localhost:3000`, where `aem up` runs.
- `?ref={branch}` loads from `{branch}--{site}--{org}.aem.page`.
- EW previews pages from `{branch}--{site}--{org}.preview.da.live`.
- Examples:
  - `https://da.live/edit#/{org}/{site}/drafts/test?ref=local`
  - `https://da.live/app/{org}/{site}/tools/my-tool?ref=local`

## Your own settings sheet

Add a sheet named after the extension, with `key | value` rows. EW ignores sheets it doesn't know about.

| key | value |
|---|---|
| worker-url | `https://my-tool.example.workers.dev` |
| default-folder | `/drafts` |

Rules:
- Every key has a default in code. Missing config means defaults, or the feature hides itself. It never means an error.
- Any key can be overridden by a URL parameter of the same name (`my-tool.html?worker-url=…`). This is handy for testing a new worker without editing config.
- Check URL values: allow only `https://` or `http://localhost` worker URLs, and strip trailing slashes.
- For lists, use a second sheet (`my-tool-sources: title | id | filter`).
- For per-type rules, use columns (`reviewloop-types: type | assignee | checklist | due-days`).

## Reading site config in code

```js
export async function loadSiteConfig(token, { org, site }, fetchImpl = fetch) {
  const urls = [
    `https://admin.da.live/config/${org}/${site}/`,
    `https://api.aem.live/${org}/sites/${site}/config/editor/da.json`,
  ];
  for (const url of urls) {
    try {
      const resp = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) return await resp.json();
      if (resp.status === 401 || resp.status === 403) return null; // don't fall through on auth errors
    } catch { /* try the next one */ }
  }
  return null;
}
```

Shape: a single sheet is `{ data: [...] }`; several sheets are `{ ':names': [...], sheetName: { data: [...] } }`. Handle both, and match column names case-insensitively and trimmed.

Org config (`/config/{org}`) and site config (`/config/{org}/{site}`) can both exist. To support org-wide defaults, fetch both in parallel and let site rows override org rows.

Writing config: PUT multipart with the field `config` (not `data`). **Preserve every other sheet.** Read, modify and write the whole JSON.

## Choosing the surface

- Edits the open page → **panel**. Only panels get `liveDocument` and `sendHTML`.
- Happens at publish time, or needs a big screen for a single action → **Prepare dialog**. It can still publish through admin.hlx.page and call a worker.
- Works across pages → **app**.
- A **Prepare dialog cannot gate EW's native Publish button.** "Require approval" only applies inside your own dialog. Enforcement needs platform permissions or Preflight (`editor.enforcePreflight`). An iframe extension cannot register checks into native Preflight; this is unverified, so assume it can't.
