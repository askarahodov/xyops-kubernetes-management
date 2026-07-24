#!/usr/bin/env node
'use strict';

const { tokenExpiryInfo } = require('./token');

function emit(payload) {
  process.stdout.write(`${JSON.stringify({ xy: 1, ...payload })}\n`);
}

function asThresholdSeconds(value) {
  const hours = Number(value ?? 24);
  if (!Number.isFinite(hours) || hours < 0 || hours > 8760) {
    throw new Error('rotation_threshold_hours must be a number from 0 to 8760.');
  }
  return Math.round(hours * 3600);
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  if (!chunks.length) throw new Error('xyOps did not provide JSON on STDIN');
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const input = await readInput();
  const action = String(input?.params?.action || '').trim();
  if (action !== 'check_token_expiry') {
    throw new Error(`Unsupported token action: ${action || '<empty>'}`);
  }

  const thresholdSeconds = asThresholdSeconds(input?.params?.rotation_threshold_hours);
  const result = tokenExpiryInfo(process.env.KUBE_TOKEN, undefined, thresholdSeconds);

  emit({
    table: {
      title: 'Kubernetes ServiceAccount token expiry',
      header: ['Property', 'Value'],
      rows: [
        ['Subject', result.subject],
        ['Issued at', result.issued_at],
        ['Expires at', result.expires_at],
        ['Remaining hours', result.remaining_hours],
        ['Expired', result.expired],
        ['Rotation required', result.rotation_required],
        ['Reason', result.reason]
      ]
    }
  });
  emit({ data: { kubernetes_token_expiry: result } });
  emit({
    code: result.expired ? 1 : 0,
    description: result.expired
      ? 'Kubernetes ServiceAccount token has expired'
      : result.rotation_required
        ? 'Kubernetes ServiceAccount token should be rotated soon'
        : 'Kubernetes ServiceAccount token expiry is healthy'
  });
}

main().catch((error) => {
  emit({ code: 1, description: error.message || String(error) });
  process.exitCode = 1;
});
