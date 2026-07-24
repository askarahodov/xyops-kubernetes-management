'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolveEntrypoint } = require('../runner');

test('runner routes token action separately and all Kubernetes actions through hardening', () => {
  assert.equal(resolveEntrypoint('check_token_expiry'), 'token-runner.js');
  assert.equal(resolveEntrypoint('namespace_health'), 'hardening.js');
  assert.equal(resolveEntrypoint('restart_deployment'), 'hardening.js');
});

test('rollout waiting is orchestrated only by hardening layer', () => {
  const core = fs.readFileSync('index.js', 'utf8');
  const hardening = fs.readFileSync('hardening.js', 'utf8');
  assert.match(core, /asBoolean\(params\.wait_for_rollout, false\)/);
  assert.match(hardening, /asBoolean\(params\.wait_for_rollout, true\)/);
  assert.match(hardening, /wait_for_rollout: false/);
});
