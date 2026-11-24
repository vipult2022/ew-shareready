---
name: shipping-ew-extensions
description: Ships an Adobe Experience Workspace (EW, da.live) extension so anyone can install it without help. Covers the extension README, the da.live Marketplace card (fields, 1200×896 image, logo, Try URL demo), the silent demo video (shot list, recording, compression, embedding), branch previews, pull requests with aem.page test links, merging and content publishing, the fresh-install test, and contest or nomination text. Use when the user mentions README, Marketplace, listing, demo video, screenshots, PR, release, submit, nomination, contest or "ready to publish" for an EW extension, plugin or app.
license: Apache-2.0
metadata:
  version: "1.0"
  pairs-with: building-ew-extensions
---

# Shipping Experience Workspace extensions

An extension is "done" when a stranger can **understand it in 10 seconds, try it in 1 minute with no account, and install it in about 10 minutes** from the README alone. Build it first with the `building-ew-extensions` skill. This skill covers everything after the code works.

## Ship checklist

Copy this checklist and track it:

```
Ship progress for {name}:
- [ ] 1. Pre-ship check is green: node .github/skills/building-ew-extensions/scripts/check-extension.mjs --name {name} [--deny "customer,words"]
- [ ] 2. npm run lint and npm test pass. Demo works at /tools/{name}.html?demo=1 with no console errors.
- [ ] 3. README complete (references/readme.md): hook, video, screenshots, Try it, Install, Config, Security, Limits, Troubleshooting, Development, Marketplace listing.
- [ ] 4. Screenshots in tools/{name}/docs/ (panel at about 340 px wide, 2× scale), with real alt text.
- [ ] 5. Marketplace image: tools/{name}/docs/marketplace.html → tools/{name}/marketplace.png (1200×896) with scripts/render-image.mjs.
- [ ] 6. Branch preview works: https://{branch}--{site}--{owner}.aem.page/tools/{name}.html?demo=1, then inside EW with ?ref={branch}.
- [ ] 7. PR with the template filled in and an aem.page test link (references/release.md). Merge = code is live.
- [ ] 8. Content the README links to is previewed or published (code and content publish separately).
- [ ] 9. Fresh-install test on a second site or org, following only the README.
- [ ] 10. Demo video recorded from the shot list, compressed with scripts/compress-video.sh, embedded under the README title.
- [ ] 11. Marketplace card and nomination text filled in from assets/ templates. Links point at main, not a branch.
```

## Rules that matter most

1. **The Try URL needs no account.** `?demo=1` must work on `aem.page` outside EW, with sample data from a fictional brand. Show a "Sample data" badge, and make actions that would write politely explain they work inside EW.
2. **Lead with the author's problem, not the tech.** The first README sentence and the card description say what the author gets. "Cloudflare Worker" and "SDK" come later.
3. **Problem → clicks → result** structures the README intro, the Try it table, the video and the nomination text.
4. **Every link points at `main`** (`tree/main/tools/{name}#readme`, `main--{site}--{owner}.aem.page`) before you submit. Branch links break after merge and delete.
5. **No secrets, customer names or real people** in screenshots, video, demo data or text. Blur tokens and emails. Re-run the checker with `--deny`.
6. **Secrets go in the worker**, and the README says exactly what the worker checks (IMS token can read the page, org allow-list) and what data leaves the browser.
7. **Say what it can't do.** A Limits section builds trust and saves support questions. Examples: no cursor control, Prepare dialogs can't edit the page, a free tier's rate limit.
8. **Docs, tests, workers and image sources are not served.** Keep them in `docs/`, `test/` and `worker/`, which are listed in `.hlxignore`. `marketplace.png` and `icon.svg` **are** served, because the card links to them.

## Reference map

| Task | Read |
|---|---|
| README structure, wording, screenshots, alt text, video embed | [references/readme.md](references/readme.md) |
| Marketplace card fields, image style, logo, Try URL, how listings appear | [references/marketplace.md](references/marketplace.md) |
| Shot list, recording, compression, embedding the video | [references/demo-video.md](references/demo-video.md) |
| Branch previews, PRs, merging, content publish, fresh-install test, nomination, after launch | [references/release.md](references/release.md) |

## Assets and scripts

- `assets/marketplace.html` is a 1200×896 image template with placeholders. Copy it to `tools/{name}/docs/marketplace.html` and draw the extension's UI in HTML and CSS.
- `assets/video-shots.md` is a shot-list template: timings, a "before you record" reset, captions and recovery tips.
- `assets/nomination.md` is a template for contest or nomination text: a one-line idea, a longer description, the third party and links.
- `scripts/render-image.mjs --html {file} --out {png} [--width 1200 --height 896 --scale 1]` renders HTML to PNG with Playwright or Puppeteer and installed Chrome. Use `--scale 2` with `--width 340` for panel screenshots of demo pages (`--url` instead of `--html`).
- `scripts/compress-video.sh {in} {out} [width] [fps]` runs ffmpeg with H.264, CRF 23, no audio and faststart. A 2-minute screen recording comes out under 10 MB for a GitHub upload.
