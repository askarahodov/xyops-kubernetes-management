'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deploymentRolloutState, waitForDeploymentRollout } = require('../rollout');

test('deploymentRolloutState detects completion including scale to zero', () => {
  assert.equal(deploymentRolloutState({ metadata: { generation: 2 }, spec: { replicas: 0 }, status: { observedGeneration: 2 } }).complete, true);
});

test('waitForDeploymentRollout completes after readiness', async () => {
  let calls = 0;
  const client = { request: async () => {
    calls += 1;
    return calls === 1
      ? { metadata: { generation: 2 }, spec: { replicas: 1 }, status: { observedGeneration: 2, updatedReplicas: 1 } }
      : { metadata: { generation: 2 }, spec: { replicas: 1 }, status: { observedGeneration: 2, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1 } };
  }};
  const result = await waitForDeploymentRollout(client, '/deployment', { timeoutSeconds: 1, pollSeconds: 0 });
  assert.equal(result.state.complete, true);
});

test('deploymentRolloutState detects ProgressDeadlineExceeded', () => {
  const state = deploymentRolloutState({ status: { conditions: [{ type: 'Progressing', reason: 'ProgressDeadlineExceeded', message: 'deadline' }] } });
  assert.equal(state.failed, true);
});
