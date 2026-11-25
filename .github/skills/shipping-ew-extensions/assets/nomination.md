# {Title}: nomination details

Paste each field into its column in the nomination form or table.

## Extension idea (one line)
**{Title} for EW:** {verb} {outcome} {where/when, e.g. "next to the page you're editing"}, {differentiator, e.g. "with real blocks and the link written back to {Service}"}.

## Short version (if the field is tight)
**{Title}:** {6 to 12 words}.

## Third party
{Service} ({which API: read, write}). Cloudflare Workers (free) holds the {Service} secret. {Free tier or plan needed.}

## Solo or working group?
{Solo | names}

## Links
- Code and README: https://github.com/{owner}/{repo}/tree/main/tools/{name}#readme
- Panel demo (no accounts): https://main--{site}--{owner}.aem.page/tools/{name}.html?demo=1
- Demo video: {user-attachments URL or README anchor}
- A real result: {a page created by the extension, a Slack message or a Jira issue, from demo data}

---

## Longer description

**The problem.** {Who} {does what by hand today}, {how often}, {what it costs: minutes, errors, nobody knows X}. {Based on customer feedback, if true: describe the pain without naming the customer.}

**The author workflow (problem → clicks → result).**
1. Open **Extensions › {Title}**. {What appears.}
2. {Choose or check something.} {What the panel shows.}
3. Press **{main action}**. {The result in EW, plus the proof in {Service}.}

**What makes it different.**
- **{Strongest benefit}.** {One sentence.}
- **{Two-way or round trip}.** {What is written back and why it matters.}
- **{Quality detail}.** {Images copied, checks or AI, for example.}
- **Secure by design.** The {Service} secret stays in the worker, which only answers people who can read the page in Document Authoring, for allowed orgs.
- **Zero-setup demo** with sample data, and a 10-minute install with one config row and one worker.
- **Works on any EDS site.** No site-specific code; optional config sheet; with no config, features work or hide themselves.
