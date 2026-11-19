/**
 * Creates the Northwind Bank demo in Notion: a "Northwind content briefs" database with three
 * brief pages (headings, lists, a checklist, columns, a table, toggles, a callout and images).
 * Runs once; if the database already exists it stops.
 *
 *   NOTION_TOKEN=ntn_... node tools/notion/demo/setup-northwind.mjs
 *
 * The integration needs Read, Update and Insert content, and must be connected to a page
 * called "Northwind content" (or set NOTION_PAGE to the page id). The hero image is uploaded
 * to Notion, so Notion serves it from an expiring file link, as it does for author uploads.
 */

const API = 'https://api.notion.com/v1';
const SITE = process.env.DEMO_SITE || 'https://main--ew-shareready--vipult2022.aem.page';
const { NOTION_TOKEN: token } = process.env;
const DB_TITLE = 'Northwind content briefs';

async function call(path, { method = 'GET', body } = {}) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`${method} ${path}: ${resp.status} ${data.message}`);
  return data;
}

/* Rich text: "plain **bold** _italic_ [link](url) `code`" */
function rt(text) {
  const out = [];
  const pattern = /\*\*(.+?)\*\*|_(.+?)_|\[(.+?)\]\((.+?)\)|`(.+?)`/g;
  let last = 0;
  let m = pattern.exec(text);
  const plain = (content, annotations = {}, link = null) => out.push({
    type: 'text', text: { content, link: link ? { url: link } : null }, annotations,
  });
  while (m) {
    if (m.index > last) plain(text.slice(last, m.index));
    if (m[1]) plain(m[1], { bold: true });
    else if (m[2]) plain(m[2], { italic: true });
    else if (m[3]) plain(m[3], {}, m[4]);
    else plain(m[5], { code: true });
    last = m.index + m[0].length;
    m = pattern.exec(text);
  }
  if (last < text.length) plain(text.slice(last));
  return out;
}

const block = (type, text, extra = {}, children = undefined) => ({
  type,
  [type]: { rich_text: rt(text), ...extra, ...(children ? { children } : {}) },
});
const p = (text) => block('paragraph', text);
const h1 = (text) => block('heading_1', text);
const h3 = (text) => block('heading_3', text);
const li = (text, children) => block('bulleted_list_item', text, {}, children);
const ol = (text) => block('numbered_list_item', text);
const todo = (text, checked = false) => block('to_do', text, { checked });
const toggle = (text, children) => block('toggle', text, {}, children);
const quote = (text) => block('quote', text);
const callout = (emoji, text) => block('callout', text, { icon: { type: 'emoji', emoji } });
const divider = () => ({ type: 'divider', divider: {} });
const image = (source, caption) => ({ type: 'image', image: { ...source, caption: rt(caption) } });
const external = (path) => ({
  type: 'external',
  external: { url: `${SITE}/${path}?width=1200&format=jpg&optimize=medium` },
});
const table = (rows) => ({
  type: 'table',
  table: {
    table_width: rows[0].length,
    has_column_header: true,
    has_row_header: false,
    children: rows.map((cells) => ({ type: 'table_row', table_row: { cells: cells.map(rt) } })),
  },
});
const columns = (...cols) => ({
  type: 'column_list',
  column_list: { children: cols.map((children) => ({ type: 'column', column: { children } })) },
});

async function upload(path, filename) {
  const img = await fetch(`${SITE}/${path}?width=1200&format=jpg&optimize=medium`);
  if (!img.ok) throw new Error(`Could not download ${path}: ${img.status}`);
  const bytes = await img.blob();
  const created = await call('/file_uploads', {
    method: 'POST', body: { filename, content_type: 'image/jpeg' },
  });
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), filename);
  const sent = await fetch(`${API}/file_uploads/${created.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
    body: form,
  });
  if (!sent.ok) throw new Error(`Upload failed: ${sent.status} ${await sent.text()}`);
  return { type: 'file_upload', file_upload: { id: created.id } };
}

async function parentPage() {
  if (process.env.NOTION_PAGE) return process.env.NOTION_PAGE;
  const { results } = await call('/search', {
    method: 'POST',
    body: { query: 'Northwind content', filter: { property: 'object', value: 'page' } },
  });
  const page = results.find((r) => r.properties && Object.values(r.properties)
    .some((prop) => prop.type === 'title' && prop.title.map((t) => t.plain_text).join('') === 'Northwind content'));
  if (!page) throw new Error('Connect the integration to a page called "Northwind content" first.');
  return page.id;
}

const sel = (names, colors = []) => ({
  options: names.map((name, i) => (colors[i] ? { name, color: colors[i] } : { name })),
});

const PAGES = (hero) => [
  {
    icon: '🌱',
    props: {
      Name: 'Spring Savings Event 2027',
      Status: 'Ready for EW',
      Owner: 'Priya Shah, Savings marketing',
      Description: 'Earn 4.50% APY for 12 months on new deposits. No monthly fees. Join online or in a branch by 31 March 2027.',
      Keywords: ['savings', 'promotion'],
      'Page path': '/offers/spring-savings-2027',
      Due: '2027-02-15',
    },
    children: [
      p('Our biggest savings promotion of the year returns on **1 March 2027**. Earn a bonus rate on new deposits and keep it for a full 12 months.'),
      image(hero, 'A family planning their savings at the kitchen table'),
      h1('Why save with Northwind'),
      li('**4.50% APY** for 12 months on balances up to $250,000'),
      li('No monthly fees, and no minimum balance once your account is open'),
      li('Deposits insured up to the legal limit per depositor'),
      h1('How to join'),
      ol('Open a High-Yield Savings account online or in any branch'),
      ol('Deposit at least **$100 of new money** by 31 March 2027'),
      ol('Your bonus rate starts the next business day'),
      callout('💡', 'Already a customer? Existing savings accounts can join too. Just add new money.'),
      h1('Compare rates'),
      table([
        ['Account', 'APY', 'Minimum deposit'],
        ['High-Yield Savings', '4.50%', '$100'],
        ['12-month CD', '4.25%', '$1,000'],
        ['Everyday Savings', '0.50%', '$0'],
      ]),
      quote('“I moved my emergency fund in ten minutes, all from the app.” Dana, Northwind customer since 2019'),
      divider(),
      h1('Questions'),
      toggle('Who can join?', [p('Anyone aged 18 or over with a US address. You can open up to two savings accounts during the event.')]),
      toggle('When does the bonus rate end?', [p('Twelve months after it starts. After that the standard High-Yield Savings rate applies, and we email you a month before.')]),
      toggle('Can I take money out?', [
        p('Yes, at any time and without a penalty. Keep in mind:'),
        li('Withdrawals do not count as new money if you deposit them again'),
        li('The bonus rate applies to balances up to $250,000'),
      ]),
      p('Read the [full terms](https://www.example.com/terms) before you apply.'),
    ],
  },
  {
    icon: '🏡',
    props: {
      Name: 'First-time home buyer guide',
      Status: 'Drafting',
      Owner: 'Marcus Lee, Mortgages',
      Description: 'A step-by-step guide to buying your first home: what to do before you apply, fixed or variable rates, and the costs to plan for.',
      Keywords: ['mortgage', 'first home'],
      'Page path': '/guides/first-home',
      Due: '2027-01-20',
    },
    children: [
      p('Buying your first home is exciting, and a little daunting. This guide walks you through it, one step at a time.'),
      image(external('offers/media_1defbd87e89df4fe450e5ac7c8976218033e0f79e.jpg'), 'Keys to a new front door'),
      h1('Before you apply'),
      todo('Check your credit report for mistakes', true),
      todo('Save a deposit of at least 5%, or 10% for better rates'),
      todo('Get a decision in principle, so you know what you can borrow'),
      h1('Fixed or variable?'),
      columns(
        [h3('Fixed rate'), p('Your payment stays the same for 2, 5 or 10 years. **Best if** you want certainty.')],
        [h3('Variable rate'), p('Your payment moves with our base rate. **Best if** you can handle changes and want flexibility.')],
      ),
      h1('Costs to plan for'),
      li('Deposit'),
      li('Fees', [li('Valuation fee'), li('Legal fees'), li('Arrangement fee, often added to the loan')]),
      li('Moving and furniture'),
      h1('Questions'),
      toggle('How much can I borrow?', [p('Usually up to 4.5 times your yearly income. Use our [mortgage calculator](https://www.example.com/calculator) for an estimate.')]),
      toggle('How long does it take?', [p('Most applications get a decision within 5 working days.')]),
    ],
  },
  {
    icon: '❄️',
    props: {
      Name: 'How to freeze your card',
      Status: 'Idea',
      Owner: 'Help center team',
      Description: 'Lost your card? Freeze it in seconds from the Northwind app, then unfreeze it when you find it.',
      Keywords: ['cards', 'security', 'help'],
      'Page path': '/help/freeze-card',
    },
    children: [
      p('If you misplace your card, freeze it straight away. Nobody can use it while it is frozen, and you can unfreeze it at any time.'),
      h1('Freeze your card in the app'),
      ol('Open the Northwind app and tap **Cards**'),
      ol('Choose the card'),
      ol('Turn on **Freeze card**'),
      callout('⚠️', 'If you think your card was stolen, call us on 1-800-555-0100 instead. We will cancel it and send a new one.'),
    ],
  },
];

async function main() {
  if (!token) throw new Error('Set NOTION_TOKEN.');
  const found = await call('/search', {
    method: 'POST', body: { query: DB_TITLE, filter: { property: 'object', value: 'database' } },
  });
  const existing = found.results.find((d) => d.title?.map((t) => t.plain_text).join('') === DB_TITLE);
  if (existing) {
    console.log(`"${DB_TITLE}" already exists: ${existing.url}`);
    return;
  }
  const parent = await parentPage();
  const db = await call('/databases', {
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: parent },
      icon: { type: 'emoji', emoji: '📝' },
      title: rt(DB_TITLE),
      description: rt('Briefs and drafts for the Northwind Bank site. When a brief is ready, build the page from it in Experience Workspace with the Notion panel.'),
      properties: {
        Name: { title: {} },
        Status: { select: sel(['Idea', 'Drafting', 'Ready for EW', 'Published'], ['gray', 'yellow', 'blue', 'green']) },
        Owner: { rich_text: {} },
        Description: { rich_text: {} },
        Keywords: { multi_select: sel(['savings', 'promotion', 'mortgage', 'first home', 'cards', 'security', 'help']) },
        'Page path': { rich_text: {} },
        Due: { date: {} },
        'EW page': { url: {} },
      },
    },
  });
  console.log(`Created database ${db.url}`);

  const hero = await upload('offers/media_14369143bad3c474e0ed37010b0dccabc9ce50fcf.jpg', 'spring-savings-hero.jpg');
  const pages = PAGES(hero);
  for (let i = 0; i < pages.length; i += 1) {
    const { icon, props, children } = pages[i];
    const properties = {
      Name: { title: rt(props.Name) },
      Status: { select: { name: props.Status } },
      Owner: { rich_text: rt(props.Owner) },
      Description: { rich_text: rt(props.Description) },
      Keywords: { multi_select: props.Keywords.map((name) => ({ name })) },
      'Page path': { rich_text: rt(props['Page path']) },
      ...(props.Due ? { Due: { date: { start: props.Due } } } : {}),
    };
    // eslint-disable-next-line no-await-in-loop
    const page = await call('/pages', {
      method: 'POST',
      body: {
        parent: { database_id: db.id }, icon: { type: 'emoji', emoji: icon }, properties, children,
      },
    });
    console.log(`Created ${props.Name}: ${page.url}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
