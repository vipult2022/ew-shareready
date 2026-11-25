# {Title}: video shot list

**Target:** about 2 minutes. Record full screen with no sound; captions are added afterwards. Pause about 2 seconds on each result.

## Before you record (5 min)

- [ ] Reset the demo state: {delete the created page /path}, {clear the write-back in {Service}}, {empty /drafts/{name}-test}.
- [ ] **Two browser tabs:**
  - EW: https://da.live/canvas#/{org}/{site}/drafts/{name}-test
  - {Service}: {the record, board, file or channel}
- [ ] Close every other extension panel, so only {Title} opens.
- [ ] Turn off Grammarly, notifications and password-manager pop-ups. Hide the bookmarks bar. Zoom to 110–125 %.
- [ ] Use only demo-brand data. Check the avatar, email and org names in the corners.

## Shots

| # | Time | Screen | Do this | Caption |
|---|------|--------|---------|---------|
| 1 | 0:00–0:12 | {Service} | Hold on {the source}. Scroll a little. | **{The manual pain today, in one line}** |
| 2 | 0:12–0:25 | EW | **Extensions › {Title}**. The list appears. Search `{term}`. | **{Title} in EW: {what the author sees}, next to the page** |
| 3 | 0:25–0:45 | EW panel | Open **{item}**. Hold on the preview or options. | **{What is special: real blocks, checks, AI…}** |
| 4 | 0:45–1:05 | EW | Click an empty line. Press **{main action}**. Hold on the busy text, then the result. | **{Result in one line}** |
| 5 | 1:05–1:25 | {Service} | Switch tabs (reload). Show the write-back or post. | **{Proof in the third party}** |
| 6 | 1:25–1:45 | Browser | **Preview** in DA. Scroll the published page. | **An ordinary Edge Delivery page: fast, indexable, editable** |
| 7 | 1:45–1:55 | Any | Hold. | **{Title} for Experience Workspace · github.com/{owner}/{repo}** |

### If something goes wrong

- *Your cursor is inside a block*: click an empty line outside the block, then press **{main action}** again.
- *{Other panel message}*: {fix}.
- Nothing in **Extensions**: reload EW, because the config is cached.

## After recording

1. Compress it: `sh <skills>/shipping-ew-extensions/scripts/compress-video.sh ~/Desktop/raw.mov ~/Desktop/{name}-demo.mp4`
2. Check a contact sheet for private data.
3. Drag the MP4 into `tools/{name}/README.md` on GitHub, just under the title paragraph.
