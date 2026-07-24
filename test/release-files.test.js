'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('xyops-token-plugin.json uses the planned v1.2.0 release tag', () => {
  const content = fs.readFileSync('xyops-token-plugin.json', 'utf8');
  assert.equal(content.includes('#main'), false);
  assert.equal(content.includes('#v1.2.0'), true);
});

test('release documentation records remaining base XYPDF migration', () => {
  const roadmap = fs.readFileSync('ROADMAP.md', 'utf8');
  assert.match(roadmap, /production XYPDF|stable tag|релиз/i);
});
