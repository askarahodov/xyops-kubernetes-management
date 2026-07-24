'use strict';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deploymentRolloutState(deployment, expectedReplicas) {
  const desired = expectedReplicas === undefined
    ? number(deployment?.spec?.replicas)
    : number(expectedReplicas);
  const generation = number(deployment?.metadata?.generation);
  const observedGeneration = number(deployment?.status?.observedGeneration);
  const replicas = number(deployment?.status?.replicas);
  const updated = number(deployment?.status?.updatedReplicas);
  const ready = number(deployment?.status?.readyReplicas);
  const available = number(deployment?.status?.availableReplicas);
  const unavailable = number(deployment?.status?.unavailableReplicas);
  const conditions = Array.isArray(deployment?.status?.conditions)
    ? deployment.status.conditions
    : [];
  const progressDeadline = conditions.find((condition) => (
    condition?.type === 'Progressing'
    && condition?.status === 'False'
    && condition?.reason === 'ProgressDeadlineExceeded'
  ));

  const observed = observedGeneration >= generation;
  const complete = !progressDeadline
    && observed
    && replicas === desired
    && updated === desired
    && ready === desired
    && available === desired
    && unavailable === 0;

  return {
    namespace: String(deployment?.metadata?.namespace || ''),
    name: String(deployment?.metadata?.name || ''),
    desired,
    generation,
    observed_generation: observedGeneration,
    replicas,
    updated,
    ready,
    available,
    unavailable,
    observed,
    complete,
    progress_deadline_exceeded: Boolean(progressDeadline),
    progress_deadline_message: String(progressDeadline?.message || '')
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForDeploymentRollout(client, options = {}) {
  const namespace = String(options.namespace || '').trim();
  const name = String(options.name || '').trim();
  if (!namespace) throw new Error('namespace is required for rollout wait');
  if (!name) throw new Error('deployment name is required for rollout wait');

  const timeoutMs = Number(options.timeoutMs ?? 300000);
  const pollIntervalMs = Number(options.pollIntervalMs ?? 5000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('rollout timeout must be positive');
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) throw new Error('rollout poll interval must be positive');

  const minimumGeneration = Number(options.minimumGeneration || 0);
  const now = options.now || Date.now;
  const pause = options.sleep || sleep;
  const startedAt = now();
  let attempts = 0;
  let lastState;

  while (true) {
    const deployment = await client.request(
      `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`
    );
    attempts += 1;
    lastState = deploymentRolloutState(deployment, options.expectedReplicas);

    if (typeof options.onPoll === 'function') {
      await options.onPoll(lastState, attempts);
    }

    if (lastState.progress_deadline_exceeded) {
      const error = new Error(
        `Deployment ${namespace}/${name} exceeded its progress deadline${lastState.progress_deadline_message ? `: ${lastState.progress_deadline_message}` : ''}`
      );
      error.rolloutState = lastState;
      throw error;
    }

    const generationReached = lastState.generation >= minimumGeneration;
    if (lastState.complete && generationReached) {
      return { ...lastState, attempts, elapsed_ms: Math.max(0, now() - startedAt) };
    }

    if (now() - startedAt >= timeoutMs) {
      const error = new Error(`Deployment ${namespace}/${name} rollout timed out after ${timeoutMs} ms`);
      error.rolloutState = lastState;
      throw error;
    }

    await pause(pollIntervalMs);
  }
}

module.exports = {
  deploymentRolloutState,
  waitForDeploymentRollout
};
