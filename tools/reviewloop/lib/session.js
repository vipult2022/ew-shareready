/**
 * Starts ReviewLoop: inside Experience Workspace it uses the DA SDK (page context and
 * the author's IMS token); opened directly or with ?demo=1 it runs the Northwind demo.
 */

// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { loadConfig, withQuery, parseConfig } from './config.js';
import { createApi, createDemoApi, DEMO_AUTHOR } from './api.js';
import { pageInfo, refreshPreview, publishPage } from './page.js';

const SDK_TIMEOUT = 4000;
const DEMO = new URL('../demo/', import.meta.url);

export const REPO_URL = 'https://github.com/vipult2022/ew-shareready';
export const DOCS_URL = `${REPO_URL}/tree/main/tools/reviewloop#readme`;

const DEMO_CONFIG = {
  reviewloop: { data: [{ key: 'worker-url', value: 'demo' }] },
  'reviewloop-types': {
    data: [
      {
        type: 'Legal', assignee: 'Arjun Mehta', checklist: 'Rates, dates and APY wording are accurate; Required disclaimers are present', 'due-days': '2',
      },
      {
        type: 'Brand', assignee: 'Mei Lin', checklist: 'Tone of voice; Imagery and alt text', 'due-days': '2',
      },
      {
        type: 'Copy', assignee: 'Sam Carter', checklist: 'Spelling and grammar; Headings and link text', 'due-days': '1',
      },
    ],
  },
};

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function fixture(name) {
  const resp = await fetch(new URL(`spring-savings.${name}.plain.html`, DEMO));
  return resp.ok ? resp.text() : '';
}

function startDemo() {
  return {
    mode: 'demo',
    page: pageInfo({ org: 'northwind', site: 'website', path: '/offers/spring-savings' }),
    config: parseConfig(DEMO_CONFIG),
    api: createDemoApi({ fixture, storage: storage() }),
    user: DEMO_AUTHOR,
    sdk: null,
    async versions() {
      return this.api.versions(this.page);
    },
    publish() {
      return new Promise((resolve) => {
        setTimeout(() => resolve({ ok: true, url: this.page.liveUrl, demo: true }), 1200);
      });
    },
  };
}

function startLive(sdk) {
  let { token } = sdk;
  window.addEventListener('message', (e) => {
    if (e.source === window.parent && e.data?.token) token = e.data.token;
  });
  const auth = (url, opts = {}) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  });
  const { context } = sdk;
  const page = pageInfo({
    org: context.org,
    site: context.repo || context.site,
    path: context.path || '/',
    branch: context.branch || 'main',
  });
  const session = {
    mode: 'live',
    page,
    sdk,
    auth,
    user: '',
    config: null,
    api: null,
    previewError: '',
    /**
     * Fetches preview and live through the worker. Dialogs first update the preview so
     * the comparison includes unsaved-to-preview edits; the panel reads the last preview.
     */
    async versions({ refresh = true } = {}) {
      if (refresh) {
        const preview = await refreshPreview(auth, () => token, page);
        session.previewError = preview.ok ? '' : preview.error;
      }
      return session.api.versions(page);
    },
  };
  session.publish = () => publishPage(auth, () => token, page);
  return loadConfig(auth, page).then((config) => {
    session.config = withQuery(config, window.location.search);
    session.api = createApi({ workerUrl: session.config.workerUrl, getToken: () => token });
    return session;
  });
}

export async function startSession() {
  const params = new URLSearchParams(window.location.search);
  const embedded = window.parent !== window && !params.has('demo');
  const sdk = embedded
    ? await Promise.race([
      DA_SDK,
      new Promise((resolve) => { setTimeout(() => resolve(null), SDK_TIMEOUT); }),
    ])
    : null;
  return sdk?.context?.org ? startLive(sdk) : startDemo();
}

export function closeDialog(session) {
  try {
    session.sdk?.actions?.closeLibrary?.();
  } catch {
    // Older hosts: the author closes the dialog with its own X.
  }
}
