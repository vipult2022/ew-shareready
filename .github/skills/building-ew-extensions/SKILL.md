---
name: building-ew-extensions
description: Builds Adobe Experience Workspace (EW, da.live, Document Authoring) extensions for AEM Edge Delivery Services sites, including library panels, Prepare-menu dialogs and fullscreen apps. Covers the DA App SDK (sendHTML, replace, subscribeLiveDocument, setPrompt, capabilities, token refresh), DA and AEM admin APIs, Cloudflare Worker proxies for third-party APIs (Slack, Jira, Airtable, Notion, Figma, Meta, IndexNow), live block editing, config-driven generic design, demo mode, tests and debugging. Use when creating, extending, debugging or reviewing an EW extension, plugin, app or tool under tools/, or when the user mentions EW, da.live, DA SDK, library plugin, Prepare menu, block editor or Experience Workspace extension.
license: Apache-2.0
metadata:
  version: "1.0"
  learned-from: "ShareReady, ReviewLoop, Airtable, Notion, Figma handoff and Block Studio"
---

# Building Experience Workspace extensions

An EW extension is a plain HTML/JS page in the site's code repo (`tools/{name}.html` + `tools/{name}/`). EW loads it in an iframe and talks to it through the DA App SDK (`postMessage` over a `MessagePort`). There is no build step and no framework. Secrets never go in the browser: any third-party call that needs a key goes through a small worker.

**Paths:** `<skills>` below means the folder that holds this skill. That is `.github/skills` in a repo, `~/.copilot/skills` or `~/.claude/skills` for personal skills, or the installed plugin's `skills/` folder. Run every script from the **site repo root**.

## Pick the surface first

| Author need | Surface | Config sheet | `experience` | Can edit the page? |
|---|---|---|---|---|
| Work beside the page while editing (preview, insert, form editor) | Library panel | `library` | `inline` | Yes: `sendHTML`, replace, live document |
| One action from the **⋯** menu next to Publish (publish & share, request review) | Prepare dialog | `prepare` | `fullsize-dialog` | **No.** Context and token only. `closeLibrary` does nothing; the host draws the close button |
| A site-wide tool (audit, report, bulk change) | Fullscreen app | `apps` | n/a | No document. Any API the token allows |

Strong extensions often pair a panel (the author flow) with a Prepare dialog (the publish-time action). Details are in [references/surfaces-and-config.md](references/surfaces-and-config.md).

## Build workflow

Copy this checklist and track it:

```
EW extension progress:
- [ ] 1. Write the author story: problem → clicks → result. Pick the surface(s). Name the third party and anything that needs a secret.
- [ ] 2. Scaffold: node <skills>/building-ew-extensions/scripts/new-extension.mjs --name {name} --title "{Title}" [--worker]
- [ ] 3. Put pure logic in tools/{name}/lib/*.js with node:test unit tests. lib/ never imports the SDK.
- [ ] 4. Demo mode (?demo=1) with a fixture shaped exactly like the live or worker response.
- [ ] 5. Panel UI with loading, setup-needed, empty, error, busy and demo states. Render data with text nodes, never innerHTML.
- [ ] 6. Live mode: SDK race with a timeout, capability checks, token refresh, guarded writes.
- [ ] 7. Worker, only if a secret or a CORS-blocked API is involved: IMS check, org allow-list, CORS, rate limit.
- [ ] 8. Config: a site sheet `{name}` (key | value) that URL params can override. With no config the feature works or hides itself.
- [ ] 9. Verify: npm run lint, npm test, demo in a browser, then ?ref=local inside EW, then a branch preview.
- [ ] 10. Check: node <skills>/building-ew-extensions/scripts/check-extension.mjs --name {name}
- [ ] 11. Ship the README, Marketplace image, demo link and video with the shipping-ew-extensions skill.
```

## Golden rules (each one cost a debugging session)

**SDK and lifecycle**
1. Import the SDK **statically** at the top of the main module. A late or dynamic import can miss EW's one-time ready message.
2. `await DA_SDK` **never resolves outside EW.** Race it against a 4 s timeout and fall back to demo mode. Skip the SDK entirely when `window.parent === window` or `?demo` is set.
3. Read `context.repo || context.site`, since both appear. Normalize `path`: drop `.html`, and map `/` to `/index` for the source API.
4. Check `sdk.capabilities.X === 1` before using `liveDocument`, `sendHTMLReplace`, `chatTurnCompleted` or `dragDrop`. Wrap optional actions in `try` with a working fallback.
5. Tokens expire. Keep the token in state and update it from `message` events where `e.source === window.parent && e.data?.token`. Read the current token at call time (`() => state.token`).

**Reading the page**
6. The live-document HTML from `subscribeLiveDocument` **leaves out the Metadata block**. For metadata, merge in the saved draft from the source API.
7. The live stream reports `selection.blockIndex` only: no cursor offset and no DOM node. A panel cannot move the author's cursor or select a block.
8. Saved drafts lag edits: collaborative save is debounced about 2 s (up to about 10 s). After a write, re-read on a schedule or until the saved content matches. Use `cache: 'no-store'`.
9. `.plain.html` on aem.page and aem.live can lag the full page on the CDN. Fetch the full page, take `<main>`, cache-bust, and retry once if it looks stale.

**Writing to the page**
10. `sendHTML(html)` inserts **at the cursor**, gives no result and cannot update an existing block. Refuse to insert when `blockIndex !== null` (the cursor is inside a block) and ask the author to click an empty line.
11. To change an existing block, use `sendHTML(html, { replace: true, expected: { html, blockIndex } })` and handle `{ ok: false, error }` (`STALE_LIVE`, `WRONG_SELECTION`, …). Show a stale result to the author as a conflict. Never retry it blindly.
12. Allow one write in flight. Debounce typing (about 800 ms, 150 ms on blur). Re-parse what EW sends back, because EW normalizes HTML.
13. Write DA block **tables** (the first row names the block), not EDS `div` markup. Copy expiring third-party images into DA media before inserting them.

**Async and UI**
14. Give every async load a sequence number so a slow, older response can't overwrite newer state.
15. Retry idempotent reads once. Never auto-retry writes: that duplicates issues, posts and pages.
16. Don't rebuild a focused input or rich-text editor when state changes; patch it in place. Blur can fire before a toolbar click.
17. Every action shows a result: busy text, a success toast that says what changed, or an error that says what to do next.

**Security and generic design**
18. Keep secrets, tokens and customer names out of code, demo data and the README. Workers hold secrets (`wrangler secret put`).
19. The worker must check that the caller's IMS token can read `admin.da.live/source/{org}/{site}{path}.html` and that the org or site is allow-listed. CORS is not authorization.
20. Never put site, block or brand names in code. Built-in word lists are fallbacks that config overrides. With no config, every feature works or hides itself. Never rewrite existing content to migrate it.

## Reference map (read only what the task needs)

| Task | Read |
|---|---|
| SDK actions, capabilities, events, error codes, timing patterns | [references/sdk-and-events.md](references/sdk-and-events.md) |
| `library`, `prepare` and `apps` sheets, URLs, `ref=local`, reading site config | [references/surfaces-and-config.md](references/surfaces-and-config.md) |
| HTML that EW accepts, block tables, metadata, images, creating pages | [references/document-html.md](references/document-html.md) |
| Form-style live block editing (follow the cursor, replace, conflicts, undo) | [references/live-block-editing.md](references/live-block-editing.md) |
| admin.da.live, admin.hlx.page, api.aem.live and content.da.live endpoints | [references/da-aem-apis.md](references/da-aem-apis.md) |
| Cloudflare Worker proxy: auth, CORS, secrets, deploy, tests | [references/worker-proxy.md](references/worker-proxy.md) |
| Meta, IndexNow, Slack, LinkedIn, Jira, Airtable, Notion and Figma specifics | [references/third-party-recipes.md](references/third-party-recipes.md) |
| Making an extension work on any project, with optional config | [references/generic-design.md](references/generic-design.md) |
| Panel UI states, rendering, focus, CSS for narrow panels | [references/ui-patterns.md](references/ui-patterns.md) |
| Tests, local EW testing, browser checks, debugging | [references/testing-and-debugging.md](references/testing-and-debugging.md) |
| Symptom → cause → fix catalogue | [references/gotchas.md](references/gotchas.md) |
| What is and isn't possible | [references/capabilities.md](references/capabilities.md) |

## Scripts

- `scripts/new-extension.mjs --name {kebab} --title "{Title}" [--worker] [--root .]` creates:
  - `tools/{name}.html` and `tools/{name}/`: controller, panel, CSS, lib, demo fixture, tests, icon and README.
  - With `--worker`, also `tools/{name}/worker/`.
  - It adds `.hlxignore` entries and adds the test folder to `npm test` when that script runs `node --test`. It refuses to overwrite existing files.
- `scripts/check-extension.mjs --name {kebab} [--root .]` runs pre-ship checks and exits with code 1 if any fail:
  - static SDK import, timeout race and demo fallback;
  - `.hlxignore` entries; no secret-like strings;
  - README sections; icon; Marketplace image size (1200×896);
  - worker secrets not in `[vars]`.

Templates live in `assets/template/` (tokens `__NAME__`, `__TITLE__`, `__PREFIX__`). Scaffolded output passes the aem-boilerplate ESLint and Stylelint rules and its own tests.

## Repo conventions to respect

- `scripts/aem.js` is vendored: never edit it. There is no build step; use devDependencies only.
- Every committed file is served. Keep tests, workers, docs and demo scripts out with `.hlxignore`.
- To test locally, run `npx -y @adobe/aem-cli up` (port 3000) and open either:
  - `https://da.live/edit#/{org}/{site}/{path}?ref=local`, or
  - `https://da.live/app/{org}/{site}/tools/{name}?ref=local`.
- Disable Grammarly and header-modifying browser extensions while testing.
- Merging to `main` ships code; content publishes separately.
