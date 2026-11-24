# Capabilities: can and cannot

Verified while building six extensions. "Unverified" means don't promise it without a spike.

## Can

**Read**
- The page context (org, site, path, branch) and the author's IMS token.
- The live document HTML and the selected block index, live (`liveDocument`).
- The saved draft, the site config, the block library, folder lists and media through `admin.da.live`.
- Preview and live status, and published HTML and head metadata.

**Write**
- Insert HTML or text at the cursor (`sendHTML`, `sendText`).
- Replace the **selected** block, guarded by `expected` (`sendHTMLReplace`).
- Create pages, upload media and update config through the source API (with permission).
- Preview, publish and unpublish through admin.hlx.page (with permission).

**Host UI**
- Open the EW assistant with a prompt and auto-send it (`setPrompt`), and know when the turn completes.
- Open EW's compare-with-live view (`openComparison`), open host panels (`showPanel`), request a save, and set the title, href or hash.
- Start drag and drop into the canvas (`makeDraggable`, `dragDrop`). Needs UX testing.

**Elsewhere**
- Call any third party through a worker that holds the secrets and checks the author's access.
- Run fully in demo mode outside EW (a Marketplace "Try" link).
- Be shared across sites: any site can register the hosted URL.

## Cannot

- **Move the canvas cursor or select a block** from the panel. There is no API.
- **Replace a block other than the selected one**, or edit several blocks in one call.
- **Update an existing block with `sendHTML`.** Insert-only without replace.
- **Read the assistant's reply text.** `chatTurnCompleted` carries only a status. Reread the document instead.
- **Edit the document from a Prepare dialog**, or close the dialog from code.
- **Block or gate EW's native Publish button.** Use Preflight or permissions; your dialog can only gate itself.
- **Register custom checks in native Preflight** from an iframe (unverified; assume not).
- **Drive EW's built-in page-metadata panel.**
- **Keep arbitrary classes, styles or attributes** through EW normalization. EDS authors can't add classes to tags either; use block variants or section metadata.
- **Let external services see `content.da.live` images.** They're private; use published URLs.
- **Prevent two people's concurrent read-modify-write** on a DA source. You can reduce it (read just before writing, warn) but not lock it.
- **Assume any project has a given block, field name or config.** Detect, or hide.
- **Put secrets in the browser,** or call APIs that refuse browser CORS (Notion, Jira, Slack webhooks, Meta scrape) without a worker.

## Unverified (spike first)

- A Dynamic Media or AEM Assets picker inside a panel (no EW action found; Adobe Asset Selector needs an Assets environment).
- Per-block history and restore from the DA version list.
- Whether `<img>` can load private `content.da.live` images in every EW session.
- The full behaviour of `makeDraggable`, `saveDocument` and `daFetch` across EW versions.
- Whether search engines act on IndexNow pings for `*.aem.live` hosts.

## Feasible ideas, by effort

| Idea | How | Effort |
|---|---|---|
| Compare with live | `openComparison({candidate:'document', baseline:'live'})` | Low |
| Link picker for existing pages | `query-index.json` or the DA list API, then insert or replace a link | Medium |
| Snippets or presets | A library sheet, then `sendHTML` or `makeDraggable` | Medium |
| Brand, compliance and a11y checks | Rules sheet plus live HTML analysis in the panel | Medium |
| Overwrite protection | `expected` snapshots and a conflict UI (live), re-read before a source write | Medium |
| Block history | Version list plus block matching (unverified) | High |
