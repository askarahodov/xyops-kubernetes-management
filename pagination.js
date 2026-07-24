'use strict';

function addQuery(path, values = {}) {
  const url = new URL(path, 'https://kubernetes.invalid');
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function configuredLimit(path, fallback = 10000) {
  const url = new URL(path, 'https://kubernetes.invalid');
  const parsed = Number.parseInt(url.searchParams.get('limit') || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function collectPaginatedList(firstPayload, path, requestNext, {
  pageSize = 500,
  maxItems = configuredLimit(path),
  maxPages = 1000
} = {}) {
  const items = Array.isArray(firstPayload?.items) ? firstPayload.items.slice(0, maxItems) : [];
  let continueToken = String(firstPayload?.metadata?.continue || '');
  const seen = new Set();

  for (let page = 1; continueToken && page < maxPages && items.length < maxItems; page += 1) {
    if (seen.has(continueToken)) throw new Error('Kubernetes pagination returned a repeated continue token');
    seen.add(continueToken);
    const payload = await requestNext(addQuery(path, {
      limit: Math.min(pageSize, Math.max(1, maxItems - items.length)),
      continue: continueToken
    }));
    const pageItems = Array.isArray(payload?.items) ? payload.items : [];
    items.push(...pageItems.slice(0, Math.max(0, maxItems - items.length)));
    continueToken = String(payload?.metadata?.continue || '');
  }

  if (continueToken && items.length < maxItems) {
    throw new Error(`Kubernetes pagination exceeded ${maxPages} pages`);
  }
  return { ...firstPayload, items, metadata: { ...(firstPayload?.metadata || {}), continue: '' } };
}

async function listAllPages(client, path, { pageSize = 500, maxItems = 10000, maxPages = 1000 } = {}) {
  const first = await client.request(addQuery(path, { limit: Math.min(pageSize, maxItems) }));
  const payload = await collectPaginatedList(first, path, (nextPath) => client.request(nextPath), {
    pageSize,
    maxItems,
    maxPages
  });
  return payload.items;
}

module.exports = { addQuery, collectPaginatedList, configuredLimit, listAllPages };
