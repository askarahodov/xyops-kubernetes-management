'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveEntrypoint } = require('../runner');

test('runner routes token action separately and all Kubernetes actions through hardening', () => {
  assert.equal(resolveEntrypoint('check_token_expiry'), 'token-runner.js');
  assert.equal(resolveEntrypoint('namespace_health'), 'hardening.js');
  assert.equal(resolveEntrypoint('restart_deployment'), 'hardening.js');
});
