'use strict';

const DEFAULT_MAX_ITEMS = 10000;
const DEFAULT_MAX_PAGES = 1000;
const DEFAULT_PAGE_SIZE = 500;

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parsePath(path) {
  return new URL(path, 'https://kubernetes.invalid');
}

function requestPath(url) {
  return `${url.pathname}${url.search}`;
}

function configuredLimit(path, fallback = DEFAULT_MAX_ITEMS) {
  const value = parsePath(path).searchParams.get('limit');
  return positiveInteger(value, fallback, 'Kubernetes list limit');
}

async function collectPaginatedList(initialPayload, path, requestPage, options = {}) {
  if (!initialPayload || typeof initialPayload !== 'object' || !Array.isArray(initialPayload.items)) {
    throw new Error('Kubernetes list API returned an invalid payload: items must be an array');
  }
  if (typeof requestPage !== 'function') throw new Error('requestPage callback is required');

  const maxItems = positiveInteger(options.maxItems, configuredLimit(path), 'maxItems');
  const pageSize = Math.min(
    positiveInteger(options.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
    maxItems
  );
  const maxPages = positiveInteger(options.maxPages, DEFAULT_MAX_PAGES, 'maxPages');
  const items = initialPayload.items.slice(0, maxItems);
  const seenTokens = new Set();
  let pages = 1;
  let continueToken = String(initialPayload?.metadata?.continue || '');
  let lastPayload = initialPayload;
  let truncated = items.length >= maxItems && Boolean(continueToken);

  while (continueToken && items.length < maxItems) {
    if (pages >= maxPages) {
      throw new Error(`Kubernetes pagination exceeded the safety limit of ${maxPages} pages`);
    }
    if (seenTokens.has(continueToken)) {
      throw new Error('Kubernetes pagination returned a repeated continue token');
    }
    seenTokens.add(continueToken);

    const url = parsePath(path);
    url.searchParams.set('continue', continueToken);
    url.searchParams.set('limit', String(Math.min(pageSize, maxItems - items.length)));
    lastPayload = await requestPage(requestPath(url));
    pages += 1;

    if (!lastPayload || typeof lastPayload !== 'object' || !Array.isArray(lastPayload.items)) {
      throw new Error('Kubernetes list API returned an invalid paginated payload: items must be an array');
    }
    items.push(...lastPayload.items.slice(0, maxItems - items.length));
    const nextToken = String(lastPayload?.metadata?.continue || '');
    if (nextToken && seenTokens.has(nextToken)) {
      throw new Error('Kubernetes pagination returned a repeated continue token');
    }
    continueToken = nextToken;
    truncated = items.length >= maxItems && Boolean(continueToken);
  }

  return {
    ...initialPayload,
    items,
    metadata: {
      ...(lastPayload.metadata || initialPayload.metadata || {}),
      continue: truncated ? continueToken : '',
      xyopsPagination: {
        pages,
        maxItems,
        returnedItems: items.length,
        truncated
      }
    }
  };
}

async function listAllItems(client, path, options = {}) {
  if (!client || typeof client.request !== 'function') {
    throw new Error('Kubernetes client with request() is required');
  }
  const initialPayload = await client.request(path);
  const payload = await collectPaginatedList(
    initialPayload,
    path,
    (nextPath) => client.request(nextPath),
    options
  );
  return {
    items: payload.items,
    pages: payload.metadata?.xyopsPagination?.pages || 1,
    truncated: Boolean(payload.metadata?.xyopsPagination?.truncated),
    continue_token: String(payload.metadata?.continue || '')
  };
}

module.exports = {
  DEFAULT_MAX_ITEMS,
  DEFAULT_MAX_PAGES,
  DEFAULT_PAGE_SIZE,
  collectPaginatedList,
  configuredLimit,
  listAllItems,
  requestPath
};
