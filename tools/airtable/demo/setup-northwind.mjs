/**
 * Creates the Northwind Bank demo tables in an Airtable base, with sample records:
 * Savings rates, Accounts, FAQs and Branches. Tables that already exist are left alone.
 *
 *   AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node tools/airtable/demo/setup-northwind.mjs
 *
 * The token needs schema.bases:read, schema.bases:write and data.records:write on the base.
 */

const API = 'https://api.airtable.com/v0';
const SITE = process.env.DEMO_SITE || 'https://main--ew-shareready--vipult2022.aem.page';
const { AIRTABLE_TOKEN: token, AIRTABLE_BASE_ID: base } = process.env;

const text = (name) => ({ name, type: 'singleLineText' });
const long = (name) => ({ name, type: 'multilineText' });
const select = (name, choices) => ({ name, type: 'singleSelect', options: { choices: choices.map((c) => ({ name: c })) } });
const date = (name) => ({ name, type: 'date', options: { dateFormat: { name: 'friendly' } } });

const TABLES = [
  {
    name: 'Savings rates',
    description: 'Rates shown on the site. Change a rate here, then insert or update the table on the page.',
    fields: [
      text('Product'),
      { name: 'APY', type: 'percent', options: { precision: 2 } },
      { name: 'Minimum deposit', type: 'currency', options: { precision: 0, symbol: '$' } },
      select('Term', ['No term', '9 months', '12 months', '18 months']),
      date('Rate updated'),
    ],
    records: [
      ['High-Yield Savings', 0.045, 100, '12 months', '2026-11-02'],
      ['Everyday Savings', 0.005, 0, 'No term', '2026-10-01'],
      ['Summer CD Special', 0.05, 1000, '9 months', '2026-06-01'],
      ['18-month CD', 0.0425, 1000, '18 months', '2026-11-02'],
      ['Kids Savings', 0.02, 0, 'No term', '2026-09-15'],
    ].map(([a, b, c, d, e]) => ({
      Product: a, APY: b, 'Minimum deposit': c, Term: d, 'Rate updated': e,
    })),
  },
  {
    name: 'Accounts',
    description: 'Account and offer cards: one record per product, with a photo and a link.',
    fields: [
      text('Account'),
      { name: 'Photo', type: 'multipleAttachments' },
      long('Summary'),
      { name: 'Monthly fee', type: 'currency', options: { precision: 0, symbol: '$' } },
      { name: 'Page', type: 'url' },
    ],
    records: [
      ['Everyday Checking', 'accounts/media_1b8102f4c47387bb96af04c4012873a2566cd49da.jpg', 'Direct deposit in minutes, card freeze from the app and alerts before you overdraw.', 0, 'accounts/everyday-checking'],
      ['Spring Savings Event', 'offers/media_14369143bad3c474e0ed37010b0dccabc9ce50fcf.jpg', '4.50% APY for 12 months on balances up to $250,000.', 0, 'offers/spring-savings'],
      ['Summer CD Special', 'offers/media_1defbd87e89df4fe450e5ac7c8976218033e0f79e.jpg', 'Lock in a guaranteed 5.00% APY for 9 months.', 0, 'offers/summer-savings'],
      ['Winter Savings Event', 'offers/media_11363c40d3c2ea9905d328e72fe3dfcd415a164f0.jpg', 'Save for the new year with a bonus rate on new deposits.', 0, 'offers/winter-savings'],
    ].map(([a, photo, summary, fee, page]) => ({
      Account: a,
      Photo: [{ url: `${SITE}/${photo}?width=750&format=jpg&optimize=medium`, filename: `${page.split('/').pop()}.jpg` }],
      Summary: summary,
      'Monthly fee': fee,
      Page: `${SITE}/${page}`,
    })),
  },
  {
    name: 'FAQs',
    description: 'Questions and answers. Answers use rich text: bold, links and lists carry over.',
    fields: [
      text('Question'),
      { name: 'Answer', type: 'richText' },
      select('Topic', ['Savings', 'Checking', 'Cards', 'Online banking']),
      { name: 'Order', type: 'number', options: { precision: 0 } },
    ],
    records: [
      ['How is APY calculated?', 'APY is the yearly rate **including compound interest**. Interest is calculated daily and paid monthly.', 'Savings', 1],
      ['Is there a minimum balance?', 'No minimum balance for Everyday Savings. High-Yield Savings needs **$100** to open.', 'Savings', 2],
      ['Can I lose my rate?', 'Promotional rates are fixed for the term shown. After that the [standard rate](https://www.example.com/rates) applies.', 'Savings', 3],
      ['How do I freeze my card?', 'In the Northwind app:\n\n1. Tap **Cards**\n2. Choose the card\n3. Turn on **Freeze**', 'Cards', 4],
      ['Are my deposits insured?', 'Yes. Deposits are insured up to the legal limit per depositor.', 'Checking', 5],
    ].map(([q, a, t, o]) => ({
      Question: q, Answer: a, Topic: t, Order: o,
    })),
  },
  {
    name: 'Branches',
    description: 'Branch details for location pages.',
    fields: [
      text('Branch'),
      long('Address'),
      { name: 'Phone', type: 'phoneNumber' },
      long('Opening hours'),
      { name: 'Services', type: 'multipleSelects', options: { choices: ['Mortgages', 'Business banking', 'Safe deposit boxes', 'Drive-through'].map((c) => ({ name: c })) } },
    ],
    records: [
      ['Harbor Street', '12 Harbor Street\nPortland, OR 97201', '(503) 555-0142', 'Mon to Fri 9:00 to 17:00\nSat 9:00 to 13:00', ['Mortgages', 'Safe deposit boxes']],
      ['Maple Avenue', '480 Maple Avenue\nSeattle, WA 98109', '(206) 555-0187', 'Mon to Fri 9:00 to 18:00', ['Business banking', 'Drive-through']],
      ['Union Square', '75 Union Square\nSan Francisco, CA 94108', '(415) 555-0123', 'Mon to Sat 9:00 to 17:00', ['Mortgages', 'Business banking']],
    ].map(([b, a, p, h, s]) => ({
      Branch: b, Address: a, Phone: p, 'Opening hours': h, Services: s,
    })),
  },
];

async function call(path, method = 'GET', body = undefined) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`${method} ${path}: ${resp.status} ${JSON.stringify(data.error || data)}`);
  return data;
}

async function main() {
  if (!token || !/^app[a-zA-Z0-9]{14}$/.test(base || '')) {
    console.error('Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID (the app… id from the base URL).');
    process.exit(1);
  }
  const { tables } = await call(`/meta/bases/${base}/tables`);
  for (const table of TABLES) {
    if (tables.some((t) => t.name === table.name)) {
      console.log(`= ${table.name} already exists, left as is`);
    } else {
      // eslint-disable-next-line no-await-in-loop
      const made = await call(`/meta/bases/${base}/tables`, 'POST', {
        name: table.name, description: table.description, fields: table.fields,
      });
      // eslint-disable-next-line no-await-in-loop
      await call(`/${base}/${made.id}`, 'POST', {
        records: table.records.map((fields) => ({ fields })), typecast: true,
      });
      console.log(`+ ${table.name} (${made.id}) with ${table.records.length} records`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
