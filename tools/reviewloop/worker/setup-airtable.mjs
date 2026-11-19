#!/usr/bin/env node
/**
 * Creates the ReviewLoop "Reviews" table in an Airtable base, or adds the columns it is
 * missing. Safe to run again. Needs Node 18+ and a personal access token with the
 * data.records:read/write, data.recordComments:read/write and schema.bases:read/write
 * scopes, with access to the base.
 *
 *   AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node setup-airtable.mjs
 *
 * Optional: AIRTABLE_TABLE (default "Reviews") and AIRTABLE_STATUS_REVIEW, _CHANGES,
 * _APPROVED, _DONE if you want other status names (set the same ones on the worker).
 */

const API = 'https://api.airtable.com/v0';
const { AIRTABLE_TOKEN: token, AIRTABLE_BASE_ID: base } = process.env;
const tableName = process.env.AIRTABLE_TABLE || 'Reviews';

const status = (state, name) => process.env[`AIRTABLE_STATUS_${state}`] || name;
const STATUSES = [
  { name: status('REVIEW', 'In review'), color: 'blueLight2' },
  { name: status('CHANGES', 'Changes requested'), color: 'orangeLight2' },
  { name: status('APPROVED', 'Approved'), color: 'greenLight2' },
  { name: status('DONE', 'Done'), color: 'grayLight2' },
];

// The first field is the table's primary field.
const FIELDS = [
  { name: 'Review', type: 'singleLineText', description: 'What to review, set by ReviewLoop.' },
  {
    name: 'Status',
    type: 'singleSelect',
    description: 'Change this to approve or ask for changes. ReviewLoop reads it.',
    options: { choices: STATUSES },
  },
  { name: 'Review type', type: 'singleLineText' },
  { name: 'Reviewer', type: 'singleLineText' },
  { name: 'Due', type: 'date', options: { dateFormat: { name: 'iso' } } },
  { name: 'Page', type: 'singleLineText', description: 'org/site/path' },
  { name: 'Page key', type: 'singleLineText', description: 'Ties the record to one page. Do not edit.' },
  { name: 'Preview', type: 'url' },
  { name: 'Edit in EW', type: 'url' },
  { name: 'Live page', type: 'url' },
  { name: 'Description', type: 'richText', description: 'The changes since live, with before and after.' },
  {
    name: 'ReviewLoop data',
    type: 'multilineText',
    description: 'Round and reviewed snapshot, as JSON. Do not edit; hide it in your views.',
  },
];

async function call(method, path, body) {
  const resp = await fetch(`${API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const error = data.error?.message || data.error?.type || data.error || resp.statusText;
    throw new Error(`Airtable answered ${resp.status} for ${method} ${path}: ${error}`);
  }
  return data;
}

async function main() {
  if (!token || !/^app[a-zA-Z0-9]{14}$/.test(base || '')) {
    console.error('Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID (the app… id in the base URL).');
    process.exit(1);
  }
  const { tables } = await call('GET', `meta/bases/${base}/tables`);
  let table = tables.find((t) => t.name.toLowerCase() === tableName.toLowerCase());
  if (!table) {
    table = await call('POST', `meta/bases/${base}/tables`, {
      name: tableName,
      description: 'Page reviews sent from Experience Workspace by ReviewLoop.',
      fields: FIELDS,
    });
    console.log(`Created the “${tableName}” table.`);
  } else {
    const have = new Set(table.fields.map((f) => f.name));
    const missing = FIELDS.filter((f) => !have.has(f.name));
    for (const field of missing) {
      // eslint-disable-next-line no-await-in-loop
      await call('POST', `meta/bases/${base}/tables/${table.id}/fields`, field);
      console.log(`Added the “${field.name}” column.`);
    }
    if (!missing.length) console.log(`The “${tableName}” table already has every column.`);
    const select = table.fields.find((f) => f.name === 'Status');
    const choices = new Set((select?.options?.choices || []).map((c) => c.name.toLowerCase()));
    const absent = select ? STATUSES.filter((s) => !choices.has(s.name.toLowerCase())) : [];
    if (absent.length) {
      console.log(`Add these Status options in Airtable: ${absent.map((s) => s.name).join(', ')}.`);
    }
  }
  console.log(`
Table id: ${table.id}
Open it:  https://airtable.com/${base}/${table.id}

Optional, so the panel can say who approved and when (Airtable's API cannot create these):
  1. Add a "Last modified time" field named "Status changed", watching only Status.
  2. Add a "Last modified by" field named "Status changed by", watching only Status.
Tip: add a Kanban view grouped by Status, so reviewers drag cards to approve.

Then on the worker (from tools/reviewloop/worker):
  npx wrangler secret put AIRTABLE_TOKEN
  and set AIRTABLE_BASE_ID = "${base}" in wrangler.toml [vars].`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
