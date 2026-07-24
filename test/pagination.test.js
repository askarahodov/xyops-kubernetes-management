'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { listAllPages } = require('../pagination');

test('listAllPages follows continue tokens', async () => {
  const calls = [];
  const client = { request: async (path) => {
    calls.push(path);
    if (calls.length === 1) return { items: [1, 2], metadata: { continue: 'next' } };
    return { items: [3], metadata: { continue: '' } };
  }};
  assert.deepEqual(await listAllPages(client, '/api/v1/pods', { pageSize: 2, maxItems: 10 }), [1, 2, 3]);
  assert.match(calls[1], /continue=next/);
});

test('listAllPages rejects repeated continue token', async () => {
  const client = { request: async () => ({ items: [], metadata: { continue: 'same' } }) };
  await assert.rejects(() => listAllPages(client, '/api/v1/pods'), /repeated continue token/);
});
