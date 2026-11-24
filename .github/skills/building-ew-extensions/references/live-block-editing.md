# Live block editing (form editors beside the canvas)

Proven in Block Studio. Use it for any panel that edits the block the author has selected.

## Contents
- [Loop](#loop)
- [Parsing a block](#parsing-a-block)
- [Saving](#saving)
- [Conflicts and selection changes](#conflicts-and-selection-changes)
- [Undo and redo](#undo-and-redo)
- [Rendering without losing focus](#rendering-without-losing-focus)
- [Field definitions from the block library](#field-definitions-from-the-block-library)

## Loop

```
subscribeLiveDocument ─► parse blocks ─► pick blocks[selection.blockIndex] ─► model ─► form
form edit ─► update model ─► rebuild block HTML ─► sendHTML(html,{replace,expected}) ─► live update ─► re-parse
```

Rule: **EW is the source of truth.** Subscribe, snapshot, propose a guarded replacement, then re-read the live result. Never trust your own string as the final state, because EW normalizes it.

Require `capabilities.liveDocument === 1 && capabilities.sendHTMLReplace === 1`. Otherwise show a read-only view or a message.

## Parsing a block

- Parse `html` with `DOMParser` and collect top-level `table`s (DA) or `div.{block}` structures in document order. Their index must line up with `selection.blockIndex`: count the same way EW does. Test this against real live HTML.
- Row 1 is the name plus variants: `Cards (dark, wide)` gives the name `cards` and the variants `dark` and `wide`.
- **Settings rows** are two cells where the first is a known option key (`theme | dark`). Read and remove them before treating the remaining rows as items. Otherwise a settings row shows up as an extra card.
- **Repeating items** are rows with the same shape. Use config (`editor` sheet `multi`) when present; otherwise use a heuristic, such as at least two rows with matching cell types.
- Field detection per cell: heading, rich text, image plus alt, button link, icon `:name:`, list. Keep unknown content as an opaque, read-only field rather than dropping it.

## Saving

```js
let saving = Promise.resolve();
let timer;
function scheduleSave(delay = 800) {
  clearTimeout(timer);
  timer = setTimeout(() => { saving = saving.then(save); }, delay);
}
async function save() {
  const html = buildBlockHtml(state.model);
  const result = await sdk.actions.sendHTML(html, {
    replace: true,
    expected: { html: state.snapshotHtml, blockIndex: state.blockIndex },
  });
  if (result?.ok) { state.snapshotHtml = result.html; return; }
  handleConflict(result);
}
```

- Debounce typing at about 800 ms. On blur or an explicit commit, flush after about 150 ms.
- Keep one save in flight by chaining promises.
- `expected.html` must be the **block** HTML from the latest live update, not the whole document.
- After `ok`, the next live update should match what you sent. Don't treat it as a remote change.

## Conflicts and selection changes

| Result | Meaning | UX |
|---|---|---|
| `STALE_LIVE` | Someone (a collaborator, the assistant or the author in the canvas) changed the block | Keep the author's draft. Offer **Re-apply my changes** or **Discard mine** |
| `WRONG_SELECTION` | The cursor moved to another block before the save | Pause: "Click the block again to save, or discard." Never write into the newly selected block |
| `NO_EDITOR` / timeout | The editor is not ready | Keep the draft and retry once the next live update arrives |

If the selection moves while a save is pending, **don't drop the draft silently**. Image uploads take time, so check that the same block is still selected before applying the uploaded URL.

## Undo and redo

- Store block snapshots, `{before, after}` HTML, per block.
- Before applying an undo, confirm the live block still equals `after`. If it doesn't, clear the history and say why.
- Keep history out of the render "shape". Otherwise every save rebuilds the panel and steals focus.

## Rendering without losing focus

- Do a full render only when the *shape* changes (a different block, field list or item count). Otherwise patch values in place.
- Skip writing to the element that has `document.activeElement`, or to a rich-text editor whose value hasn't changed.
- A rich editor's blur can fire before a toolbar button's click. Use `mousedown` + `preventDefault` on toolbar buttons, or defer destructive renders.
- `insertHTML` in contenteditable loses surrounding formatting. Wrap the selection's range in place instead.
- Normalize browser output: `<b>` to `<strong>`, `<i>` to `<em>`, `<strike>` to `<s>`, `<div>` to `<p>`.

## Field definitions from the block library

Optional config that makes forms friendlier. With no config, infer fields from content.

- **Library JSON** (the `library` → Blocks row) has multiple sheets: `blocks` (name, path) **must be first**, because EW reads the first sheet as the block list. Then `options` (`blocks | key | values`, plus optional `label | type | default`; EW skips rows without `values`), then `fields` and `editor` (`block | property=multi`).
- **Block example pages** can carry a `library-metadata` table with a `fields` cell containing a nested table (header `Fields`, then one row per template row). For multi blocks, use one shared item row.
- Merge order: built-in type rules → `all` / `*` rows → block-specific rows → label-specific rules. Org config first, then site config.
- `content.da.live` library URLs need the author's token. A request without auth returns 401. Pass a token-aware fetcher.
- Writing field names back: check write permission (the `x-da-actions` header), **re-read just before writing**, write the page, then update the index only if needed. Tell the author to reload any open copy and to preview the library so others see it.
- The assistant (`setPrompt`) can draft missing field definitions, but you cannot read its reply. Re-read the library after `chatTurnCompleted` and let the author review.
