const { errorMessage } = require('./api');

async function loadPage(page, query, transform, reset) {
  if (!reset && (page.data.loading || !page.data.cursor)) return;
  const ticket = (page.listTicket || 0) + 1;
  page.listTicket = ticket;
  const cursor = reset ? null : page.data.cursor;
  page.setData({ loading: true, error: '', ...(reset ? { items: [], cursor: null } : {}) });
  try {
    const data = await query(cursor ? { cursor } : {});
    if (page.listTicket !== ticket) return;
    const items = data.items.map(transform);
    page.setData({ items: cursor ? page.data.items.concat(items) : items, cursor: data.next_cursor });
  } catch (error) {
    if (page.listTicket === ticket) page.setData({ error: errorMessage(error) });
  } finally {
    if (page.listTicket === ticket) page.setData({ loading: false });
  }
}

module.exports = { loadPage };
