#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

const HYGIENE_ACTIONS = new Set([
  'namespace_health',
  'diagnose_deployment',
  'cleanup_preview',
  'cleanup_apply',
  'cronjob_health'
]);

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('xyOps did not provide JSON on STDIN');
  return { buffer, input: JSON.parse(buffer.toString('utf8')) };
}

async function main() {
  const { buffer, input } = await readInput();
  const action = String(input?.params?.action || '').trim();
  const entrypoint = HYGIENE_ACTIONS.has(action) ? 'hygiene.js' : 'index.js';
  const child = spawn(process.execPath, [require('node:path').join(__dirname, entrypoint)], {
    env: process.env,
    stdio: ['pipe', 'inherit', 'inherit']
  });
  child.stdin.end(buffer);
  child.on('error', (error) => {
    process.stdout.write(`${JSON.stringify({ xy: 1, code: 1, description: error.message })}\n`);
    process.exitCode = 1;
  });
  child.on('close', (code) => { process.exitCode = code ?? 1; });
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ xy: 1, code: 1, description: error.message || String(error) })}\n`);
  process.exitCode = 1;
});
