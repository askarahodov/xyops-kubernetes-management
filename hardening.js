#!/usr/bin/env node
'use strict';

const {
  KubernetesClient,
  asBoolean,
  asInteger,
  emit,
  executeOperation,
  resolveConfig
} = require('./index');
const { OPS: HYGIENE_OPERATIONS } = require('./hygiene');
const { collectPaginatedList, configuredLimit } = require('./pagination');
const { waitForDeploymentRollout } = require('./rollout');

const HYGIENE_ACTIONS = new Set(Object.keys(HYGIENE_OPERATIONS));
const ROLLOUT_ACTIONS = new Set(['restart_deployment', 'scale_deployment']);

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`Required value is missing: ${name}`);
  return normalized;
}

class PaginatedKubernetesClient extends KubernetesClient {
  async request(path, options = {}) {
    const payload = await super.request(path, options);
    const method = String(options.method || 'GET').toUpperCase();
    if (
      method !== 'GET'
      || options.responseType === 'text'
      || !payload
      || typeof payload !== 'object'
      || !Array.isArray(payload.items)
      || !payload?.metadata?.continue
    ) {
      return payload;
    }

    const maxItems = configuredLimit(path);
    return collectPaginatedList(
      payload,
      path,
      (nextPath) => super.request(nextPath, options),
      { maxItems, pageSize: Math.min(500, maxItems) }
    );
  }
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) throw new Error('xyOps did not provide JSON on STDIN');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`xyOps provided invalid JSON on STDIN: ${error.message}`);
  }
}

function rolloutConfig(params) {
  return {
    wait: asBoolean(params.wait_for_rollout, true),
    timeoutMs: asInteger(params.rollout_timeout_seconds, 300, 1, 3600) * 1000,
    pollIntervalMs: asInteger(params.rollout_poll_seconds, 5, 1, 60) * 1000
  };
}

async function runRolloutWait(params, client, send, context = {}) {
  const action = required(params.action, 'action');
  if (!ROLLOUT_ACTIONS.has(action)) return null;
  const settings = rolloutConfig(params);
  if (!settings.wait) return null;

  const namespace = required(params.namespace, 'namespace');
  const name = required(params.deployment_name, 'deployment_name');
  const expectedReplicas = action === 'scale_deployment'
    ? asInteger(params.replicas, undefined, 0, 10000)
    : undefined;

  send({ status: `Waiting for Deployment ${namespace}/${name} rollout`, progress: 0.3 });
  const rollout = await waitForDeploymentRollout(client, {
    namespace,
    name,
    expectedReplicas,
    timeoutMs: settings.timeoutMs,
    pollIntervalMs: settings.pollIntervalMs,
    minimumGeneration: Number(context.minimumGeneration || 0),
    onPoll: (state, attempts) => send({
      status: `Rollout ${namespace}/${name}: ${state.ready}/${state.desired} ready`,
      progress: Math.min(0.95, 0.3 + attempts * 0.03)
    })
  });

  send({
    table: {
      title: 'Deployment rollout',
      header: ['Namespace', 'Deployment', 'Desired', 'Updated', 'Ready', 'Available', 'Attempts'],
      rows: [[
        namespace,
        name,
        rollout.desired,
        rollout.updated,
        rollout.ready,
        rollout.available,
        rollout.attempts
      ]],
      caption: `Completed in ${rollout.elapsed_ms} ms`
    }
  });
  send({ data: { kubernetes_deployment_rollout: rollout } });
  return rollout;
}

async function executeHardeningAction(params, client, send = emit) {
  const action = required(params.action, 'action');
  let minimumGeneration = 0;
  if (action === 'restart_deployment' && asBoolean(params.wait_for_rollout, true)) {
    const namespace = required(params.namespace, 'namespace');
    const name = required(params.deployment_name, 'deployment_name');
    const before = await client.request(
      `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`
    );
    minimumGeneration = Number(before?.metadata?.generation || 0) + 1;
  }

  const operationParams = ROLLOUT_ACTIONS.has(action)
    ? { ...params, wait_for_rollout: false }
    : params;
  const result = HYGIENE_ACTIONS.has(action)
    ? await HYGIENE_OPERATIONS[action](operationParams, client, send)
    : await executeOperation(operationParams, client, send);
  const rollout = await runRolloutWait(params, client, send, { minimumGeneration });
  if (!rollout) return result;
  return {
    ...result,
    description: `${result.description}; rollout completed`
  };
}

async function main() {
  const input = await readInput();
  const config = resolveConfig(input);
  const client = new PaginatedKubernetesClient(config);
  emit({ status: 'Connecting to Kubernetes API', progress: 0.1 });
  const result = await executeHardeningAction(config.params, client, emit);
  emit({ progress: 1 });
  emit({ code: 0, ...result });
}

if (require.main === module) {
  main().catch((error) => {
    emit({
      code: 1,
      description: error.message || String(error),
      details: error.kubernetesStatus
        ? `Kubernetes API status: \`${error.kubernetesStatus}\``
        : undefined,
      data: error.rolloutState
        ? { kubernetes_rollout_failure: error.rolloutState }
        : undefined
    });
    process.exitCode = 1;
  });
}

module.exports = {
  HYGIENE_ACTIONS,
  PaginatedKubernetesClient,
  ROLLOUT_ACTIONS,
  executeHardeningAction,
  rolloutConfig,
  runRolloutWait
};
