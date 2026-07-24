#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`Required environment variable is missing: ${name}`);
  return normalized;
}

function optionalInteger(value, name, min = 0, max = 10000) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function redactText(value, secrets = []) {
  let result = String(value ?? '');
  for (const secret of secrets) {
    const normalized = String(secret ?? '');
    if (normalized) result = result.split(normalized).join('[REDACTED]');
  }
  return result;
}

function parseJsonLines(text) {
  const messages = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Runner returned non-JSON output: ${line.slice(0, 200)}`);
    }
  }
  return messages;
}

function finalMessage(messages) {
  return [...messages].reverse().find((message) => Number.isInteger(message?.code));
}

function findData(messages, key) {
  for (const message of messages) {
    if (message?.data && Object.prototype.hasOwnProperty.call(message.data, key)) {
      return message.data[key];
    }
  }
  return undefined;
}

function endpointSummary(apiUrl) {
  const url = new URL(apiUrl.includes('://') ? apiUrl : `https://${apiUrl}`);
  return url.origin;
}

function resolveAcceptanceConfig(env = process.env) {
  const apiUrl = required(env.KUBE_API_URL, 'KUBE_API_URL');
  required(env.KUBE_TOKEN, 'KUBE_TOKEN');
  const namespace = required(env.ACCEPTANCE_NAMESPACE, 'ACCEPTANCE_NAMESPACE');
  const deployment = String(env.ACCEPTANCE_DEPLOYMENT ?? '').trim();
  const mutating = asBoolean(env.ACCEPTANCE_MUTATING, false);
  const scaleReplicas = optionalInteger(env.ACCEPTANCE_SCALE_REPLICAS, 'ACCEPTANCE_SCALE_REPLICAS', 0, 10000);

  if (mutating && !deployment) {
    throw new Error('ACCEPTANCE_DEPLOYMENT is required when ACCEPTANCE_MUTATING=true');
  }
  if (mutating && scaleReplicas === undefined) {
    throw new Error('ACCEPTANCE_SCALE_REPLICAS is required when ACCEPTANCE_MUTATING=true');
  }

  return {
    apiUrl,
    namespace,
    deployment,
    mutating,
    scaleReplicas,
    timeoutSeconds: optionalInteger(env.ACCEPTANCE_TIMEOUT_SECONDS, 'ACCEPTANCE_TIMEOUT_SECONDS', 1, 3600) ?? 600,
    pollSeconds: optionalInteger(env.ACCEPTANCE_POLL_SECONDS, 'ACCEPTANCE_POLL_SECONDS', 1, 60) ?? 5
  };
}

function extractDeploymentReplicas(messages, deploymentName) {
  const deployments = findData(messages, 'kubernetes_deployments');
  if (!Array.isArray(deployments)) {
    throw new Error('list_deployments did not return kubernetes_deployments data');
  }
  const deployment = deployments.find((item) => item?.name === deploymentName);
  if (!deployment) throw new Error(`Deployment not found in acceptance namespace: ${deploymentName}`);
  const desired = Number(deployment.desired);
  if (!Number.isInteger(desired) || desired < 0) {
    throw new Error(`Deployment ${deploymentName} returned an invalid desired replica count`);
  }
  return desired;
}

function runAction(params, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const runnerPath = options.runnerPath || path.join(__dirname, '..', 'runner.js');
  const env = options.env || process.env;
  const secrets = [env.KUBE_TOKEN, env.KUBE_CA_CERT];

  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [runnerPath], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_CAPTURE_BYTES) {
        child.kill('SIGKILL');
        reject(new Error(`Runner output exceeded ${MAX_CAPTURE_BYTES} bytes`));
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_CAPTURE_BYTES) {
        child.kill('SIGKILL');
        reject(new Error(`Runner diagnostic output exceeded ${MAX_CAPTURE_BYTES} bytes`));
      }
    });
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      try {
        const messages = parseJsonLines(Buffer.concat(stdout).toString('utf8'));
        const final = finalMessage(messages);
        if (!final) throw new Error('Runner did not return a final result');
        resolve({
          exitCode: exitCode ?? 1,
          signal: signal || '',
          code: Number(final.code),
          description: redactText(final.description || '', secrets),
          messages,
          stderrBytes
        });
      } catch (error) {
        reject(new Error(redactText(error.message, secrets)));
      }
    });
    child.stdin.end(JSON.stringify({ params }));
  });
}

async function expectSuccess(label, params, context) {
  process.stdout.write(`- ${label} ... `);
  const result = await runAction(params, context);
  if (result.code !== 0 || result.exitCode !== 0) {
    process.stdout.write('FAILED\n');
    throw new Error(`${label}: ${result.description || `exit ${result.exitCode}`}`);
  }
  process.stdout.write(`OK${result.stderrBytes ? ` (diagnostic output captured: ${result.stderrBytes} bytes)` : ''}\n`);
  return result;
}

async function expectConfirmationRejection(label, params, expectedText, context) {
  process.stdout.write(`- ${label} ... `);
  const result = await runAction(params, context);
  const rejected = result.code !== 0 && result.description.toLowerCase().includes(expectedText.toLowerCase());
  if (!rejected) {
    process.stdout.write('FAILED\n');
    throw new Error(`${label}: operation was not rejected as expected`);
  }
  process.stdout.write('OK\n');
}

async function main() {
  const config = resolveAcceptanceConfig();
  const context = { env: process.env };
  const common = {
    namespace: config.namespace,
    timeout_seconds: Math.min(config.timeoutSeconds, 300)
  };

  process.stdout.write('Kubernetes acceptance smoke runner\n');
  process.stdout.write(`API: ${endpointSummary(config.apiUrl)}\n`);
  process.stdout.write(`Namespace: ${config.namespace}\n`);
  process.stdout.write(`Deployment: ${config.deployment || '<not selected>'}\n`);
  process.stdout.write(`Mutating checks: ${config.mutating ? 'enabled' : 'disabled'}\n\n`);

  await expectSuccess('Kubernetes API connection', { action: 'test_connection' }, context);
  await expectSuccess('List namespaces with pagination', { action: 'list_namespaces', list_limit: 100 }, context);
  const deploymentsResult = await expectSuccess(
    'List deployments with pagination',
    { ...common, action: 'list_deployments', list_limit: 100 },
    context
  );
  await expectSuccess('List pods with pagination', { ...common, action: 'list_pods', list_limit: 100 }, context);
  await expectSuccess('List events', { ...common, action: 'list_events', list_limit: 100 }, context);
  await expectSuccess('Namespace health', { ...common, action: 'namespace_health' }, context);
  await expectSuccess('CronJob health', { ...common, action: 'cronjob_health' }, context);
  await expectSuccess('Cleanup preview', { ...common, action: 'cleanup_preview' }, context);
  await expectSuccess(
    'Cleanup dry run',
    { ...common, action: 'cleanup_apply', confirm_cleanup: true, dry_run: true, max_deletions: 100 },
    context
  );
  await expectSuccess('ServiceAccount token expiry', { action: 'check_token_expiry', rotation_threshold_hours: 24 }, context);
  await expectConfirmationRejection(
    'Cleanup requires confirmation',
    { ...common, action: 'cleanup_apply', confirm_cleanup: false, dry_run: true },
    'not confirmed',
    context
  );

  let originalReplicas;
  if (config.deployment) {
    originalReplicas = extractDeploymentReplicas(deploymentsResult.messages, config.deployment);
    await expectSuccess(
      'Deployment diagnostics',
      { ...common, action: 'diagnose_deployment', deployment_name: config.deployment, previous_logs: false },
      context
    );
    await expectConfirmationRejection(
      'Restart requires confirmation',
      { ...common, action: 'restart_deployment', deployment_name: config.deployment, confirm_action: false },
      'not confirmed',
      context
    );
    await expectConfirmationRejection(
      'Scale requires confirmation',
      {
        ...common,
        action: 'scale_deployment',
        deployment_name: config.deployment,
        replicas: originalReplicas,
        confirm_action: false
      },
      'not confirmed',
      context
    );
  }

  if (config.mutating) {
    const rollout = {
      ...common,
      deployment_name: config.deployment,
      confirm_action: true,
      wait_for_rollout: true,
      rollout_timeout_seconds: config.timeoutSeconds,
      rollout_poll_seconds: config.pollSeconds
    };
    await expectSuccess('Restart and wait for new rollout', { ...rollout, action: 'restart_deployment' }, context);

    if (config.scaleReplicas !== originalReplicas) {
      let changed = false;
      try {
        await expectSuccess(
          `Scale to ${config.scaleReplicas} and wait`,
          { ...rollout, action: 'scale_deployment', replicas: config.scaleReplicas },
          context
        );
        changed = true;
      } finally {
        if (changed) {
          await expectSuccess(
            `Restore scale to ${originalReplicas}`,
            { ...rollout, action: 'scale_deployment', replicas: originalReplicas },
            context
          );
        }
      }
    } else {
      process.stdout.write(`- Scale check skipped: target already equals ${originalReplicas}\n`);
    }
  }

  process.stdout.write('\nAutomated smoke checks completed successfully.\n');
  process.stdout.write('The remaining cleanup deletion, previous-log and forced rollout-failure scenarios must still be verified manually using ACCEPTANCE_TESTS.md.\n');
}

if (require.main === module) {
  main().catch((error) => {
    const safeMessage = redactText(error.message || String(error), [process.env.KUBE_TOKEN, process.env.KUBE_CA_CERT]);
    process.stderr.write(`Acceptance failed: ${safeMessage}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  asBoolean,
  endpointSummary,
  extractDeploymentReplicas,
  finalMessage,
  findData,
  optionalInteger,
  parseJsonLines,
  redactText,
  resolveAcceptanceConfig,
  runAction
};
