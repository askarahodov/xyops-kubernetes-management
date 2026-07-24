'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deploymentRolloutState(deployment) {
  const desired = Number(deployment?.spec?.replicas || 0);
  const generation = Number(deployment?.metadata?.generation || 0);
  const observed = Number(deployment?.status?.observedGeneration || 0);
  const updated = Number(deployment?.status?.updatedReplicas || 0);
  const ready = Number(deployment?.status?.readyReplicas || 0);
  const available = Number(deployment?.status?.availableReplicas || 0);
  const unavailable = Number(deployment?.status?.unavailableReplicas || 0);
  const deadline = (deployment?.status?.conditions || []).find(
    (condition) => condition?.type === 'Progressing' && condition?.reason === 'ProgressDeadlineExceeded'
  );
  return {
    desired, generation, observed, updated, ready, available, unavailable,
    complete: observed >= generation && updated === desired && ready === desired && available === desired && unavailable === 0,
    failed: Boolean(deadline),
    failure_reason: deadline?.message || deadline?.reason || ''
  };
}

async function waitForDeploymentRollout(client, path, {
  timeoutSeconds = 300,
  pollSeconds = 5,
  onPoll
} = {}) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastDeployment;
  while (Date.now() <= deadline) {
    lastDeployment = await client.request(path);
    const state = deploymentRolloutState(lastDeployment);
    if (onPoll) onPoll(state);
    if (state.failed) throw new Error(`Deployment rollout failed: ${state.failure_reason || 'ProgressDeadlineExceeded'}`);
    if (state.complete) return { deployment: lastDeployment, state };
    await sleep(pollSeconds * 1000);
  }
  const state = deploymentRolloutState(lastDeployment || {});
  throw new Error(`Deployment rollout timed out after ${timeoutSeconds}s: ready ${state.ready}/${state.desired}, updated ${state.updated}, available ${state.available}`);
}

module.exports = { deploymentRolloutState, waitForDeploymentRollout };
