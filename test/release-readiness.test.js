'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('release metadata has no implementation placeholders', () => {
  assert.equal(JSON.parse(fs.readFileSync('package.json', 'utf8')).version, '1.2.0');
  assert.equal(fs.existsSync('TODO.production-hardening.txt'), false);
  assert.doesNotMatch(fs.readFileSync('PRODUCTION_HARDENING.md', 'utf8'), /IMPLEMENTATION IN PROGRESS/);
  assert.doesNotMatch(fs.readFileSync('ROADMAP.md', 'utf8'), /- \[ \] (pagination|ожидание rollout)/i);
});
