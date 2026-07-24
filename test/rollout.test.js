'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deploymentRolloutState, waitForDeploymentRollout } = require('../rollout');

function deployment(status = {}, replicas = 2) {
  return {
    metadata: { namespace: 'prod', name: 'api', generation: 4 },
    spec: { replicas },
    status: { observedGeneration: 4, ...status }
  };
}

test('deploymentRolloutState detects completed rollout', () => {
  const state = deploymentRolloutState(deployment({
    replicas: 2, updatedReplicas: 2, readyReplicas: 2, availableReplicas: 2
  }));
  assert.equal(state.complete, true);
});

test('deploymentRolloutState supports scale to zero', () => {
  const state = deploymentRolloutState(deployment({
    replicas: 0, updatedReplicas: 0, readyReplicas: 0, availableReplicas: 0
  }, 0), 0);
  assert.equal(state.complete, true);
});

test('waitForDeploymentRollout polls until ready', async () => {
  const responses = [
    deployment({ replicas: 2, updatedReplicas: 2, readyReplicas: 1, availableReplicas: 1 }),
    deployment({ replicas: 2, updatedReplicas: 2, readyReplicas: 2, availableReplicas: 2 })
  ];
  let now = 0;
  const result = await waitForDeploymentRollout({ request: async () => responses.shift() }, {
    namespace: 'prod',
    name: 'api',
    timeoutMs: 1000,
    pollIntervalMs: 10,
    now: () => now,
    sleep: async (ms) => { now += ms; }
  });
  assert.equal(result.complete, true);
  assert.equal(result.attempts, 2);
});

test('waitForDeploymentRollout fails on ProgressDeadlineExceeded', async () => {
  const failed = deployment({
    replicas: 1,
    updatedReplicas: 1,
    readyReplicas: 0,
    availableReplicas: 0,
    conditions: [{
      type: 'Progressing',
      status: 'False',
      reason: 'ProgressDeadlineExceeded',
      message: 'ReplicaSet did not progress'
    }]
  }, 1);
  await assert.rejects(
    () => waitForDeploymentRollout({ request: async () => failed }, {
      namespace: 'prod', name: 'api', timeoutMs: 100, pollIntervalMs: 10
    }),
    /exceeded its progress deadline/
  );
});

test('waitForDeploymentRollout times out and preserves last state', async () => {
  let now = 0;
  const pending = deployment({
    replicas: 2, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1, unavailableReplicas: 1
  });
  await assert.rejects(
    async () => {
      try {
        await waitForDeploymentRollout({ request: async () => pending }, {
          namespace: 'prod', name: 'api', timeoutMs: 20, pollIntervalMs: 10,
          now: () => now,
          sleep: async (ms) => { now += ms; }
        });
      } catch (error) {
        assert.equal(error.rolloutState.ready, 1);
        throw error;
      }
    },
    /timed out/
  );
});

test('waitForDeploymentRollout waits for minimum generation after restart', async () => {
  const responses = [
    {
      metadata: { namespace: 'prod', name: 'api', generation: 4 },
      spec: { replicas: 1 },
      status: { observedGeneration: 4, replicas: 1, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1 }
    },
    {
      metadata: { namespace: 'prod', name: 'api', generation: 5 },
      spec: { replicas: 1 },
      status: { observedGeneration: 5, replicas: 1, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1 }
    }
  ];
  let now = 0;
  const result = await waitForDeploymentRollout({ request: async () => responses.shift() }, {
    namespace: 'prod', name: 'api', minimumGeneration: 5,
    timeoutMs: 100, pollIntervalMs: 10,
    now: () => now, sleep: async (ms) => { now += ms; }
  });
  assert.equal(result.generation, 5);
  assert.equal(result.attempts, 2);
});
