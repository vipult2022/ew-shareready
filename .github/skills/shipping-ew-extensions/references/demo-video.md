# The demo video

The video is the fastest way to show author value. Judges and admins often watch it before they read anything.

**Target:** about 2 minutes (90 s to 2:30), silent, with captions added afterwards. Follow the arc **problem → clicks → result → proof in the third party**.

## Contents

- [Write the shot list](#write-the-shot-list)
- [Before you record](#before-you-record)
- [Record](#record)
- [Compress and check](#compress-and-check)
- [Embed](#embed)

## Write the shot list

Start from `assets/video-shots.md`. Rules:

- **Shot 1 is the problem, shown in the third party** (Notion brief, Jira board, Figma frame, Slack channel), with a caption naming today's manual pain.
- **One action per shot.** Write down the exact clicks and what to pause on, about 2 s on each result.
- **Captions are results, not instructions:** "Real blocks: Table, Accordion, Metadata from the brief", not "Click Insert".
- **Show proof that it happened**, in the third party or on the published page: the link written back, the Slack card, the Jira comment.
- **End card:** the extension name and the repo URL, held for about 5 s.
- Add a **"Before you record"** reset list. A second take must start from the same state, so delete created pages, clear the third-party write-backs and empty the test page.
- Add a **"If something goes wrong"** list with the exact panel messages and their fixes.

## Before you record

- Reset the demo data. Ask the agent to run the reset steps, for example deleting `/offers/…` and clearing the brief's link.
- Open only the tabs you need: EW on the test page, and the third party.
- **Close the other extension panels**, so the right one opens.
- Turn off Grammarly, notifications, password-manager pop-ups and bookmarks-bar clutter.
- Zoom the browser to 110–125 % so text can be read at 1080p.
- Use only demo-brand data. Check the account avatar, email and org names in the corners.

## Record

- **macOS:** press ⇧⌘5, choose *Record Selected Portion* or *Record Entire Screen*, and pick a 16:9 area.
- Move the mouse slowly and pause on results. Cut mistakes afterwards rather than retaking everything.
- Record without sound. Add captions later in iMovie, Clipchamp or Camtasia.

## Compress and check

GitHub's upload limit is 10 MB on free plans (100 MB on paid plans). Keep the video under 10 MB so it works anywhere:

```sh
sh <skills>/shipping-ew-extensions/scripts/compress-video.sh ~/Desktop/raw.mov ~/Desktop/{name}-demo.mp4        # 1920 wide, 20 fps
sh <skills>/shipping-ew-extensions/scripts/compress-video.sh ~/Desktop/raw.mov ~/Desktop/{name}-demo.mp4 1280 15 # smaller
```

Reference results: Notion, 1:45 → 4.2 MB (1920 wide, 30 fps, CRF 22); Figma → 7.8 MB (1920 wide, 20 fps, CRF 23); ShareReady → 6.6 MB (1080p, 20 fps, CRF 23).

If `ffmpeg` is missing, install it with `brew install ffmpeg`. Without Homebrew, use `python3 -m venv /tmp/ff && /tmp/ff/bin/pip install imageio-ffmpeg`, then point `FFMPEG` at the path printed by `/tmp/ff/bin/python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`.

Check the result before you upload it:

- Make a contact sheet (`ffmpeg -i out.mp4 -vf "fps=1/10,scale=480:-1,tile=4x3" sheet.png`) and look for private data and blank frames.
- Crop a frame at full size to check the text is sharp.

## Embed

1. On GitHub, open `tools/{name}/README.md` and click **Edit**. Use the `main` branch once it is merged, or the feature branch.
2. Drag the MP4 into the editor just under the title paragraph. GitHub uploads it and inserts a `https://github.com/user-attachments/assets/{id}` line.
3. Commit. A bare user-attachments URL on its own line renders as a player.
4. Pull that commit locally before you edit the README again, so you don't overwrite the video line.

The agent can't upload video for you, because it needs a browser session. Do this step yourself, or use the `github-pr-media` skill for PR descriptions.
