# Panel UI patterns

## Contents
- [Structure](#structure)
- [States every panel needs](#states-every-panel-needs)
- [Rendering](#rendering)
- [CSS for a narrow iframe](#css-for-a-narrow-iframe)
- [Copy and messages](#copy-and-messages)
- [Accessibility](#accessibility)

## Structure

- `{name}.js` is the **controller**: the SDK, the `state` object and actions (`async` functions that update state and call `panel.render()`).
- `panel.js` is the **view**. `createPanel(root, state, actions)` returns `{ render, toast, setBusy, ... }`. It reads `state` and never fetches.
- `lib/` holds pure functions: parsing, converting, validation and config. It is fully unit tested.
- `lib/dom.js` provides `h(tag, attrs, ...children)`, `fill` and `escapeHtml`. Children become **text nodes**, and `null`, `undefined` and `false` are skipped. `append(null)` would otherwise render the word "null".

## States every panel needs

| State | Show |
|---|---|
| loading | A skeleton or "Loading…" (the SDK wait is up to 4 s) |
| setup needed | What the feature does, 2–3 setup steps, a docs link and **Try with sample data** |
| demo | A chip reading "Sample data", and the real flows on fixtures. Write actions explain that they need EW |
| empty | Why it's empty and how to fix it ("Share pages with the integration") |
| busy | An inline status line with progress ("Copying images… 2 of 5") and disabled actions |
| error | A red box with the message and the HTTP status, plus Retry where it's safe |
| success | A toast that says what changed, plus links (open the page, view the issue) |
| read-only | `editable === false` or no write permission: hide the write buttons and say why once |

## Rendering

- Full `render()` on view changes. Partial renders (`renderFooter`, `renderList`) for frequent updates such as live selection.
- Don't recreate the focused element. Compare a "shape" key before a full render.
- Keep scroll position across renders of the same view. Scroll to the top on navigation.
- Debounce search input (about 350 ms) and use a sequence guard on its fetch.
- Remember the last choice per site in `localStorage` (`ew-{name}:{key}:{org}/{site}`), wrapped in `try`.

## CSS for a narrow iframe

- Prefix every class (`.nt-`, `.sr-`) and keep styles in `tools/{name}/{name}.css`. Panel pages don't load the site's styles.
- The panel is about 320–420 px wide and the user can resize it. Design for 320 px first.
- Use `grid-template-columns: minmax(0, 1fr)` so long URLs don't overflow, `overflow-wrap: anywhere` for URLs, and `flex: none` for previews that must not collapse.
- Use Adobe Clean with system fallbacks. Look like Spectrum: 4 px radius, `#3b63fb` accent, 14 px base font, 12 px muted.
- A sticky footer holds the primary actions (Insert, Create page).
- Respect `prefers-reduced-motion`. Use no external fonts or CDNs.
- Stylelint (`tools/**/*.css`) follows `stylelint-config-standard`: kebab-case classes, no duplicate selectors and lowercase keywords (`blinkmacsystemfont`).

## Copy and messages

- Write messages from the author's side: what happened, then what to do. For example: "Your cursor is inside a block. Click an empty line outside it, then press Insert again."
- Name the third party and the setting: "Could not reach the Notion worker. Check the worker-url setting."
- Don't use jargon such as "IMS", "CORS" or "sendHTML" in author-facing text. Save it for the README troubleshooting section.

## Accessibility

- Use real `<button type="button">`, `<label for>` and `aria-label` on icon buttons, and `role="status"` / `aria-live="polite"` for busy text and toasts.
- Keep focus visible. Don't trap focus. Make sure every action works from the keyboard.
- Images in previews get an `alt`. Decorative icons get `aria-hidden="true"`.
