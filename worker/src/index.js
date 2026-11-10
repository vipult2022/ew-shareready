import {
  HttpError, allowedOrigin, corsHeaders, json, validatePage, authorize, shareUrl,
  scrapeFacebook, pingIndexNow, postSlack, features,
} from './share.js';

const MAX_BODY = 16 * 1024;

const STEPS = {
  facebook: ({ url, env }) => scrapeFacebook(url, env),
  indexnow: ({ url, env }) => pingIndexNow(url, env),
  slack: ({
    url, page, body, env,
  }) => postSlack({
    url, page, utm: body.utm, note: body.note, fallback: body.card,
  }, env),
};

async function readBody(request) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    throw new HttpError(415, 'Send the request as JSON.');
  }
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'The request is too large.');
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // Reported below.
  }
  throw new HttpError(400, 'The request is not valid JSON.');
}

async function share(request, env) {
  const body = await readBody(request);
  const page = validatePage(body);
  await authorize(request, page, env);
  const url = shareUrl(page, body.host, env);
  const wanted = Array.isArray(body.steps) ? body.steps : Object.keys(STEPS);
  const steps = [...new Set(wanted)].filter((step) => Object.hasOwn(STEPS, step));
  if (!steps.length) throw new HttpError(400, 'Choose at least one step: facebook, indexnow or slack.');
  const results = {};
  await Promise.all(steps.map(async (step) => {
    results[step] = await STEPS[step]({
      url, page, body, env,
    });
  }));
  return {
    ok: Object.values(results).every((r) => r.ok || r.skipped),
    url,
    results,
  };
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get('Origin');
    const origin = allowedOrigin(requestOrigin, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
    }
    if (requestOrigin && !origin) {
      return json({ ok: false, error: `${requestOrigin} may not call this worker. Add it to ALLOWED_ORIGINS.` }, 403);
    }
    const { pathname } = new URL(request.url);
    try {
      if (request.method === 'GET' && (pathname === '/' || pathname === '/status')) {
        return json({ ok: true, name: 'shareready', features: features(env) }, 200, origin);
      }
      if (request.method === 'POST' && pathname === '/share') {
        return json(await share(request, env), 200, origin);
      }
      return json({ ok: false, error: 'Not found.' }, 404, origin);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ ok: false, error: error.message }, error.status, origin);
      }
      // eslint-disable-next-line no-console
      console.error(error);
      return json({ ok: false, error: 'Something went wrong in the ShareReady worker.' }, 500, origin);
    }
  },
};
