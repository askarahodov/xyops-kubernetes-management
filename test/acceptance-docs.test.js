'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const file of ['PRODUCTION_HARDENING.md', 'ACCEPTANCE_TESTS.md', 'RELEASE_PROCESS.md', 'TOKEN_EXPIRY.md']) {
  test(`${file} exists and is documented`, () => {
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.length > 100);
  });
}
