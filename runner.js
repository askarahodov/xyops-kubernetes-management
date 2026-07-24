#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const TOKEN_ACTIONS = new Set(['check_token_expiry']);

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('xyOps did not provide JSON on STDIN');
  return { buffer, input: JSON.parse(buffer.toString('utf8')) };
}

function resolveEntrypoint(action) {
  return TOKEN_ACTIONS.has(action) ? 'token-runner.js' : 'hardening.js';
}

async function main() {
  const { buffer, input } = await readInput();
  const action = String(input?.params?.action || '').trim();
  const entrypoint = resolveEntrypoint(action);
  const child = spawn(process.execPath, [path.join(__dirname, entrypoint)], {
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

if (require.main === module) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({ xy: 1, code: 1, description: error.message || String(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { TOKEN_ACTIONS, resolveEntrypoint };
