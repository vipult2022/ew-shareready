/*
 * Table block: one row per block row. The first row is the header unless the
 * block has the "no header" variant, e.g. "Table (no header)".
 */
export default function decorate(block) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  const hasHeader = !block.classList.contains('no-header');
  [...block.children].forEach((row, i) => {
    const isHead = hasHeader && i === 0;
    const tr = document.createElement('tr');
    [...row.children].forEach((cell) => {
      const td = document.createElement(isHead ? 'th' : 'td');
      if (isHead) td.scope = 'col';
      td.append(...cell.childNodes);
      tr.append(td);
    });
    (isHead ? thead : tbody).append(tr);
  });
  if (thead.children.length) table.append(thead);
  table.append(tbody);
  const scroller = document.createElement('div');
  scroller.className = 'table-scroll';
  scroller.append(table);
  block.replaceChildren(scroller);
}
