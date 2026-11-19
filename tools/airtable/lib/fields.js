/** Which fields go into the content, in what order, and record search. */

const SKIP = ['button', 'createdBy', 'lastModifiedBy', 'createdTime', 'lastModifiedTime', 'autoNumber', 'externalSyncSource'];
const LONG = ['richText', 'multilineText'];

/** Table fields with the primary field first, the way Airtable shows them. */
export function tableFields(table) {
  const fields = table?.fields || [];
  const primary = fields.find((f) => f.id === table.primaryFieldId);
  return primary ? [primary, ...fields.filter((f) => f !== primary)] : [...fields];
}

/** Fields by name (or id), in the order given; unknown names are dropped. */
export function orderFields(table, names) {
  const fields = tableFields(table);
  const out = [];
  names.forEach((name) => {
    const key = String(name).trim().toLowerCase();
    const field = fields.find((f) => [f.id, f.name.trim()].some((v) => v.toLowerCase() === key));
    if (field && !out.includes(field)) out.push(field);
  });
  return out;
}

/** Sensible fields for a format, when the site config does not list them. */
export function defaultFields(table, format) {
  const fields = tableFields(table).filter((f) => !SKIP.includes(f.type));
  if (format === 'accordion') {
    const [title, ...rest] = fields;
    const answer = rest.find((f) => f.type === 'richText') || rest.find((f) => LONG.includes(f.type)) || rest[0];
    return [title, answer].filter(Boolean);
  }
  if (format === 'table') return fields.filter((f) => f.type !== 'multipleAttachments').slice(0, 6);
  return fields;
}

/** Records whose values contain every word of the query. */
export function searchRecords(records, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return records;
  return records.filter((r) => {
    const text = Object.values(r.fields).join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
