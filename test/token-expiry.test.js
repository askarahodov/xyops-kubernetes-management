'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeJwtPayload, tokenExpiryInfo } = require('../token');

function token(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

test('decodeJwtPayload decodes JWT payload without exposing token', () => {
  assert.deepEqual(decodeJwtPayload(token({ sub: 'system:serviceaccount:xyops-system:xyops-kubernetes' })), {
    sub: 'system:serviceaccount:xyops-system:xyops-kubernetes'
  });
});

test('tokenExpiryInfo reports remaining time', () => {
  const now = 1_700_000_000;
  const info = tokenExpiryInfo(token({ iat: now - 60, exp: now + 7200 }), now);
  assert.equal(info.expires_at, new Date((now + 7200) * 1000).toISOString());
  assert.equal(info.remaining_seconds, 7200);
  assert.equal(info.rotation_required, false);
});

test('tokenExpiryInfo marks token for rotation', () => {
  const now = 1_700_000_000;
  const info = tokenExpiryInfo(token({ exp: now + 1800 }), now, 3600);
  assert.equal(info.rotation_required, true);
});
