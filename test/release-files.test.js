'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const file of ['xyops.json', 'xyops-hygiene-plugin.json', 'xyops-token-plugin.json']) {
  test(`${file} uses immutable v1.2.0 reference`, () => {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(content.includes('#main'), false);
    assert.equal(content.includes('#v1.2.0'), true);
    JSON.parse(content);
  });
}
