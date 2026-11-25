# Testing and debugging

## Contents
- [Test layers](#test-layers)
- [Unit tests](#unit-tests)
- [Browser checks outside EW](#browser-checks-outside-ew)
- [Inside EW](#inside-ew)
- [Debugging recipes](#debugging-recipes)
- [Before a PR](#before-a-pr)

## Test layers

| Layer | Tool | Catches |
|---|---|---|
| Pure logic (`lib/`) | `node --test` | Parsing, conversion, config, validation, edge cases |
| Worker | `node --test` calling `handle()` with a stubbed `fetch` | Auth, CORS, routing, third-party error mapping |
| Panel in a browser (`?demo=1`) | Playwright or Puppeteer, or manual | Layout at 320 px, states, focus, toasts |
| Mock host | A page that iframes the panel and plays the SDK protocol | Insert and replace guards, live updates, conflicts |
| Real EW (`?ref=local`, then a branch) | Manual, with a video | Real normalization, timing and permissions |

Unit tests can't catch layout, focus or write-back problems. Do at least one browser pass for every UI change.

## Unit tests

- Use `node:test` + `node:assert/strict`. There's no framework. Use `linkedom` (a devDependency) for DOM parsing in Node.
- Add the folder to `package.json` → `"test": "node --test … tools/{name}/test/"` and add `tools/{name}/test/*` to `.hlxignore`.
- Stub `globalThis.fetch` per test and restore it in `afterEach`. Assert the URLs, methods and headers that were called.
- Give modules with in-memory state a `resetState()` or `resetCache()` export for tests.
- Use fictional data only (Northwind Bank). Fake tokens must not look real: use `'ims-token'`, not a JWT-shaped string.
- Build dangerous strings without writing them literally (`['java', 'script:alert(1)'].join('')`) so secret and XSS scanners don't flag the tests.

## Browser checks outside EW

```bash
npx -y @adobe/aem-cli up            # http://localhost:3000 (leave it running)
open "http://localhost:3000/tools/{name}.html?demo=1"
```

- The demo has to work with no SDK, no token and no network beyond `localhost`.
- Check at widths 320, 400 and 600, and in dark OS mode (`color-scheme: light` keeps it readable).
- Puppeteer or Playwright screenshots catch toolbar wrapping and overflow. Keep scripts outside the repo, or in `.hlxignore`d `demo/*.mjs`.

## Inside EW

1. `aem up` on port 3000.
2. Open `https://da.live/edit#/{org}/{site}/{page}?ref=local` (EW canvas) and pick your extension from Extensions. For apps, use `https://da.live/app/{org}/{site}/tools/{name}?ref=local`.
3. Watch the console for messages from your iframe; filter by its URL.
4. Test with Grammarly and other header- or DOM-changing browser extensions **turned off**. They break `contenteditable` and requests.
5. Then push a branch and test `?ref={branch}` before merging. Code Sync can take a minute.

## Debugging recipes

| Question | How |
|---|---|
| Did the SDK init? | Log `capabilities` and `context` in `startLive`. If you see nothing after 4 s, the panel is in demo mode: check the static import and the iframe URL |
| What does EW send? | Log `html.length` and `selection` in `subscribeLiveDocument`. Copy one payload into a test fixture |
| Why did replace fail? | Log `result.error` and `result.message`. Compare `expected.html` with the latest live block |
| Is the draft saved yet? | `GET` the source with `no-store` and diff it against what you expect. The save lags 2–10 s |
| Is published content stale? | Compare `.plain.html` with the full-page `<main>`. Add `?nocache=` |
| Is the worker rejecting? | `curl -i {worker}/status`, then a POST with `Authorization: Bearer …` (from devtools; never paste it into chat or logs) |
| CORS error? | The preflight is missing an allowed origin, or the request has a custom header. A Figma plugin has origin `null` |
| Layout view shows raw links or buttons? | Site quick-edit decoration (see gotchas), not your HTML |

## Before a PR

```bash
npm run lint      # ESLint (airbnb-base) + Stylelint
npm test          # every node --test folder
node <skills>/building-ew-extensions/scripts/check-extension.mjs --name {name}
```

The PR description must include `https://{branch}--{site}--{org}.aem.page/{path}` test links, or the repo's PR checks reject it. Fill in the repo's PR template.
