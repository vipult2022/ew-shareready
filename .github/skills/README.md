# Agent skills (copy)

These skills are a copy of the `ew-extensions` plugin from **[vipult2022/agent-skills](https://github.com/vipult2022/agent-skills)**, which is the master. Edit them there, not here.

| Skill | Use it for |
|---|---|
| [`building-ew-extensions`](building-ew-extensions/SKILL.md) | Planning, scaffolding, coding, testing and debugging a library panel, Prepare dialog or fullscreen app, with or without a Cloudflare Worker |
| [`shipping-ew-extensions`](shipping-ew-extensions/SKILL.md) | README, Marketplace card and image, demo video, PR, release, fresh-install test and nomination text |

Agents that open this repo pick them up automatically. For install options, scripts, prompts and troubleshooting, see the [plugin README](https://github.com/vipult2022/agent-skills/tree/main/plugins/ew-extensions).

## Re-sync from the master

```sh
git clone https://github.com/vipult2022/agent-skills.git ~/code/agent-skills   # once
cd ~/code/agent-skills && git pull
sh scripts/install.sh ew-extensions --project /path/to/ew-shareready
```
