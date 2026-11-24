# __TITLE__

<!-- One sentence: what the author can do, and with which third party. -->
__TITLE__ lets Experience Workspace authors {do something} with {service}, without leaving the page they are editing.

![__TITLE__ in Experience Workspace](./marketplace.png)

## What it does

<!-- The author story: problem → clicks → result. Keep it to what an author sees. -->
**The problem:** {what authors do today, and what goes wrong}.

**With __TITLE__:**
1. Open the page in Experience Workspace and choose **__TITLE__** from the extensions menu.
2. Pick an item. The panel shows a preview.
3. Press **Insert**. The content is added at the cursor as normal page content (or as a block, if the site sets one).

## Try it

- **Sample data, no setup:** `https://main--{site}--{org}.aem.page/tools/__NAME__.html?demo=1`
- **Video:** {link to a 2–3 minute demo}

## Install

You need edit access to the site's config at `https://da.live/config#/{org}/{site}`.

**Option A: use the hosted copy.** Add a row to the `library` sheet:

| title | path | icon | experience |
|---|---|---|---|
| __TITLE__ | `https://main--{site}--{org}.aem.page/tools/__NAME__.html` | `https://main--{site}--{org}.aem.page/tools/__NAME__/icon.svg` | inline |

**Option B: your own copy.** Copy `tools/__NAME__.html` and `tools/__NAME__/` (without `test/` and `worker/`) into your site's code repo, then use your site's URLs in the row above.

Reload Experience Workspace after changing the config. EW reads it only on load.

## Configuration

All settings are optional except `worker-url`. Add a sheet named `__NAME__` to the site config with `key` and `value` columns:

| key | value | default |
|---|---|---|
| `worker-url` | URL of your worker, e.g. `https://__NAME__.{account}.workers.dev` | none: the panel shows a setup screen and offers sample data |
| `block` | Block name to wrap inserted content in, e.g. `Cards` | none: plain heading, text and link, which work on any site |
| `heading-level` | 2–6 | 3 |
| `link-text` | Text of the inserted link | Read more |

You can also pass any setting in the panel URL, e.g. `__NAME__.html?block=Cards`. That's handy for testing.

## Worker

{service} needs a secret, and its API doesn't accept browser calls, so a small Cloudflare Worker (free plan) sits in between. It checks that the author's Adobe sign-in can read the page in Document Authoring before calling {service}.

```bash
cd tools/__NAME__/worker
npx wrangler login
npx wrangler secret put SERVICE_TOKEN     # paste the {service} API token
# edit wrangler.toml: ALLOWED_ORGS = "{org}" and SERVICE_URL
npx wrangler deploy
curl https://__NAME__.{account}.workers.dev/status    # "configured": true
```

| Variable | Required | Meaning |
|---|---|---|
| `SERVICE_TOKEN` (secret) | Yes | {service} API token |
| `ALLOWED_ORGS` | Yes | Orgs (`my-org`) or sites (`my-org/my-site`) the worker serves. Empty means it serves nobody |
| `SERVICE_URL` | Yes | {service} API base URL |
| `ITEMS_PATH` | No | Path that lists items (default `/items`) |
| `ALLOWED_ORIGINS` | No | Extra browser origins (default: da.live and aem.page/aem.live sites) |

## Troubleshooting

| You see | Do this |
|---|---|
| "Almost ready" setup screen | Add `worker-url` to the `__NAME__` sheet and reload EW |
| "Your cursor is inside a block" | Click an empty line outside any block, then Insert |
| "This worker does not serve …" | Add your org or site to `ALLOWED_ORGS` and redeploy |
| "Your session expired" | Reload Experience Workspace |
| "Could not reach the worker" | Check `worker-url`, then open `{worker-url}/status` |
| The panel never loads in EW | Turn off Grammarly and header-changing browser extensions |

## Privacy and security

- The {service} secret lives only in the worker. The browser never sees it.
- The worker accepts a request only when the author's Adobe IMS token can read the page in Document Authoring, and only for the orgs in `ALLOWED_ORGS`.
- Nothing is stored. Responses are cached in memory for one minute.

## Limits

- {Known limits, e.g. "lists the first 100 items".}
- Insert adds content at the cursor; it can't change content that's already on the page.

## Development

```bash
npx -y @adobe/aem-cli up                       # http://localhost:3000/tools/__NAME__.html?demo=1
npm run lint && npm test
```

In EW, add `?ref=local` to the editor URL to load your local code.
