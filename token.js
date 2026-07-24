'use strict';

function decodeJwtPayload(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('KUBE_TOKEN is missing. Configure it in xyOps Secret Vault.');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new Error('KUBE_TOKEN is not a JWT and its expiry cannot be determined.');
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('invalid payload');
    }
    return payload;
  } catch {
    throw new Error('KUBE_TOKEN contains an invalid JWT payload.');
  }
}

function tokenExpiryInfo(token, nowSeconds = Math.floor(Date.now() / 1000), rotationThresholdSeconds = 86400) {
  const payload = decodeJwtPayload(token);
  const exp = Number(payload.exp);
  const iat = Number(payload.iat);

  if (!Number.isFinite(exp)) {
    return {
      subject: String(payload.sub || ''),
      issued_at: Number.isFinite(iat) ? new Date(iat * 1000).toISOString() : '',
      expires_at: '',
      remaining_seconds: null,
      remaining_hours: null,
      expired: false,
      rotation_required: true,
      reason: 'JWT does not contain exp claim'
    };
  }

  const remainingSeconds = Math.floor(exp - nowSeconds);
  const expired = remainingSeconds <= 0;
  return {
    subject: String(payload.sub || ''),
    issued_at: Number.isFinite(iat) ? new Date(iat * 1000).toISOString() : '',
    expires_at: new Date(exp * 1000).toISOString(),
    remaining_seconds: remainingSeconds,
    remaining_hours: Math.round((remainingSeconds / 3600) * 100) / 100,
    expired,
    rotation_required: expired || remainingSeconds <= rotationThresholdSeconds,
    reason: expired
      ? 'Token has expired'
      : remainingSeconds <= rotationThresholdSeconds
        ? 'Token expires soon'
        : ''
  };
}

module.exports = { decodeJwtPayload, tokenExpiryInfo };
