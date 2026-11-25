# Document HTML: what to send EW

## Contents
- [Block tables](#block-tables)
- [Sections, metadata and buttons](#sections-metadata-and-buttons)
- [Inserting safely](#inserting-safely)
- [Images](#images)
- [Creating a new page](#creating-a-new-page)
- [Metadata Fix pattern](#metadata-fix-pattern)
- [Sanitizing](#sanitizing)

## Block tables

DA and EW store blocks as tables. The first row is the block name, with variants in parentheses. Each further row is a block row.

```html
<table><tbody>
  <tr><td colspan="2"><p>Cards (horizontal)</p></td></tr>
  <tr><td><picture><img src="https://content.da.live/org/site/media/a.jpg" alt="Alt"></picture></td>
      <td><h3>Title</h3><p>Body</p></td></tr>
</tbody></table>
```

- Use `colspan` on the name row to match the widest row.
- Put text in cells as `<p>`, headings and lists, not bare text.
- Use `<hr>` between sections. DA turns it into a section break.
- Never send EDS-decorated `div` markup (`<div class="cards">`). Send authoring tables.
- EW may normalize anything it doesn't model (classes, styles, unknown tags). Assume only semantic HTML survives: headings, p, strong, em, u, s, code, sup, sub, a, ul, ol, li, blockquote, table, picture, img and hr. **Always re-read the result.**

Helper:

```js
export function blockTable(name, rows) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const head = `<tr><td colspan="${width}"><p>${escapeHtml(name)}</p></td></tr>`;
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><tbody>${head}${body}</tbody></table>`;
}
```

## Sections, metadata and buttons

- **Section metadata:** a `Section Metadata` table at the end of a section, with `key | value` rows such as `style | dark`.
- **Page metadata:** a `Metadata` table, normally at the end of the page, with `key | value` rows: `title`, `description`, `image`, `og:title`, `keywords`, …
- **Buttons:** a link alone in its paragraph. `<p><strong><a>` makes a primary button and `<p><em><a>` a secondary one. Mark-only edits to buttons can show raw links in EW's layout view until the page is decorated again. The fix is site-side (quick-edit partial reload), not in your extension.

## Inserting safely

Before `sendHTML(html)`:
1. `state.mode === 'demo'`: show "Open in EW to insert", and offer Copy instead.
2. `editable === false`: say "You can't edit this page" and stop.
3. `blockIndex !== null`: say "Your cursor is inside a block. Click an empty line outside it, then try again." and stop. Inserting a table inside a table cell breaks the page.
4. After sending, show a toast that says what was inserted. `sendHTML` gives no confirmation, so the live-document stream is your proof.

Offer **Copy** as well (a `ClipboardItem` with `text/html` and `text/plain`). It works everywhere, including the classic DA editor and demo mode.

## Images

Third-party image URLs expire: Notion files after about 1 hour, Airtable attachments after hours, Figma exports and handoffs after days. `content.da.live` URLs in a draft are private, so external services (Slack, Meta) can't fetch them.

Copy each image into DA media before inserting:

```js
const form = new FormData();
form.append('data', blob, fileName);
await fetch(`https://admin.da.live/source/${org}/${site}/media/${folder}/${fileName}`, {
  method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: form,
});
// then reference https://content.da.live/{org}/{site}/media/{folder}/{fileName}
```

- Name files by content hash plus slug, so a repeat import reuses the file instead of duplicating it.
- If the browser can't download the source because of CORS, fetch the bytes through your worker. Allow only https URLs and `image/*` types, never `image/svg+xml`, and cap the size (for example 20 MB).
- If any image fails, stop and change nothing. Say how many failed and offer to try again.

## Creating a new page

```js
const exists = (await fetch(src, { method: 'HEAD', headers: auth() })).status !== 404;
if (exists) throw new Error(`There is already a page at ${path}. Choose another path.`);
const form = new FormData();
form.append('data', new Blob([documentHtml(sections)], { type: 'text/html' }));
await fetch(src, { method: 'PUT', headers: auth(), body: form });
// open: https://da.live/canvas#/{org}/{site}{path}  (or /edit#/ for classic DA)
```

`documentHtml` = `<body><header></header><main><div>…section…</div><div>…</div></main><footer></footer></body>`.

Path rules: lowercase, `[a-z0-9-/]`, no `.html`, no `..`, and no double slashes. Suggest `{configured folder}/{slug of title}`. **Never overwrite** an existing page.

## Metadata Fix pattern

`sendHTML` cannot update an existing Metadata block. Instead:
- If there is no Metadata block, insert a complete one at the cursor (cursor outside blocks).
- If one exists, offer per-field values with Copy buttons and tell the author which row to edit. Or, if the user agrees and it is tested, rewrite the draft through the source API while the doc is **not** open elsewhere.
- Writing through the source API while EW has the doc open may conflict with collaborative editing. Prefer `sendHTML` and `replace` in panels.

## Sanitizing

- Escape every text value (`&`, `<`, `>`, `"` and `'`).
- Links: allow only `https:`, `http:`, `mailto:`, `tel:` and relative paths. Reject `javascript:` and protocol-relative `//host` links.
- From paste or rich text: map `<b>` to `<strong>`, `<i>` to `<em>` and `<strike>` to `<s>`. Drop `style`, `class`, `on*`, `script`, `iframe` and unknown tags, but keep their text.
- Report what was skipped (for example "child databases are not imported") rather than dropping it silently.
