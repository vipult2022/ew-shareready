# Agent skills for Experience Workspace extensions

These are [Agent Skills](https://agentskills.io) learned from building six EW extensions (ShareReady, ReviewLoop, Airtable, Notion, Figma handoff and Block Studio). Copilot, Claude Code and other agents that support `SKILL.md` load them when a task matches.

| Skill | Use it for |
|---|---|
| [`building-ew-extensions`](building-ew-extensions/SKILL.md) | Planning, scaffolding, coding, testing and debugging a library panel, Prepare dialog or fullscreen app, with or without a Cloudflare Worker |
| [`shipping-ew-extensions`](shipping-ew-extensions/SKILL.md) | README, Marketplace card and image, demo video, PR, release, fresh-install test and nomination text |

## Use them in another project

- **One repo:** copy both folders into that repo's `.github/skills/`. The scripts expect to be run from the repo root.
- **All your projects:** copy them into your personal skills folder (`~/.copilot/skills/` for Copilot, `~/.claude/skills/` for Claude Code).

Then ask, for example, "build an EW extension that inserts {Service} items", or run the scaffolder yourself:

```sh
node .github/skills/building-ew-extensions/scripts/new-extension.mjs --name my-tool --title "My Tool" --worker
node .github/skills/building-ew-extensions/scripts/check-extension.mjs --name my-tool
```

## Keep them current

When extension work turns up something new, add it in the same PR:

| You learned | Update |
|---|---|
| A bug with a non-obvious cause | `building-ew-extensions/references/gotchas.md` (symptom → cause → fix) |
| SDK action, event, capability or timing | `references/sdk-and-events.md`, and a golden rule in `SKILL.md` if it cost real time |
| A new third-party API or auth detail | `references/third-party-recipes.md` |
| Something EW can or can't do | `references/capabilities.md` |
| A mistake a script could catch | `scripts/check-extension.mjs` |
| A pattern every new extension needs | `assets/template/`, then scaffold a test extension and run `npm run lint && npm test` |
| A shipping step (README, Marketplace, video, PR) | `shipping-ew-extensions/references/` |

Keep `SKILL.md` under 500 lines; put detail in references.

Nothing here is served by the site: `.hlxignore` excludes dot folders.
