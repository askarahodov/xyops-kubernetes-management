'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectPaginatedList, configuredLimit } = require('../pagination');

test('configuredLimit reads Kubernetes list limit', () => {
  assert.equal(configuredLimit('/api/v1/pods?limit=250'), 250);
  assert.equal(configuredLimit('/api/v1/pods'), 10000);
});

test('collectPaginatedList follows and encodes continue tokens', async () => {
  const calls = [];
  const result = await collectPaginatedList(
    { items: [1, 2], metadata: { continue: 'a/b+c=' } },
    '/api/v1/pods?labelSelector=app%3Dapi&limit=10',
    async (path) => {
      calls.push(path);
      return { items: [3], metadata: {} };
    }
  );
  assert.deepEqual(result.items, [1, 2, 3]);
  assert.equal(result.metadata.xyopsPagination.pages, 2);
  assert.match(calls[0], /continue=a%2Fb%2Bc%3D/);
  assert.match(calls[0], /labelSelector=app%3Dapi/);
});

test('collectPaginatedList truncates at configured max items', async () => {
  const result = await collectPaginatedList(
    { items: [1, 2], metadata: { continue: 'next' } },
    '/api/v1/pods?limit=2',
    async () => { throw new Error('must not request another page'); }
  );
  assert.deepEqual(result.items, [1, 2]);
  assert.equal(result.metadata.xyopsPagination.truncated, true);
  assert.equal(result.metadata.continue, 'next');
});

test('collectPaginatedList rejects repeated continue token', async () => {
  await assert.rejects(
    () => collectPaginatedList(
      { items: [1], metadata: { continue: 'same' } },
      '/api/v1/pods?limit=10',
      async () => ({ items: [2], metadata: { continue: 'same' } })
    ),
    /repeated continue token/
  );
});
