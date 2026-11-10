import { h, clear } from './lib/dom.js';
import { PLATFORMS } from './lib/platforms.js';
import { SEVERITY, platformIssues } from './lib/checks.js';
import { renderPreview } from './lib/previews.js';
import {
  plural, verdict, worst, ring, fitFrames as fitStages,
} from './lib/ui.js';

const DOCS_URL = 'https://github.com/vipult2022/ew-shareready#readme';

const SOURCE_LABEL = {
  metadata: 'Metadata block',
  bulk: 'Bulk metadata',
  h1: 'First H1',
  heading: 'First heading',
  paragraph: 'First paragraph',
  content: 'First image',
  default: 'Site default',
  empty: 'Empty row',
  none: 'Missing',
};

const GROUP_LABEL = {
  error: 'Fix before sharing',
  warning: 'Should fix',
  info: 'Tips',
  pass: 'Looks good',
};

const GUIDES = {
  'insert-in-block': 'Your cursor is inside a block. Click an empty line at the end of the page, then press Insert again.',
  'insert-selection': 'Text is selected in the page and would be replaced. Click once at the end of the page, then press Insert again.',
  'select-metadata': 'Double-click any word inside the page’s Metadata table, then press Update again.',
  'read-only': 'You can’t edit this page, so ShareReady can’t change it.',
  'replace-failed': 'The editor could not update the table. Copy the new table and paste it over the old one.',
  copy: 'This editor can’t update a table from a panel. Copy the new table and paste it over the old one.',
};

const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 10h-8a7 7 0 0 0-7 7v2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

const FIELD_PASS = {
  title: 'title-fits',
  description: 'description-fits',
  image: 'image-good',
  'image-alt': 'image-alt-ok',
};

function fileName(src) {
  return String(src || '').split(/[?#]/)[0].split('/').pop();
}

function imageFit(info) {
  if (!info?.ok) return { label: 'Not loaded', tone: 'error' };
  const ratio = info.width / info.height;
  const crop = Math.round((1 - Math.min(ratio / 1.91, 1.91 / ratio)) * 100);
  if (info.width < 600) return { label: 'Too small', tone: 'error' };
  if (crop > 10) return { label: `Crops ${crop}%`, tone: 'warning' };
  if (info.width < 1200) return { label: 'A bit small', tone: 'warning' };
  return { label: 'Fits cards', tone: 'pass' };
}

export default function createPanel(root, state, actions, { demoPages = {} } = {}) {
  const ui = {
    tab: 'previews',
    platform: 'all',
    busy: false,
    form: null,
    formFor: null,
    fields: {},
    bodyTimer: null,
    toastTimer: null,
  };
  const els = {
    head: h('header', { class: 'sr-head' }),
    demo: h('div', { class: 'sr-demo-slot' }),
    summary: h('section', { class: 'sr-summary', 'aria-live': 'polite' }),
    review: h('div', { class: 'sr-review-slot' }),
    tabs: h('nav', { class: 'sr-tabs', role: 'tablist', 'aria-label': 'ShareReady views' }),
    body: h('section', { class: 'sr-body' }),
    foot: h('footer', { class: 'sr-foot' }),
    toast: h('div', { class: 'sr-toast', role: 'status', 'aria-live': 'polite' }),
  };
  clear(root).append(...Object.values(els));

  function shown() {
    if (state.review?.out && state.review.compare === 'after') {
      return { page: state.review.out.page, result: state.review.out.result };
    }
    return { page: state.page, result: state.result };
  }

  function navigate(tab, platform) {
    ui.tab = tab;
    if (platform) ui.platform = platform;
    // eslint-disable-next-line no-use-before-define
    renderTabs();
    // eslint-disable-next-line no-use-before-define
    renderBody();
  }

  /* Header */

  function renderHead() {
    const path = state.page?.path || state.context?.path || '';
    const modes = {
      demo: ['Demo', 'Sample pages for a fictional bank'],
      ew: ['Live', 'Updates as you edit. Metadata table edits show once Experience Workspace saves them, a few seconds later.'],
      da: ['Draft', 'Reads the saved draft. Press ↻ after editing.'],
    };
    const [label, tip] = modes[state.mode] || [];
    const logo = h('span', { class: 'sr-logo' });
    logo.innerHTML = LOGO;
    clear(els.head).append(
      h('div', { class: 'sr-brand' }, logo, h('div', {}, h('h1', {}, 'ShareReady'), h('p', { class: 'sr-path', title: path }, path))),
      h(
        'div',
        { class: 'sr-head-actions' },
        label ? h('span', { class: `sr-pill sr-pill-${state.mode}`, title: tip }, label) : null,
        h('button', {
          type: 'button',
          class: `sr-icon-btn${ui.busy ? ' sr-spin' : ''}`,
          title: 'Check again',
          'aria-label': 'Check again',
          onclick: actions.refresh,
        }, '↻'),
      ),
    );
  }

  function renderDemo() {
    clear(els.demo);
    if (state.mode !== 'demo') return;
    const select = h(
      'select',
      { 'aria-label': 'Sample page', onchange: (e) => actions.loadDemo(e.target.value) },
      Object.entries(demoPages).map(([id, p]) => h('option', { value: id, selected: id === state.demo }, p.label)),
    );
    els.demo.append(h(
      'div',
      { class: 'sr-demo' },
      h('p', {}, state.demoFallback
        ? 'Demo mode. Open ShareReady from Extensions in Experience Workspace to check your own page.'
        : 'Demo with a fictional bank. Try the Fix on the Spring Savings page.'),
      select,
    ));
  }

  /* Summary */

  function renderSummary() {
    clear(els.summary);
    if (!state.result) return;
    const after = state.review?.out?.result;
    const current = after || state.result;
    const v = verdict(current);
    const counts = [
      current.counts.error && plural(current.counts.error, 'error'),
      current.counts.warning && plural(current.counts.warning, 'warning'),
      current.counts.info && plural(current.counts.info, 'tip'),
    ].filter(Boolean).join(' · ') || 'No issues found';
    const text = h(
      'div',
      { class: 'sr-verdict' },
      h('h2', {}, after ? `After the fix: ${v.label.toLowerCase()}` : v.label),
      h('p', {}, after ? `Score ${state.result.score} → ${after.score} · ${counts}` : counts),
    );
    els.summary.append(ring(current.score, v.tone), text);
    if (state.review) return;
    const fixable = state.proposal?.fields.filter((f) => f.changed).length || 0;
    const buttons = h('div', { class: 'sr-actions' });
    if (fixable) {
      buttons.append(h('button', { type: 'button', class: 'sr-btn sr-primary', onclick: actions.startReview }, `Fix ${plural(fixable, 'field')}`));
    } else {
      buttons.append(h('button', { type: 'button', class: 'sr-btn', onclick: actions.startReview }, 'Edit metadata'));
    }
    buttons.append(h('button', {
      type: 'button',
      class: 'sr-btn sr-ai',
      title: 'Ask the Experience Workspace assistant to rewrite the metadata and draft share copy',
      onclick: actions.askAi,
    }, '✨ Fix with AI'));
    els.summary.append(buttons);
  }

  /* Review form */

  function hint() {
    if (state.mode === 'demo') return 'Demo: the change applies to the sample page only.';
    if (!state.page.hasMetadataBlock) return 'It goes in at your cursor. Tip: click an empty line at the end of the page first.';
    if (state.mode === 'ew') return 'First double-click any word in the page’s Metadata table, so ShareReady knows which table to update.';
    return 'ShareReady copies the new table for you to paste over the old one.';
  }

  function textField(name, label, multiline) {
    const control = h(multiline ? 'textarea' : 'input', {
      id: `sr-f-${name}`,
      type: multiline ? null : 'text',
      rows: multiline ? '4' : null,
      spellcheck: 'true',
      oninput: (e) => actions.updateDraft(name, e.target.value),
    });
    control.value = state.review.draft[name] || '';
    const meter = h('span', { class: 'sr-meter' });
    const status = h('p', { class: 'sr-field-status' });
    const was = h('p', { class: 'sr-was' });
    ui.fields[name] = {
      control, meter, status, was,
    };
    return h(
      'div',
      { class: 'sr-field' },
      h('div', { class: 'sr-field-label' }, h('label', { for: control.id }, label), meter),
      control,
      status,
      was,
    );
  }

  function imageCandidates() {
    const list = [];
    const add = (src, url, alt) => {
      if (url && src && !list.some((c) => c.url === url)) list.push({ src, url, alt: alt || '' });
    };
    if (state.page.image.source !== 'default') {
      add(state.page.image.src, state.page.og.image, state.page.imageAlt.value);
    }
    state.page.images.forEach((img) => add(img.src, img.url, img.alt));
    return list;
  }

  function imageField() {
    const picker = h('div', { class: 'sr-picker', role: 'radiogroup', 'aria-label': 'Share image' });
    const candidates = imageCandidates();
    const select = (candidate) => {
      if (!state.review.altTouched) {
        state.review.draft['image-alt'] = candidate.alt;
        if (ui.fields['image-alt']) ui.fields['image-alt'].control.value = candidate.alt;
      }
      [...picker.children].forEach((btn) => {
        btn.setAttribute('aria-checked', String(btn.dataset.src === candidate.src));
      });
      actions.updateDraft('image', candidate.src);
    };
    candidates.forEach((c) => {
      const info = state.images.get(c.url);
      const fit = imageFit(info);
      picker.append(h(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: 'sr-pick',
          'aria-checked': String(c.src === state.review.draft.image),
          title: fileName(c.src),
          dataset: { src: c.src },
          onclick: () => select(c),
        },
        h('img', { src: info?.display || c.url, alt: '' }),
        h('span', { class: 'sr-pick-size' }, info?.ok ? `${info.width}×${info.height}` : '–'),
        h('span', { class: `sr-pick-fit sr-fit-${fit.tone}` }, fit.label),
      ));
    });
    const status = h('p', { class: 'sr-field-status' });
    const was = h('p', { class: 'sr-was' });
    ui.fields.image = {
      meter: null, status, was, control: null,
    };
    return h(
      'div',
      { class: 'sr-field' },
      h('div', { class: 'sr-field-label' }, h('span', {}, 'Image')),
      candidates.length ? picker : h('p', { class: 'sr-empty-note' }, 'This page has no images. Add a 1200×630 image to the page first.'),
      status,
      was,
    );
  }

  function buildForm() {
    ui.fields = {};
    const applyLabel = state.page.hasMetadataBlock ? 'Update Metadata block' : 'Insert Metadata block';
    const form = h(
      'form',
      {
        class: 'sr-review',
        onsubmit: (e) => {
          e.preventDefault();
          actions.applyFix();
        },
      },
      h(
        'div',
        { class: 'sr-review-head' },
        h('h3', {}, state.page.hasMetadataBlock ? 'Update the Metadata block' : 'Add a Metadata block'),
        h('p', {}, 'Suggested by ShareReady. Edit any value and watch the previews change.'),
      ),
      textField('title', 'Title', false),
      textField('description', 'Description', true),
      imageField(),
      textField('image-alt', 'Image Alt', false),
      h('div', { class: 'sr-guide-slot' }),
      h(
        'div',
        { class: 'sr-review-actions' },
        h('button', { type: 'submit', class: 'sr-btn sr-primary sr-apply' }, applyLabel),
        h('button', { type: 'button', class: 'sr-btn', onclick: actions.cancelReview }, 'Cancel'),
      ),
      h('p', { class: 'sr-hint' }),
    );
    return form;
  }

  function fieldIssue(result, name) {
    const issue = result.checks.find((c) => c.field === name && (c.severity === 'error' || c.severity === 'warning'));
    if (issue) return { tone: issue.severity, text: issue.title };
    const pass = result.checks.find((c) => c.id === FIELD_PASS[name]);
    return pass ? { tone: 'pass', text: pass.title } : null;
  }

  function renderFields() {
    const out = state.review?.out;
    if (!out || !ui.form) return;
    out.proposal.fields.forEach((f) => {
      const field = ui.fields[f.name];
      if (!field) return;
      const value = state.review.draft[f.name] || '';
      if (f.name === 'title') {
        const google = out.result.layouts.find((l) => l.platform.id === 'google');
        const px = Math.round(google?.title?.width || 0);
        field.meter.textContent = `${value.length} chars · ${px}/${google?.title?.max || 600}px`;
        field.meter.className = `sr-meter${px > (google?.title?.max || 600) ? ' sr-over' : ''}`;
      } else if (f.name === 'description') {
        field.meter.textContent = `${value.length}/155`;
        field.meter.className = `sr-meter${value.length > 155 || value.length < 70 ? ' sr-over' : ''}`;
      } else if (field.meter) {
        field.meter.textContent = `${value.length} chars`;
      }
      const issue = fieldIssue(out.result, f.name);
      field.status.textContent = issue ? issue.text : '';
      field.status.className = `sr-field-status${issue ? ` sr-tone-${issue.tone}` : ''}`;
      const before = f.name === 'image' ? fileName(f.before) : f.before;
      const after = f.name === 'image' ? fileName(value) : value.trim();
      field.was.textContent = f.before && before !== after
        ? `Was (${SOURCE_LABEL[f.source] || f.source}): ${before}` : (f.note || '');
    });
    const apply = ui.form.querySelector('.sr-apply');
    apply.disabled = !out.proposal.changed || !state.live.editable;
  }

  function renderGuide() {
    if (!ui.form) return;
    const slot = ui.form.querySelector('.sr-guide-slot');
    clear(slot);
    const guide = state.review?.guide;
    if (!guide) return;
    const text = GUIDES[guide.id] || guide.id;
    const showCopy = ['select-metadata', 'replace-failed', 'copy'].includes(guide.id);
    slot.append(h(
      'div',
      { class: 'sr-guide', role: 'alert' },
      h('p', {}, text, guide.extra ? ` (${guide.extra})` : ''),
      showCopy ? h('button', { type: 'button', class: 'sr-link', onclick: actions.copyTable }, 'Copy the table instead') : null,
    ));
  }

  function renderStatus() {
    if (!ui.form) return;
    ui.form.querySelector('.sr-hint').textContent = state.live.editable ? hint() : GUIDES['read-only'];
    renderFields();
  }

  function renderReview() {
    if (!state.review || !state.page) {
      ui.form = null;
      ui.formFor = null;
      clear(els.review);
      return;
    }
    if (ui.formFor !== state.review) {
      ui.form = buildForm();
      ui.formFor = state.review;
      clear(els.review).append(ui.form);
    }
    renderStatus();
    renderGuide();
  }

  /* Tabs and body */

  function renderTabs() {
    clear(els.tabs);
    const { result } = shown();
    if (!result) return;
    const issues = result.counts.error + result.counts.warning;
    [['previews', 'Previews'], ['checks', 'Checks'], ['metadata', 'Metadata']].forEach(([id, label]) => {
      els.tabs.append(h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: 'sr-tab',
          'aria-selected': String(ui.tab === id),
          onclick: () => navigate(id),
        },
        label,
        id === 'checks' && issues ? h('span', { class: `sr-count sr-tone-${worst(result.checks)}` }, String(issues)) : null,
      ));
    });
  }

  function previewOptions(page) {
    const opts = {
      src: (url) => state.images.get(url)?.display || url,
      brand: state.config.brand || page.og.siteName || page.host,
    };
    if (state.config['x-handle']) opts.handle = state.config['x-handle'].replace(/^@/, '');
    return opts;
  }

  function issueList(issues) {
    if (!issues.length) return h('p', { class: 'sr-ok' }, '✓ Looks right here');
    return h('ul', { class: 'sr-issues' }, issues.map((c) => h('li', { class: `sr-tone-${c.severity}` }, c.title)));
  }

  function compareToggle() {
    if (!state.review) return null;
    return h(
      'div',
      { class: 'sr-compare', role: 'group', 'aria-label': 'Compare' },
      ['before', 'after'].map((value) => h('button', {
        type: 'button',
        'aria-pressed': String(state.review.compare === value),
        onclick: () => actions.setCompare(value),
      }, value === 'before' ? 'Before' : 'After fix')),
    );
  }

  function platformChips(result) {
    const chips = h('div', { class: 'sr-chips', role: 'tablist', 'aria-label': 'Platform' });
    const options = [{ id: 'all', label: 'All' }, ...PLATFORMS];
    options.forEach((p) => {
      const tone = p.id === 'all' ? worst(result.checks) : worst(platformIssues(result.checks, p.id));
      chips.append(h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: 'sr-chip',
          'aria-selected': String(ui.platform === p.id),
          onclick: () => navigate('previews', p.id),
        },
        h('span', { class: `sr-dot sr-tone-${tone}`, 'aria-hidden': 'true' }),
        p.label,
      ));
    });
    return chips;
  }

  function fitFrames() {
    fitStages(els.body);
  }

  function renderPreviews(page, result) {
    const list = h('div', { class: 'sr-preview-list' });
    const ids = ui.platform === 'all' ? PLATFORMS.map((p) => p.id) : [ui.platform];
    ids.forEach((id) => {
      const layout = result.layouts.find((l) => l.platform.id === id);
      if (!layout) return;
      const issues = platformIssues(result.checks, id);
      const tone = worst(issues);
      list.append(h(
        'article',
        { class: `sr-card sr-card-${tone}` },
        h(
          'header',
          { class: 'sr-card-head' },
          h('span', { class: `sr-dot sr-tone-${tone}`, 'aria-hidden': 'true' }),
          h('h3', {}, layout.platform.label),
          h('span', { class: 'sr-card-note' }, issues.length ? plural(issues.length, 'issue') : 'OK'),
        ),
        h('div', { class: 'sr-stage' }, renderPreview(layout, page, {
          ...previewOptions(page),
          flagged: new Set(issues.map((c) => c.field)),
        })),
        issueList(issues),
      ));
    });
    return [compareToggle(), platformChips(result), list];
  }

  function renderChecks(result) {
    const groups = SEVERITY.map((severity) => {
      const items = result.checks.filter((c) => c.severity === severity);
      if (!items.length) return null;
      const list = h('ul', { class: 'sr-check-list' }, items.map((c) => h(
        'li',
        { class: `sr-check sr-tone-${severity}` },
        h('span', { class: 'sr-check-icon', 'aria-hidden': 'true' }),
        h(
          'div',
          {},
          h('strong', {}, c.title),
          c.detail ? h('p', {}, c.detail) : null,
          c.platforms?.length ? h('div', { class: 'sr-check-platforms' }, c.platforms.map((id) => h('button', {
            type: 'button',
            class: 'sr-tag',
            onclick: () => navigate('previews', id),
          }, PLATFORMS.find((p) => p.id === id)?.label || id))) : null,
          !state.review && c.fix === 'metadata' && severity !== 'pass'
            ? h('button', { type: 'button', class: 'sr-link', onclick: actions.startReview }, 'Fix it')
            : null,
          !state.review && c.fix === 'ai' && severity !== 'pass'
            ? h('button', { type: 'button', class: 'sr-link', onclick: actions.askAi }, 'Rewrite with AI')
            : null,
        ),
      )));
      const title = `${GROUP_LABEL[severity]} (${items.length})`;
      if (severity === 'pass') {
        return h('details', { class: 'sr-group' }, h('summary', {}, title), list);
      }
      return h('section', { class: 'sr-group' }, h('h3', {}, title), list);
    });
    return groups.filter(Boolean);
  }

  function metaValue(value, empty = 'Not set') {
    return value ? h('dd', {}, value) : h('dd', { class: 'sr-empty' }, empty);
  }

  function renderMetadata(page) {
    const info = state.images.get(page.og.image);
    const source = (s) => h('span', { class: `sr-source sr-source-${s}` }, SOURCE_LABEL[s] || s);
    const siteSource = page.metaConfig['og:site_name'] ? 'metadata' : 'none';
    const rows = [
      ['Title', source(page.title.source), metaValue(page.title.full)],
      ['Description', source(page.description.source), metaValue(page.description.value)],
      ['Image', source(page.image.source), h(
        'dd',
        { class: 'sr-meta-image' },
        h('img', { src: info?.display || page.og.image, alt: page.imageAlt.value || '' }),
        h('span', {}, `${fileName(page.image.src)}${info?.ok ? ` · ${info.width}×${info.height}` : ''}`),
      )],
      ['Image Alt', source(page.imageAlt.source || 'none'), metaValue(page.imageAlt.value)],
      ['Site name', source(siteSource), metaValue(page.og.siteName, 'Not set (og:site_name)')],
      ['Shared URL', null, metaValue(page.og.url)],
    ];
    return [
      h('p', { class: 'sr-note' }, 'What Edge Delivery Services will publish. Without a Metadata block it falls back to the first H1, first paragraph and first image.'),
      h('dl', { class: 'sr-meta' }, rows.map(([label, tag, dd]) => h('div', {}, h('dt', {}, label, tag), dd))),
      state.review ? null : h('button', { type: 'button', class: 'sr-btn', onclick: actions.startReview }, 'Edit these values'),
    ];
  }

  function renderError() {
    const { error } = state;
    const tips = {
      401: 'Your sign-in may have expired. Reload Experience Workspace and try again.',
      403: 'You don’t have access to read this page.',
      404: 'ShareReady can’t find a saved draft for this page yet. Type something, wait a moment and try again.',
    };
    return h(
      'div',
      { class: 'sr-state sr-state-error' },
      h('h3', {}, 'Couldn’t read this page'),
      h('p', {}, tips[error.status] || error.message || String(error)),
      h('button', { type: 'button', class: 'sr-btn', onclick: actions.refresh }, 'Try again'),
    );
  }

  function renderBody() {
    clearTimeout(ui.bodyTimer);
    clear(els.body);
    if (state.error) {
      els.body.append(renderError());
      return;
    }
    const { page, result } = shown();
    if (!result) {
      els.body.append(h('div', { class: 'sr-state' }, h('span', { class: 'sr-loader', 'aria-hidden': 'true' }), h('p', {}, 'Reading your page…')));
      return;
    }
    els.body.setAttribute('role', 'tabpanel');
    if (ui.tab === 'checks') els.body.append(...renderChecks(result));
    else if (ui.tab === 'metadata') els.body.append(...renderMetadata(page).filter(Boolean));
    else {
      els.body.append(...renderPreviews(page, result).filter(Boolean));
      requestAnimationFrame(fitFrames);
    }
  }

  function renderFoot() {
    clear(els.foot);
    const next = state.mode === 'demo'
      ? h('p', {}, 'In Experience Workspace: ', h('b', {}, 'Prepare › Publish & Share'), ' then refreshes Facebook, pings Bing and posts to Slack.')
      : h('p', {}, 'Next: ', h('b', {}, 'Prepare › Publish & Share'), ' refreshes Facebook, pings Bing and posts to Slack.');
    els.foot.append(next, h('a', { href: DOCS_URL, target: '_blank', rel: 'noopener' }, 'Help'));
  }

  const observer = new ResizeObserver(() => fitFrames());
  observer.observe(els.body);

  return {
    render() {
      renderHead();
      renderDemo();
      renderSummary();
      renderReview();
      renderTabs();
      renderBody();
      renderFoot();
    },
    renderResults() {
      renderSummary();
      renderFields();
      renderGuide();
      renderTabs();
      clearTimeout(ui.bodyTimer);
      ui.bodyTimer = setTimeout(renderBody, 120);
    },
    renderStatus,
    renderGuide,
    setBusy(busy) {
      ui.busy = busy;
      renderHead();
    },
    toast(message) {
      els.toast.textContent = message;
      els.toast.classList.add('sr-show');
      clearTimeout(ui.toastTimer);
      ui.toastTimer = setTimeout(() => els.toast.classList.remove('sr-show'), 4500);
    },
  };
}
