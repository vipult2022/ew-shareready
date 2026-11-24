# Writing the extension README

The README is the Marketplace **Doc Url**, so it is the install guide, the sales pitch and the support page in one. It lives at `tools/{name}/README.md`. Link to it as `https://github.com/{owner}/{repo}/tree/main/tools/{name}#readme`, which renders the README under the file list. `*.md` is in `.hlxignore`, so it is not served on the site.

The scaffolded README (`building-ew-extensions/assets/template/tools/__NAME__/README.md`) already has these sections. Fill in each `{placeholder}`; `check-extension.mjs` warns about any that are left.

## Contents

- [Order of sections](#order-of-sections)
- [The top of the README](#the-top-of-the-readme)
- [Try it](#try-it)
- [Install](#install)
- [Configuration](#configuration)
- [Security and privacy](#security-and-privacy)
- [Limits and Troubleshooting](#limits-and-troubleshooting)
- [Screenshots](#screenshots)
- [Style](#style)

## Order of sections

| # | Section | Purpose |
|---|---|---|
| 1 | `# {Title} for Experience Workspace` and a **bold one-sentence promise** | What the author gets, in under 25 words |
| 2 | One paragraph: the problem today, then what the extension does (clicks → result) | Author value |
| 3 | Video (a bare user-attachments URL on its own line) | Demonstrability |
| 4 | Screenshot table (3 panels with captions), then one page or result image | The result |
| 5 | Bullets: **Try it now, no setup** (Try URL), **Third party**, **Cost** | The scan line |
| 6 | `## Contents` | GitHub also builds an outline, but readers expect one |
| 7 | `## What it does` | Features as bold lead-ins, one per bullet |
| 8 | `## Try it` | Demo steps table |
| 9 | `## Install` | Numbered steps, about 10 minutes |
| 10 | `## Connect {service}` (if needed) | Third-party setup: app, token, scopes, worker deploy |
| 11 | `## Configuration` | Every sheet key with its default |
| 12 | `## Security` / `## Privacy and security` | What the worker checks; what data goes where |
| 13 | `## How it works` | Architecture in 5 to 10 bullets or a diagram, for developers |
| 14 | `## Limits` | What it can't do and why |
| 15 | `## Troubleshooting` | Symptom → fix table |
| 16 | `## Development` | Test, lint, local run, worker dev |
| 17 | `## Marketplace listing` | The card fields table and the image (see marketplace.md) |
| 18 | `## License` | License, trademark note, "{Brand} is a fictional brand" |

## The top of the README

```markdown
# Notion for Experience Workspace

**Turn a Notion brief into a page: browse your team's Notion pages next to the page you're editing, then insert one at the cursor or create a new page from it in one click.**

Many teams write briefs in Notion, then rebuild them by hand in the CMS: … This EW extension for AEM Edge Delivery Services does that in a few clicks. An author opens **Extensions › Notion**, picks a brief, checks the preview, then presses **Insert** …

https://github.com/user-attachments/assets/{video-id}

<table>
  <tr>
    <td width="33%"><img src="docs/panel-list.png" alt="…"></td>
    …
  </tr>
  <tr><td align="center"><b>Browse</b>: briefs and their status</td> …</tr>
</table>

- **Try it now, no setup:** [panel demo with sample data](https://main--{site}--{owner}.aem.page/tools/{name}.html?demo=1)
- **Third party:** {Service} ({which API}, through a small worker; read only / one write: …)
- **Cost:** free. {Service plan} works. The worker fits the Cloudflare Workers free tier.
```

- Put the UI path in bold with `›`, for example **Extensions › Notion** or **⋯ › Publish & Share**, so authors can find it.
- Name the third party and the free tier on the first screen. Judges and admins look for them.

## Try it

A table that walks through the demo. Each row is one action and what to notice. End with the steps that only work inside EW.

```markdown
| Step | What to do |
| --- | --- |
| 1 | The **{list}** shows {n} sample items. Search for `home`. |
| 2 | Open **{item}**: {what you see}. |
| 3 | **Copy**, then paste into any editor. **Insert** works inside EW. |
```

Add a line on the real demo site, for example "Edit a page (needs access to the `{org}` org): https://da.live/canvas#/{org}/{site}/index, then **Extensions › {Title}**".

## Install

Write numbered steps that a site admin who has never seen the repo can follow:

1. **Copy the code.** Copy `tools/{name}.html` and `tools/{name}/` into the site repo (without `test/`, `worker/`, `docs/`). Add the `.hlxignore` lines. Commit and wait for Code Sync.
   - Or **use it from this repo**: point the config row at `https://main--{site}--{owner}.aem.page/tools/{name}.html`. No code copy is needed, but you depend on this repo.
2. **Add the config row** at `https://da.live/config#/{org}/{site}/`:
   - `library` sheet: `title | path | icon | experience`, with the values as a code block.
   - `prepare` sheet: `title | path | icon | ref | experience=fullsize-dialog`.
   - `apps` sheet.
3. **(If needed) Deploy the worker:** `cd tools/{name}/worker && npx wrangler deploy`, then `npx wrangler secret put {SECRET}`. Set `ALLOWED_ORGS`.
4. **Add the `{name}` sheet** with `worker-url` and any options.
5. **Open a page** in EW and choose **Extensions › {Title}**. Say what success looks like.

Give exact values in code blocks. Say where each value comes from, for example "the token starts with `ntn_`; find it under Settings › Integrations".

## Configuration

One table for each sheet. Columns: **Key | Default | What it does**. Every key must have a default, or "(off)" when the feature hides itself. Mention URL overrides (`?worker-url=…`) for testing.

## Security and privacy

Answer these four questions explicitly:

1. **Where does the secret live?** In the worker, set with `wrangler secret put` and never in the browser or repo.
2. **Who can call the worker?** Only callers whose IMS token can read `admin.da.live/source/{org}/{site}{path}.html`, from allow-listed orgs. CORS alone is not authorization.
3. **What leaves the browser, and where does it go?** For example: "the page URL and title go to Slack; nothing else".
4. **What does it write?** For example: "Only the new page link, in one property, and it can be switched off."

## Limits and Troubleshooting

- **Limits**: platform limits (cursor position unknown, Prepare dialogs can't edit, `sendHTML` inserts only), third-party limits (rate limits, expiring file URLs, search engines ignoring `*.aem.live`) and scope limits (what it doesn't convert).
- **Troubleshooting**: use the exact text the panel shows as the symptom, so a search finds it.

```markdown
| You see | Do this |
| --- | --- |
| *Your cursor is inside a block* | Click an empty line outside the block, then **Insert** again. |
| *Can't reach the worker* | Check `worker-url` in the `{name}` sheet and that the worker is deployed (`/status` returns ok). |
| Nothing in Extensions | Reload EW: the config is cached. Check the `library` row's path opens on its own. |
```

## Screenshots

- Keep them in `tools/{name}/docs/` (ignored by `.hlxignore`, but GitHub renders them).
- **Panel shots:** capture the demo at 340 px wide (the EW panel width) and 2× scale for sharpness. Crop to the panel. Use `scripts/render-image.mjs --url "http://localhost:3000/tools/{name}.html?demo=1" --width 340 --height 640 --scale 2 --out tools/{name}/docs/panel-list.png`.
- **Result shots:** the published page or the third-party result, such as the Slack card, the Jira issue or the Notion property. Show proof that it happened.
- **Alt text** describes what the image shows ("Notion panel: the Content briefs database with three briefs, each with a status pill"), not "screenshot".
- Use only demo-brand data. Blur emails, avatars and tokens. Check the browser chrome, tabs and bookmarks bar too.
- Keep PNGs under about 300 KB. Use JPEG (quality about 85) for photographic page shots.

## Style

- Write for authors first and admins second; developers come last.
- Use short sentences and active voice. Address the reader as "you". Bold the UI labels.
- Name things exactly as the UI does.
- Write numbers and paths in code font. Give every external service a link the first time it appears.
- Don't use marketing words like "seamless", "powerful" or "revolutionary". Show the result instead.
