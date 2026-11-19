# Experience Workspace extensions

Two extensions for [Experience Workspace](https://www.aem.live/docs/ew/) (EW) on AEM Edge Delivery Services, with Document Authoring (da.live). Each one has its own README with a demo, install steps, worker setup, security notes and troubleshooting.

| Extension | What it does | Third party | Docs | Try it |
| --- | --- | --- | --- | --- |
| **ShareReady** | See how a page will look when it's shared on Google, LinkedIn, Facebook, X, WhatsApp, Slack and Teams, fix it in one click, then publish, refresh Facebook's cache, ping IndexNow and post to Slack in one step. | Meta Graph API, IndexNow, Slack | [tools/shareready](tools/shareready#readme) | [Panel demo](https://main--ew-shareready--vipult2022.aem.live/tools/shareready.html?demo) |
| **ReviewLoop for Jira and Airtable** | Send only what changed on a page to Jira or Airtable for legal, brand or copy review, see the reviewer's status and comments next to the page, resubmit only the delta, and publish once it's approved. | Jira Cloud | [tools/reviewloop](tools/reviewloop#readme) | [Panel demo](https://main--ew-shareready--vipult2022.aem.page/tools/reviewloop/panel.html?demo=1) |

Both are plain JavaScript, HTML and CSS with no build step. Each has an optional or required Cloudflare Worker that keeps third-party secrets out of the browser and checks the author's Adobe sign-in.

## Repository layout

| Path | What it is |
| --- | --- |
| `tools/shareready.html`, `tools/shareready/` | ShareReady panel, Publish & Share dialog, library, demo and docs |
| `worker/`, `test/` | ShareReady worker and tests |
| `tools/reviewloop/` | ReviewLoop panel, dialogs, library, demo, worker (`worker/`) and tests (`test/`) |
| `9ff637071dbd6a45cea0841507f0d2db.txt` | IndexNow key for the demo site |
| everything else | The demo site, based on the [AEM boilerplate](https://github.com/adobe/aem-boilerplate) |

## Development

```sh
npm install
npm test                  # both extensions' unit tests
npm run lint              # ESLint (airbnb) + Stylelint
npx -y @adobe/aem-cli up  # local code with previewed content on localhost:3000
```

Add `?ref=local` to the EW URL to load the extensions from `localhost:3000`. The demo site's content comes from `https://content.da.live/vipult2022/ew-shareready/`. Files in `.hlxignore` (workers, tests, docs and Markdown) aren't served.

## License

[Apache License 2.0](LICENSE). Northwind Bank is a fictional brand used for the demo content.
