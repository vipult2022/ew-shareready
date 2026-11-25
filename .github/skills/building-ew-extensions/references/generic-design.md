# Generic by design

An extension must install on **any** EDS project, whether new or already live, with no code changes. Customer specifics come from config, never from code.

## The seven principles

1. **No project-specific code.** Never use site, block, brand or customer names in code. Built-in word lists (labels, field names, key synonyms) are fallbacks only, and config can override them.
2. **Useful with zero config.** With nothing configured, every feature works from content and conventions, or it hides itself. It never throws a setup error in the author's face.
3. **Reuse DA and EW conventions.** Read the block library, the `library` sheet, `options`, `query-index` and `library-metadata` before inventing new config.
4. **Opt-in, non-breaking config.** New config means new sheets or columns that EW ignores. Never change the meaning of an existing EW column.
5. **Hide what isn't available.** A missing capability, permission or worker means no button, or a one-line explanation. It never means a broken control.
6. **Keep the site-code contract tiny.** If the site must cooperate (for example block options as settings rows), ship one small helper and make it optional.
7. **Test both worlds.** Run tests and a browser pass against a configured project and a bare boilerplate project.

Never migrate or rewrite existing content to suit the extension. Read what is there.

## Config precedence

```
built-in defaults  <  org config (/config/{org})  <  site config (/config/{org}/{site})  <  URL params (testing only)
for rules:  type defaults  <  "all"/"*" rows  <  block-specific rows  <  label-specific rows
```

## Patterns

- **Settings sheet** `{name}` with `key | value`. Every key has a default. See surfaces-and-config.md.
- **Detection before config**: infer from content (repeating rows, image cells, links), then let config correct it.
- **Unknown stays visible**: show unknown variants and options as-is, read-only, rather than dropping them.
- **Feature probes**:
  - `capabilities.X === 1`
  - the `x-da-actions` header for write permission
  - `GET {worker}/status` for worker features
  - a HEAD on optional files such as `query-index.json`
- **Per-feature table in the README** with three columns: feature, optional config, behaviour without config.

## Review checklist

```
- [ ] grep for the demo brand, customer names, block names and org/site literals in code (not demo/ or tests)
- [ ] Remove the site config and reload: does every feature work or hide?
- [ ] Run on a fresh aem-boilerplate site: no errors in the console
- [ ] All URLs are built from context (org, site, path, branch), never hard-coded
- [ ] Every word list has a config override
```
