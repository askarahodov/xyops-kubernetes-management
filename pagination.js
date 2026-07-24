\
'use strict';

function addQuery(path, values = {}) {
  const url = new URL(path, 'https://kubernetes.invalid');
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

async function listAllPages(client, path, { pageSize = 500, maxItems = 10000, maxPages = 1000 } = {}) {
  const items = [];
  let continueToken = '';
  const seen = new Set();

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await client.request(addQuery(path, {
      limit: Math.min(pageSize, Math.max(1, maxItems - items.length)),
      continue: continueToken || undefined
    }));
    const pageItems = Array.isArray(payload?.items) ? payload.items : [];
    items.push(...pageItems.slice(0, Math.max(0, maxItems - items.length)));
    if (items.length >= maxItems) return items;

    const next = String(payload?.metadata?.continue || '');
    if (!next) return items;
    if (seen.has(next)) throw new Error('Kubernetes pagination returned a repeated continue token');
    seen.add(next);
    continueToken = next;
  }

  throw new Error(`Kubernetes pagination exceeded ${maxPages} pages`);
}

module.exports = { addQuery, listAllPages };
