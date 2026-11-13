/**
 * Talks to the ReviewLoop worker, which holds the Jira credentials. Every call sends
 * the author's IMS token so the worker can confirm they can read the page. Never throws:
 * results are { ok: true, ... } or { ok: false, error }.
 *
 * createDemoApi() answers the same calls from memory (and localStorage, so the panel and
 * the dialogs share one demo review) for ?demo=1 and for judges without Jira.
 */

const TIMEOUT = 15000;
const RETRY_DELAY = 1000;

export function workerBase(url) {
  try {
    const u = new URL(url);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !local) return null;
    return u.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

async function readJson(resp) {
  try {
    return await resp.json();
  } catch {
    return {};
  }
}

export function createApi({ workerUrl, getToken }) {
  const base = workerBase(workerUrl);

  async function attempt(path, body) {
    if (!base) return { ok: false, error: 'Set worker-url in the reviewloop sheet of the site config.', setup: true };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const resp = await fetch(`${base}${path}`, body ? {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(body),
      } : { signal: ctrl.signal });
      const data = await readJson(resp);
      if (!resp.ok || data.ok === false) {
        return {
          ok: false, status: resp.status, setup: Boolean(data.setup), error: data.error || `The ReviewLoop worker answered ${resp.status}.`,
        };
      }
      return { ok: true, ...data };
    } catch {
      return {
        ok: false, unreachable: true, error: 'Could not reach the ReviewLoop worker. Check worker-url and the worker’s ALLOWED_ORIGINS.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // Reads retry once after a dropped connection or timeout. Writes never do,
  // so a slow create cannot open a second Jira issue.
  async function call(path, body, { retry = false } = {}) {
    const first = await attempt(path, body);
    if (!retry || !first.unreachable) return first;
    await new Promise((resolve) => { setTimeout(resolve, RETRY_DELAY); });
    return attempt(path, body);
  }

  return {
    demo: false,
    status: () => call('/status', null, { retry: true }),
    versions: (page) => call('/page', page, { retry: true }),
    get: (page) => call('/review/get', page, { retry: true }),
    create: (body) => call('/review/create', body),
    resubmit: (body) => call('/review/resubmit', body),
    published: (body) => call('/review/published', body),
  };
}

/* Demo mode */

const STORE = 'reviewloop-demo';
const DEMO_JIRA = 'https://northwind-bank.atlassian.net';

export const DEMO_REVIEWER = { name: 'Arjun Mehta', initials: 'AM' };
export const DEMO_AUTHOR = 'Priya Shah';

function freshStore() {
  return { draft: 'review1', review: null, next: 42 };
}

function load(storage) {
  try {
    const data = JSON.parse(storage?.getItem(STORE) || 'null');
    return data && typeof data === 'object' ? { ...freshStore(), ...data } : freshStore();
  } catch {
    return freshStore();
  }
}

/**
 * @param {object} opts
 * @param {Function} opts.fixture loads a demo page by name ('live', 'review1', 'review2')
 * @param {Storage} [opts.storage]
 * @param {number} [opts.latency] fake network delay in ms
 */
export function createDemoApi({ fixture, storage = null, latency = 600 }) {
  let store = load(storage);
  // The panel and the dialogs are separate frames: always start from the shared copy.
  const sync = () => {
    if (storage) store = load(storage);
  };
  const save = () => {
    try {
      storage?.setItem(STORE, JSON.stringify(store));
    } catch {
      // Private mode: keep the demo in memory.
    }
  };
  const later = (value, ms = latency) => new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
  const stamp = () => new Date().toISOString();
  const comment = (author, text) => ({
    id: String(Date.now() + Math.random()), author, created: stamp(), text,
  });

  return {
    demo: true,
    status: () => later({
      ok: true,
      jira: { site: DEMO_JIRA, project: 'NWB', projectName: 'Northwind Web' },
    }, 150),
    versions: async () => {
      sync();
      return later({
        ok: true,
        live: await fixture('live'),
        preview: await fixture(store.draft),
      });
    },
    get: () => {
      sync();
      return later({ ok: true, review: store.review }, 250);
    },
    create: (body) => {
      sync();
      const key = `NWB-${store.next}`;
      store.next += 1;
      store.review = {
        key,
        url: `${DEMO_JIRA}/browse/${key}`,
        summary: body.summary,
        status: 'In review',
        state: 'review',
        reviewType: body.reviewType,
        due: body.due,
        assignee: { name: DEMO_REVIEWER.name },
        round: 1,
        snapshot: body.snapshot,
        requestedAt: stamp(),
        comments: [],
      };
      save();
      return later({
        ok: true, key, url: store.review.url, review: store.review,
      }, latency * 1.5);
    },
    resubmit: (body) => {
      sync();
      if (!store.review) return later({ ok: false, error: 'There is no review for this page yet.' });
      store.review = {
        ...store.review,
        status: 'In review',
        state: 'review',
        round: (store.review.round || 1) + 1,
        snapshot: body.snapshot,
        requestedAt: stamp(),
        comments: [...store.review.comments, comment(DEMO_AUTHOR, body.text || 'Sent back for review.')],
      };
      save();
      return later({ ok: true, review: store.review });
    },
    published: () => {
      sync();
      if (store.review) {
        store.review = { ...store.review, status: 'Done', state: 'done' };
        save();
      }
      return later({ ok: true });
    },
    /* Demo-only controls: play the reviewer, or make the author's fix. */
    reviewer(action) {
      sync();
      if (!store.review) return;
      if (action === 'changes') {
        store.review = {
          ...store.review,
          status: 'Changes requested',
          state: 'changes',
          comments: [...store.review.comments, comment(DEMO_REVIEWER.name, 'Rate claims need the variable-rate wording. In the intro, please change “by May 31 and earn 4.50% APY for your first 12 months” to “by May 31 and earn 4.50% APY (variable rate) for your first 12 months”.')],
        };
      } else if (action === 'approve') {
        store.review = {
          ...store.review,
          status: 'Approved',
          state: 'approved',
          approvedAt: stamp(),
          approvedBy: DEMO_REVIEWER.name,
          comments: [...store.review.comments, comment(DEMO_REVIEWER.name, 'Approved. Thanks for adding the variable-rate wording.')],
        };
      }
      save();
    },
    fix() {
      sync();
      store.draft = 'review2';
      save();
    },
    reset() {
      store = freshStore();
      save();
    },
    get draft() {
      sync();
      return store.draft;
    },
  };
}
