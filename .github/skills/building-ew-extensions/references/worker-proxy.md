# Worker proxy (Cloudflare Workers, free tier)

You need a worker only when the third party:
- needs a secret (an API token, app secret or webhook URL), or
- blocks browser calls with CORS (Notion, Meta Graph scrape, Slack webhooks, Jira, Figma REST, IndexNow).

Everything else (previews, checks, inserting, DA and AEM APIs) runs in the panel with the author's token. That is "zero-config mode", and it should work without the worker.

## Contents
- [Request contract](#request-contract)
- [Security checklist](#security-checklist)
- [CORS](#cors)
- [Secrets and vars](#secrets-and-vars)
- [Routes and errors](#routes-and-errors)
- [State, caching and limits](#state-caching-and-limits)
- [Testing and deploying](#testing-and-deploying)

## Request contract

- The panel sends `POST {worker}/{route}` with `Authorization: Bearer {IMS token}`, `Content-Type: application/json` and a body of `{ org, site, path, ...routeArgs }`.
- The worker answers JSON: `{...data}` on success and `{ error, code }` on failure, with a real HTTP status.
- `GET /status` needs no token. It returns `{ ok, service, configured, ...feature flags }`, and the panel uses it for setup screens.

## Security checklist

1. **Validate the page**:
   - `org` and `site` match `/^[a-z0-9][a-z0-9-]{0,62}$/i`.
   - `path` matches `/^(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)+$|^\/$/`.
   - Reject `..` and `.` segments.
   - Lowercase org and site.
2. **Allow-list**: `ALLOWED_ORGS` = `org` or `org/site`, comma-separated. If it's empty, answer 500 with `code: 'setup'`. A forgotten allow-list must not open the worker to every org.
3. **Authorize**:
   - Require a bearer token.
   - `HEAD https://admin.da.live/source/{org}/{site}{path}.html` with that token must be 2xx. On 404, fall back to `https://api.aem.live/{org}/sites/{site}/source{path}.html`.
   - 401 means "session expired" and 403 means "no access". Never fall back on those.
   - Cache success for 5 minutes, keyed by `sha256(token)` plus the page. Never use the raw token as a key or log it.
4. **Rate limit** per token hash (for example 60 requests/minute) using an in-memory Map capped at about 1000 entries.
5. **Body**: JSON only (415 otherwise), a size cap (for example 200 KB, 413), and an object, not an array.
6. **Outbound URLs** from the body (image proxy, page URL to scrape):
   - Allow https only, with no userinfo.
   - Restrict hosts where possible. For example, a URL to share must be on `*.aem.live`, `*.aem.page` or the site's configured domain.
   - Allow-list content types and cap the size.
7. **Write switches**: an env flag such as `ALLOW_WRITE=no` disables writes to the third party.
8. Generic error text for unknown exceptions ("Something went wrong in the X worker"). Never echo upstream bodies that may contain tokens.

The full helper is in `assets/template/tools/__NAME__/worker/src/http.js`.

## CORS

- Default allowed origins: `https://da.live`, `https://*.da.live`, `https://*.aem.page`, `https://*.aem.live` and `http://localhost:3000`. `ALLOWED_ORIGINS` overrides them (wildcards allowed).
- Echo the matched origin and set `Vary: Origin`. Answer `OPTIONS` with 204 for allowed origins and 403 otherwise.
- If a request has an `Origin` header that isn't allowed, refuse it.
- **Figma plugin exception:** the plugin UI iframe has origin `null`. Allow `*` only on plugin routes, including the preflight, and protect those routes with a team key instead.
- CORS is browser hygiene, **not** authorization. The IMS check is.

## Secrets and vars

```toml
name = "my-tool"
main = "src/index.js"
compatibility_date = "2025-10-01"

[vars]
ALLOWED_ORGS = "my-org"          # required
# ALLOWED_ORIGINS = ""           # optional override
# ALLOW_WRITE = "yes"
```

- Set secrets with `npx wrangler secret put API_TOKEN`. **Never** put them in `[vars]`, the README or a test fixture that looks real.
- Document every secret and var at the top of `wrangler.toml`: what it is, where to get it and the minimum scopes.
- Workers KV is needed only for state that must persist (for example Figma handoffs). Most extensions need none: keep state in the third party (Jira issue properties, an Airtable field).

## Routes and errors

```js
export async function handle(request, env = {}, now = Date.now()) {
  const origin = allowedOrigin(request.headers.get('Origin'), env);
  const route = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '');
  if (request.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
  try {
    if (request.method === 'GET' && route === 'status') return json({ ok: true, configured: isConfigured(env) }, 200, origin);
    if (request.method !== 'POST' || !routes[route]) throw new HttpError(404, 'Not found.');
    if (request.headers.get('Origin') && !origin) throw new HttpError(403, 'This site may not use the worker.');
    const body = await readBody(request);
    const page = validatePage(body);
    await authorize(request, page, env, now);
    return json(await routes[route](body, env, page), 200, origin);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status, origin);
    return json({ error: 'Something went wrong in the worker.' }, 500, origin);
  }
}
export default { fetch: (request, env) => handle(request, env) };
```

- Export `handle(request, env, now)` so tests can call it without Wrangler.
- Write error messages for authors: what happened and what to do ("Add the SLACK_WEBHOOK secret", "Too many requests. Try again in a minute.").
- For multi-step actions (publish & share), run independent steps in parallel with `Promise.allSettled`. Report each step's result separately and never fail everything because one step failed.

## State, caching and limits

- Isolates are short-lived: in-memory caches are best effort. Use short TTLs (about 60 s) for third-party reads, and cap the number of entries.
- Respect free-tier quotas. Airtable's monthly call budget means polling at 60 s and skipping fetches you don't need.
- On 429 from the third party, pass back `Retry-After` and a friendly message. For IndexNow, try the next endpoint (see recipes).
- Cloudflare egress IPs are shared, so some APIs rate-limit them harder. Plan for a fallback.

## Testing and deploying

- Unit-test `handle()` with `node:test`. Stub `globalThis.fetch` to return DA 200/401/403/404 and third-party responses, and restore it in `afterEach`. Call `resetState()` so the auth cache and rate-limit Maps don't leak between tests.
- Test cases: missing token, wrong org, bad path (`/../x`), disallowed origin, preflight, setup-missing (500 with `code: 'setup'`), a happy path for each route, a third-party error mapping, and the rate limit.
- Local: `cd tools/{name}/worker && npx wrangler dev`, then point the panel at it with `?worker-url=http://localhost:8787`.
- Deploy: `npx wrangler deploy` (it prints the `*.workers.dev` URL). Put the URL in the site's `{name}` sheet as `worker-url`.
- Add `tools/{name}/worker/*` to `.hlxignore`.
