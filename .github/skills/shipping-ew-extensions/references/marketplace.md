# The da.live Marketplace listing

The EW Marketplace is at https://da.live/marketplace. It lists extensions from a sheet, which can be read as `https://da.live/marketplace.json`. The Marketplace owners add or approve the rows, so you can't publish a listing yourself. You provide the field values, the image and a README that works as the documentation.

Put the same values in a `## Marketplace listing` table at the end of the README, so reviewers can copy them.

## Card fields

| Field | What to put | Example |
|---|---|---|
| Title | The product or third-party name, 1 to 3 words | `Notion` |
| Description | 1 or 2 sentences, about 200 to 300 characters: author outcome first, then how | "Turn Notion briefs into pages. Browse your team's Notion databases next to the page, then insert at the cursor or create a page, with headings, tables, images and metadata kept." |
| Type | `Plugin` (library panel or Prepare), `App` (fullscreen) | `Plugin` |
| Category | The Marketplace category; current listings use `Extension` | `Extension` |
| Status | `Early Access` until it has real users; then `Available` | `Early Access` |
| Owner | GitHub user or team | `{owner}` |
| Doc Url | The README on `main` | `https://github.com/{owner}/{repo}/tree/main/tools/{name}#readme` |
| Try Url | The demo with no account | `https://main--{site}--{owner}.aem.page/tools/{name}.html?demo=1` |
| Image | A 1200×896 PNG served by the site | `https://main--{site}--{owner}.aem.page/tools/{name}/marketplace.png` |
| Logo | A square SVG, the same as the config `icon` | `https://main--{site}--{owner}.aem.page/tools/{name}/icon.svg` |
| Date | The listing date, which the owners set | |

Before you hand these over, check them:

- `curl -sI {Image}` and `curl -sI {Logo}` both return 200, and both URLs are on `main`. The image is not in `docs/`, because `docs/` is not served.
- The Try URL opens in a private window with no login and shows the "Sample data" badge.
- The Doc Url opens the README on `main`, not a branch.

## The Marketplace image (1200×896)

The existing cards use **soft pastel gradient backgrounds with simple, stylised UI illustrations**: rounded "windows", grey bars for text, one accent colour, and **no headline text**. Make yours match, so it doesn't look like a screenshot pasted in.

Draw it in HTML and CSS. The advantage is that it can be edited, versioned and re-rendered at the exact size.

1. Copy `assets/marketplace.html` to `tools/{name}/docs/marketplace.html`.
2. Tell the story in one picture: **the third party on the left → an arrow → the EW panel or page on the right**. Use the third party's real colours, such as Notion beige, Slack aubergine, Jira blue or Figma's dark canvas, but **not its logo**, unless its brand rules allow that.
3. Keep only 3 to 6 real words, such as a status pill, a button label or a block name. Everything else is grey lines.
4. Render it:
   ```sh
   node <skills>/shipping-ew-extensions/scripts/render-image.mjs \
     --html tools/{name}/docs/marketplace.html --out tools/{name}/marketplace.png
   ```
5. Look at it at 300 px wide, because that is roughly the card size. If you can't tell what it does, simplify it.
6. `check-extension.mjs` checks that the PNG is 1200×896.

Show it in the README with `<img src="marketplace.png" width="600" alt="…">`, and link its source.

## The icon

- Use a 24×24 `viewBox`, a single colour (`currentColor` or one hex) and simple strokes.
- The same file serves as the `library` / `prepare` sheet `icon` and the Marketplace Logo.
- It must be served (`tools/{name}/icon.svg`), not in `docs/`.

## Try URL rules

- Works outside EW. The SDK race falls back to demo mode, and `?demo=1` skips the SDK.
- Uses fictional brand data shaped exactly like the real response.
- Every button does something:
  - Copy works.
  - Insert, Publish and Post explain "works inside EW" or show a **"Demo: nothing is published or posted"** banner, and show a simulated result.
- Loads fast with no external calls, except fonts that are already on the site.

## After listing

- Check `https://da.live/marketplace.json` for your row. Report wrong fields to the Marketplace owners.
- Keep the Doc Url, Try Url and Image URLs stable. Renaming `tools/{name}` breaks the card.
