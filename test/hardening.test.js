'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rolloutConfig, runRolloutWait } = require('../hardening');

test('rolloutConfig enables waiting with bounded defaults', () => {
  assert.deepEqual(rolloutConfig({}), {
    wait: true,
    timeoutMs: 300000,
    pollIntervalMs: 5000
  });
  assert.equal(rolloutConfig({ wait_for_rollout: false }).wait, false);
});

test('runRolloutWait skips unrelated actions', async () => {
  assert.equal(await runRolloutWait({ action: 'list_pods' }, {}, () => {}), null);
});

test('runRolloutWait handles scale to zero', async () => {
  const client = {
    request: async () => ({
      metadata: { namespace: 'prod', name: 'worker', generation: 3 },
      spec: { replicas: 0 },
      status: {
        observedGeneration: 3,
        replicas: 0,
        updatedReplicas: 0,
        readyReplicas: 0,
        availableReplicas: 0,
        unavailableReplicas: 0
      }
    })
  };
  const result = await runRolloutWait({
    action: 'scale_deployment',
    namespace: 'prod',
    deployment_name: 'worker',
    replicas: 0,
    rollout_timeout_seconds: 1,
    rollout_poll_seconds: 1
  }, client, () => {});
  assert.equal(result.complete, true);
  assert.equal(result.desired, 0);
});
