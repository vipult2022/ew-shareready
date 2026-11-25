# Third-party recipes

Each recipe covers: the auth model, the calls, the free-tier notes and the traps found in practice.

## Contents
- [Meta (Facebook) link preview re-scrape](#meta-facebook-link-preview-re-scrape)
- [IndexNow](#indexnow)
- [Slack incoming webhook](#slack-incoming-webhook)
- [LinkedIn](#linkedin)
- [Jira Cloud](#jira-cloud)
- [Airtable](#airtable)
- [Notion](#notion)
- [Figma](#figma)
- [Adding a new service](#adding-a-new-service)

## Meta (Facebook) link preview re-scrape

- Worker only: `POST https://graph.facebook.com/{version?}` with a form-encoded body `id={url}&scrape=true&access_token={APP_ID}|{APP_SECRET}`.
- A free Meta developer app is enough. The secrets are `META_APP_ID` and `META_APP_SECRET`; `META_GRAPH_VERSION` is optional.
- On error, return the Sharing Debugger link (`https://developers.facebook.com/tools/debug/?q={url}`) so the author can retry by hand.
- If the secrets are missing, return `{skipped: true, message}` instead of an error. The other steps still run.
- The response is the scraped OG object. Show the title and image the scraper saw.
- Only the published (`aem.live` or production) URL makes sense. Publish first, then scrape.

## IndexNow

- `POST` JSON `{host, key, keyLocation, urlList}`. The key goes in `INDEXNOW_KEY`; `INDEXNOW_ENDPOINT` optionally pins one engine.
- The key file `/{key}.txt` must be served at the host root. Commit it at the repo root.
- Try the endpoints in turn: `api.indexnow.org` → `www.bing.com/indexnow` → `yandex.com/indexnow`. Cloudflare's shared egress often gets 429.
- 200 or 202 means accepted. Engines may ignore `*.aem.live` hosts: say in the README that the real value comes on a production domain.

## Slack incoming webhook

- The secret is `SLACK_WEBHOOK_URL`, from a free workspace → app → Incoming Webhooks. The channel is fixed by the webhook; show its label from `SLACK_CHANNEL`.
- Send a Block Kit card: title, description, image, the UTM-tagged live URL and an "Edit in EW" link (`https://da.live/canvas#/{org}/{site}{path}`).
- **Trap:** `invalid_blocks` when the image URL is private (`content.da.live`) or unreachable. Retry without the image block, using the published `aem.live` image URL when available.
- Webhooks answer `text/plain` "ok", not JSON.

## LinkedIn

- No free API for re-scraping. Give the author a Post Inspector deep link: `https://www.linkedin.com/post-inspector/inspect/{encodeURIComponent(url)}`.
- Share intent: `https://www.linkedin.com/sharing/share-offsite/?url=…`. X, Facebook, WhatsApp and Teams have similar share-intent URLs and need no worker.

## Jira Cloud

- The worker uses Basic auth: `base64(JIRA_EMAIL:JIRA_API_TOKEN)` against `https://{site}.atlassian.net/rest/api/3/…`. The browser cannot call Jira (CORS).
- Store extension state in **issue properties** (`/issue/{key}/properties/{name}`), not in description text, so authors can't break it by editing.
- Rich text is ADF. Convert ADF to plain text or HTML for display, and write comments as minimal ADF.
- Status mapping goes in worker vars (`JIRA_DONE_STATUSES`, …). A reviewer may close the issue to approve, so treat closed-without-published as approved.
- Poll at about 15 s while visible. There are no webhooks in this design.

## Airtable

- The secret is a PAT (`AIRTABLE_TOKEN`) scoped to the needed bases, read and/or write. Base and table IDs go in config or vars.
- Field types drive formatting: rich text (Markdown), attachments (copy to DA media, because the URLs expire), linked records and multi-select.
- The free plan has a small monthly API budget. Cache in the worker for about 60 s and poll slowly (60 s).
- Map records to blocks such as `Table`, `Cards` or `Accordion`, or to plain headings and paragraphs. Let the author pick.

## Notion

- The secret is an internal integration token (`NOTION_TOKEN`, `ntn_…`). Authors must **share pages with the integration** (••• → Connections). Explain this on the setup screen, because "no pages found" is usually a sharing problem.
- The API rejects browser calls, so everything goes through the worker.
- Database query returns at most 100 per page. Cap the total (for example 200) and offer search or status filters.
- Block mapping:
  - toggles → Accordion; tables → Table; column lists → Columns;
  - dividers → `<hr>` (section break); callouts and quotes → blockquote.
  - Child pages and child databases are skipped and **reported**.
- File URLs expire after about 1 hour, so copy them right away.
- Write-back (for example an "EW page" URL property) goes behind `ALLOW_WRITE`.

## Figma

- **Plugin route (recommended):**
  - A Figma plugin reads the selection, exports images and POSTs a handoff to the worker with a team key.
  - The worker stores it in KV, with a TTL of about 30 days.
  - The EW panel lists handoffs, using the IMS check.
  - This avoids Figma REST rate limits and needs no Figma token per author.
  - The plugin UI's origin is `null`: use wildcard CORS on plugin routes only.
- **Link route (optional):**
  - The author pastes a frame link and the worker calls Figma REST with `FIGMA_TOKEN`.
  - Plans and seats have tight limits (429). Explain them and point to the plugin.
- Convert frames to sections and blocks. Buttons become standalone links (strong = primary, em = secondary). Text order follows layout order.
- `setPrompt` can ask the EW assistant to lay out the content with the site's blocks. Don't rely on the assistant inserting images from URLs; keep a direct Insert as the fallback.

## Adding a new service

1. Can the browser call it without a secret and with CORS? Then call it from `lib/` with no worker.
2. If not, add a worker route.
   - Keep the secret in a Wrangler secret.
   - Define a minimal response shape and mirror it exactly in `demo/*.json`.
3. Write a `connection.js` with `workerConnection()` and `demoConnection()` that return the same methods. The panel shouldn't know which one it has.
4. List the free-tier limits and the scopes needed in the README.
