# DA App SDK and events

## Contents
- [Loading the SDK safely](#loading-the-sdk-safely)
- [What the SDK resolves to](#what-the-sdk-resolves-to)
- [Capabilities](#capabilities)
- [Actions](#actions)
- [Events](#events)
- [Token refresh](#token-refresh)
- [Timing patterns](#timing-patterns)
- [Prepare dialogs and apps](#prepare-dialogs-and-apps)

## Loading the SDK safely

```js
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const SDK_TIMEOUT = 4000;
const params = new URLSearchParams(window.location.search);
const embedded = window.parent !== window && !params.has('demo');
const sdk = embedded
  ? Promise.race([DA_SDK, new Promise((r) => { setTimeout(() => r(null), SDK_TIMEOUT); })])
  : Promise.resolve(null);
sdk.then((found) => (found?.context?.org ? startLive(found) : startDemo())).catch(showError);
```

Why each part matters:
- **Static import.** The SDK listens for one `init` message that carries a transferred `MessagePort`. The host sends it about 750 ms after the iframe loads, and only once. If the module loads later (dynamic `import()` after other awaits), the promise never resolves.
- **Race.** Outside EW (a plain browser tab, a test page or the Marketplace "Try" link) nothing ever sends `init`, so the promise hangs forever.
- **`found?.context?.org`.** Some hosts resolve without page context. Treat that as "not in EW".

## What the SDK resolves to

```js
{
  context: { org, repo, site, path, branch, ref, view },  // repo or site; path without .html in EW
  token,                                                    // the author's IMS token
  capabilities: { liveDocument: 1, sendHTMLReplace: 1, chatTurnCompleted: 1, dragDrop: 1 },
  project,                                                  // sometimes present
  actions: { ... },
}
```

- `const site = context.repo || context.site;`
- `const path = (context.path || '/').replace(/\.html$/, '');` For the source API, map `/` and folder paths to `/index`.
- On init, the SDK calls `setTitle(document.title)`. Give each page a meaningful `<title>`.

## Capabilities

| Capability | Unlocks | Without it |
|---|---|---|
| `liveDocument === 1` | `subscribeLiveDocument` (EW canvas mode) | You are in the classic DA editor. Read the draft through the source API and insert at the cursor without block checks |
| `sendHTMLReplace === 1` | `sendHTML(html, { replace: true })` | Insert only. Hide edit-in-place features |
| `chatTurnCompleted === 1` | `subscribeChatTurnCompleted` (throws without it) | Poll or reread after `setPrompt` |
| `dragDrop === 1` | Pointer-based EW drag in `makeDraggable` | Falls back to native browser drag and drop |

The SDK object exposes methods that a given host may ignore. **Only a capability flag means a method works.**

## Actions

| Action | Wire / arguments | Result and limits |
|---|---|---|
| `subscribeLiveDocument(cb)` | Receives `liveDocument {html, selection, editable?}` and `liveSelection {selection}` | Returns an unsubscribe function. The last document is replayed to new subscribers. `selection.blockIndex` is a number or `null`. Debounced about 150 ms. **The HTML leaves out the Metadata block.** |
| `sendHTML(html)` | `{action:'sendHTML', details: html}` | Inserts at the cursor. Returns `undefined` and gives no confirmation. Cannot update an existing block |
| `sendHTML(html, {replace:true, expected})` | `expected: {html, blockIndex}` | Promise resolving to `{ok, html, selection, editable, error?, message?}`. Times out after 15 s. Errors: `STALE_LIVE`, `WRONG_SELECTION`, `NO_EDITOR`, `INVALID_HTML`, `INVALID_EXPECTED`, `REPLACE_FAILED`. Replaces the **selected** block only |
| `getSelection()` | | Resolves to the selected HTML string. **Rejects with a string** when nothing is selected. It is a snapshot, not cursor control |
| `setPrompt(text, {autoSend})` | | Fills the EW assistant prompt and, with `autoSend: true`, sends it. Returns nothing and **never gives you the assistant's answer** |
| `subscribeChatTurnCompleted(cb)` | | `{status: 'completed'\|'aborted'\|'error', …}`: event metadata only, no assistant text. Reread the document afterwards |
| `sendText(text)` | | Inserts plain text at the cursor |
| `closeLibrary()` | | Closes the library panel. **Does nothing in Prepare dialogs** |
| `showPanel(name)` | | Opens a host panel, e.g. Blocks |
| `saveDocument()` | | Promise with `{ok, …}`. Asks for a save; it does not replace content |
| `openComparison({candidate, baseline})` | candidate `'document'\|'preview'`, baseline `'live'` | Opens EW's diff view. Throws on invalid options. No result |
| `closeComparison()` | | |
| `setTitle`, `setHref`, `setHash` | string | Change the host's title, URL or hash |
| `makeDraggable({element, getData, onResult?})` | | Resolves to a cleanup function. Check `dragDrop` |
| `daFetch(url, opts)` | | An authenticated fetch helper. Prefer your own `fetch` with `Authorization: Bearer ${token}` so you control errors and refresh |

## Events

Only three things are pushed to you:
1. **Live document and selection** (`subscribeLiveDocument`).
2. **Chat turn completed** (`subscribeChatTurnCompleted`).
3. **Token refresh**: a raw `message` event, not an SDK callback.

There is no event for "document saved", "cursor moved inside a block", "published" or "panel closed". Use `visibilitychange` and `focus` on your own window to refresh when the author comes back.

Handler rules:
- Keep subscription callbacks cheap. Store the payload, then schedule work with a debounce. Don't fetch inside every callback.
- Wrap `subscribe*` calls in `try`: older hosts throw.
- A live update can arrive **before** your `sendHTML` promise resolves, and again after a debounce. Compare it with your in-flight write before treating it as someone else's change.

## Token refresh

```js
state.token = sdk.token;
window.addEventListener('message', (e) => {
  if (e.source === window.parent && e.data?.token) state.token = e.data.token;
});
const auth = () => ({ Authorization: `Bearer ${state.token}` });
```

Pass `() => state.token` into connection objects; never pass the string itself. A 401 from DA means the token expired: tell the author to reload EW. Don't loop.

## Timing patterns

**Sequence guard** (any async load triggered by the author or an event):

```js
let seq = 0;
async function load() {
  seq += 1;
  const mine = seq;
  const data = await fetchSomething();
  if (mine !== seq) return; // a newer load started; drop this result
  render(data);
}
```

**Reread after a write.** The DA collaborative save is debounced about 2 s, up to about 10 s. After Fix, Insert or an assistant turn, schedule rereads (for example at 1.5, 4 and 10 s) and stop as soon as the saved content changes.

**Debounce live updates** before expensive analysis (150–300 ms). Debounce typing writes at about 800 ms and flush on blur at about 150 ms.

**Polling.** Poll third-party status only while the panel is visible (`document.visibilityState === 'visible'`). Slow down for APIs with small quotas (Airtable: 60 s, Jira: 15 s). Refresh immediately on `focus` and `visibilitychange`.

## Prepare dialogs and apps

- **Prepare dialog init:** `{context: {view, org, site, repo, ref, branch, path}, token}`, with **no capabilities**. Its port only routes `openComparison`. You cannot edit the document. Show your own result screen, with a "Close" hint, and let the host's close button close it. Calling `closeLibrary()` inside `try` is harmless.
- Prepare items are disabled until the branch preview is ready.
- **Apps** get `context` and `token` but no live document. Use them for site-wide work through the DA and AEM APIs.
- Panels and dialogs are separate pages. They each run their own SDK session and share state only through your worker or `localStorage` (demo only). You don't need a message bus between iframes.
