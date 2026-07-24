'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deploymentRolloutState(deployment, expectedReplicas, minimumGeneration = 0) {
  const desired = expectedReplicas === undefined
    ? Number(deployment?.spec?.replicas || 0)
    : Number(expectedReplicas);
  const generation = Number(deployment?.metadata?.generation || 0);
  const observed = Number(deployment?.status?.observedGeneration || 0);
  const replicas = Number(deployment?.status?.replicas ?? desired);
  const updated = Number(deployment?.status?.updatedReplicas || 0);
  const ready = Number(deployment?.status?.readyReplicas || 0);
  const available = Number(deployment?.status?.availableReplicas || 0);
  const unavailable = Number(deployment?.status?.unavailableReplicas || 0);
  const deadline = (deployment?.status?.conditions || []).find(
    (condition) => condition?.type === 'Progressing' && condition?.reason === 'ProgressDeadlineExceeded'
  );
  const generationReady = generation >= minimumGeneration && observed >= generation;
  return {
    namespace: String(deployment?.metadata?.namespace || ''),
    name: String(deployment?.metadata?.name || ''),
    desired,
    generation,
    observed_generation: observed,
    replicas,
    updated,
    ready,
    available,
    unavailable,
    complete: generationReady && replicas === desired && updated === desired && ready === desired && available === desired && unavailable === 0,
    failed: Boolean(deadline),
    failure_reason: deadline?.message || deadline?.reason || ''
  };
}

async function waitOnPath(client, path, {
  expectedReplicas,
  timeoutMs = 300000,
  pollIntervalMs = 5000,
  minimumGeneration = 0,
  onPoll
} = {}) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let attempts = 0;
  let lastState;
  let lastDeployment;

  while (Date.now() <= deadline) {
    attempts += 1;
    lastDeployment = await client.request(path);
    lastState = deploymentRolloutState(lastDeployment, expectedReplicas, minimumGeneration);
    if (onPoll) onPoll(lastState, attempts);
    if (lastState.failed) {
      const error = new Error(`Deployment rollout failed: ${lastState.failure_reason || 'ProgressDeadlineExceeded'}`);
      error.rolloutState = { ...lastState, attempts, elapsed_ms: Date.now() - started };
      throw error;
    }
    if (lastState.complete) {
      return {
        deployment: lastDeployment,
        state: { ...lastState, attempts, elapsed_ms: Date.now() - started }
      };
    }
    await sleep(pollIntervalMs);
  }

  const error = new Error(`Deployment rollout timed out after ${timeoutMs} ms`);
  error.rolloutState = { ...(lastState || {}), attempts, elapsed_ms: Date.now() - started };
  throw error;
}

async function waitForDeploymentRollout(client, pathOrOptions, legacyOptions = {}) {
  if (typeof pathOrOptions === 'object' && pathOrOptions !== null) {
    const options = pathOrOptions;
    const path = `/apis/apps/v1/namespaces/${encodeURIComponent(options.namespace)}/deployments/${encodeURIComponent(options.name)}`;
    const result = await waitOnPath(client, path, options);
    return result.state;
  }

  return waitOnPath(client, String(pathOrOptions || ''), {
    timeoutMs: Number(legacyOptions.timeoutSeconds || 300) * 1000,
    pollIntervalMs: Number(legacyOptions.pollSeconds ?? 5) * 1000,
    onPoll: legacyOptions.onPoll
  });
}

module.exports = { deploymentRolloutState, waitForDeploymentRollout };
