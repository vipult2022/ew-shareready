# Gotchas: symptom → cause → fix

Search this file for the symptom you see.

## Contents
- [SDK and loading](#sdk-and-loading)
- [Reading content](#reading-content)
- [Writing content](#writing-content)
- [Live editing UI](#live-editing-ui)
- [Workers and third parties](#workers-and-third-parties)
- [Config and library](#config-and-library)
- [Repo and shipping](#repo-and-shipping)

## SDK and loading

| Symptom | Cause | Fix |
|---|---|---|
| Panel stuck on "Loading…" in EW | SDK imported late or dynamically, so it missed the one-time `init` | Use a static `import DA_SDK` at the top of the entry module |
| Panel hangs forever in a normal tab | `DA_SDK` never resolves outside EW | `Promise.race` with a 4 s timeout, then demo |
| `context.repo` undefined | Some hosts send `site` | `context.repo \|\| context.site` |
| Requests start failing with 401 after a while | IMS token expired; you cached the string | Update from `message` events from `window.parent`; read the token at call time |
| `subscribeChatTurnCompleted` throws | Host lacks the capability | Check `capabilities.chatTurnCompleted === 1` first |
| Close button does nothing in a Prepare dialog | Dialog port only routes `openComparison` | Rely on the host's close button; call `closeLibrary` inside `try` |
| Prepare menu item greyed out | The branch preview isn't ready yet | Wait, or preview the page; explain this in the README |

## Reading content

| Symptom | Cause | Fix |
|---|---|---|
| Metadata missing in EW mode | Live HTML leaves out the Metadata block | Merge in saved draft metadata from the source API |
| Panel shows old content after an edit | Collaborative save is debounced 2–10 s, or the browser cache is used | `cache: 'no-store'`, scheduled rereads, sequence guard |
| Diff misses recent edits | Compared a cached preview, not the draft | Read the DA source for the draft. Use preview only for reviewer links |
| Live page content lags | `.plain.html` CDN lag | Fetch the full page, extract `<main>`, cache-bust, retry once |
| Older response overwrote newer state | Async race | Sequence counter per load |
| Library or JSON 401 on `content.da.live` | It's private | Fetch with the bearer token (token-aware fetcher) |
| Library variants vanish | Wrapped a full DA document in another `<main>` | Detect an existing `<main>` and parse as-is |
| `query-index.json` blocked | No CORS on the site | Add CORS headers in site config, or read through a worker |

## Writing content

| Symptom | Cause | Fix |
|---|---|---|
| Inserted table ends up inside a block cell | `sendHTML` inserts at the cursor | Refuse when `blockIndex !== null`; ask for an empty line |
| "Fix" can't update existing metadata | `sendHTML` can't edit in place | Insert a whole block when none exists, otherwise guide or Copy per field; use replace only on a selected block |
| Replace returns `STALE_LIVE` | Block changed since your snapshot | Show the conflict: re-apply or discard. No blind retry |
| Replace returns `WRONG_SELECTION` | Cursor moved before the save | Pause; ask the author to reselect; never write elsewhere |
| Saved HTML differs from what you sent | EW (ProseMirror) normalizes | Re-parse the returned or live HTML; compare semantically |
| Images break a day later | Third-party URLs expire | Copy into DA `/media/` before insert |
| Slack `invalid_blocks` | Private or unreachable image URL | Retry without the image; prefer the published image URL |
| Duplicate issues or posts | Auto-retry on a write | Never retry writes; make actions idempotent where possible |
| Page overwritten | No existence check | HEAD first; refuse if it exists |
| Layout view shows raw bold or italic links instead of buttons after an edit | Site doesn't re-decorate after an inline quick edit | Site `scripts.js` opts into da-live `quick-edit-init.js` (partial reload). It's not an extension bug |
| Settings row appears as an extra item or card | Block code treats every row as content | Read and remove option rows first (`readBlockOptions` helper on the site side) |
| Upload applied to the wrong block | Author switched blocks during the upload | Check that the same block is still selected before applying |

## Live editing UI

| Symptom | Cause | Fix |
|---|---|---|
| Caret jumps or focus is lost while typing | Full rerender on every state change | Rerender only on shape change; patch the focused field in place |
| Every save steals focus | Undo or redo state was part of the render shape | Keep history out of the shape |
| Toolbar click does nothing | Editor blur rerendered and detached the button | `mousedown` + `preventDefault` on toolbar buttons |
| Formatting lost when toggling code | `insertHTML` | Wrap the range in place |
| `<b>` and `<strike>` appear in output | Browser `execCommand` output | Normalize to `<strong>` and `<s>` |
| Heading in a description becomes a new field after reload | Parser splits on headings | Merge headings that follow description text into that field |
| Text "null" appears | `append(null)` | Skip null, undefined and false in `h()` |
| Grid content overflows the panel | `1fr` min-content | `minmax(0, 1fr)`, `overflow-wrap: anywhere` |
| Preview area collapses | Flex shrink | `flex: none` on the stage |
| Multi-cell selection edits only one cell | Selection spans cells | Validate per cell; refuse or split |

## Workers and third parties

| Symptom | Cause | Fix |
|---|---|---|
| CORS error from a Figma plugin | Plugin UI origin is `null` | `*` CORS on plugin routes only, plus a team key |
| CORS error from EW | Origin not in the allow-list, or a missing preflight | Defaults plus `ALLOWED_ORIGINS`; handle `OPTIONS` |
| Worker serves anyone | Empty allow-list treated as "all" | Empty `ALLOWED_ORGS` means a setup error (500, `code: 'setup'`) |
| IndexNow 429 | Shared Cloudflare egress | Try the next endpoint |
| Figma REST 429 | Plan or seat limits | Explain; use the plugin handoff route |
| Notion "no pages" | Pages not shared with the integration | Setup screen explains ••• → Connections |
| Airtable quota gone | Fast polling | 60 s polling, a 60 s worker cache, skip fetches you don't need |
| Jira says not reviewed after the reviewer closed it | Done was treated only as published | Closed-without-published means approved |

## Config and library

| Symptom | Cause | Fix |
|---|---|---|
| New config ignored | EW reads config at load | Reload EW |
| EW block list broken after adding sheets | Your sheet came first | Keep `blocks` as the first sheet in the library JSON |
| Typed option rows break EW's option picker | Rows without `values` | EW skips them, which is fine; keep `values` empty only for extension-only rows |
| Library edit invisible to others | Not previewed | Tell the author to preview the library page |
| Config write wiped other sheets | Wrote a partial JSON | Read, modify and write the whole multi-sheet JSON |

## Repo and shipping

| Symptom | Cause | Fix |
|---|---|---|
| Test, worker or docs files are publicly served | Every committed file is served | `.hlxignore` entries |
| Lint fails on CSS keywords | Stylelint wants lowercase (`blinkmacsystemfont`) | Follow the rule |
| PR rejected | No branch preview link | Add `https://{branch}--{site}--{org}.aem.page/{path}` |
| Branch code not updated | Code Sync lag, or the AEM Code Sync app isn't installed | Wait or reinstall; check `https://{branch}--…aem.page/tools/{name}.html` |
