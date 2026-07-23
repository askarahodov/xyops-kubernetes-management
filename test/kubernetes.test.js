'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  KubernetesClient,
  OPERATIONS,
  asBoolean,
  asInteger,
  buildQuery,
  executeOperation,
  normalizeApiUrl,
  normalizeDeployment,
  normalizePod,
  parseKubernetesError
} = require('../index');

test('normalizes Kubernetes HTTPS API URL', () => {
  assert.equal(normalizeApiUrl('kube.example.local:6443'), 'https://kube.example.local:6443');
  assert.equal(normalizeApiUrl('https://kube.example.local:6443/'), 'https://kube.example.local:6443');
  assert.throws(() => normalizeApiUrl('http://kube.example.local:8080'), /must use HTTPS/);
});

test('parses booleans and bounded integers', () => {
  assert.equal(asBoolean('true'), true);
  assert.equal(asBoolean('no'), false);
  assert.equal(asInteger('0', undefined, 0, 10), 0);
  assert.equal(asInteger('10', undefined, 0, 10), 10);
  assert.throws(() => asInteger('11', undefined, 0, 10), /0 to 10/);
});

test('builds encoded Kubernetes query parameters', () => {
  assert.equal(
    buildQuery({ labelSelector: 'app=api,env=prod', limit: 100, empty: '' }),
    '?labelSelector=app%3Dapi%2Cenv%3Dprod&limit=100'
  );
});

test('normalizes Deployment and Pod summaries', () => {
  const deployment = normalizeDeployment({
    metadata: { namespace: 'prod', name: 'api', generation: 4, creationTimestamp: new Date().toISOString() },
    spec: { replicas: 3, template: { spec: { containers: [{ image: 'example/api:1.0' }] } } },
    status: { readyReplicas: 2, updatedReplicas: 3, availableReplicas: 2 }
  });
  assert.deepEqual(
    { namespace: deployment.namespace, name: deployment.name, desired: deployment.desired, ready: deployment.ready, images: deployment.images },
    { namespace: 'prod', name: 'api', desired: 3, ready: 2, images: ['example/api:1.0'] }
  );

  const pod = normalizePod({
    metadata: { namespace: 'prod', name: 'api-1', creationTimestamp: new Date().toISOString() },
    spec: { nodeName: 'worker-1', containers: [{ name: 'api' }] },
    status: {
      phase: 'Running',
      podIP: '10.42.0.15',
      containerStatuses: [{ ready: true, restartCount: 2 }]
    }
  });
  assert.equal(pod.ready, '1/1');
  assert.equal(pod.restarts, 2);
  assert.equal(pod.node, 'worker-1');
});

test('extracts Kubernetes Status message from HTTP errors', () => {
  const error = parseKubernetesError(403, JSON.stringify({
    status: 'Failure',
    reason: 'Forbidden',
    message: 'pods is forbidden'
  }));
  assert.match(error.message, /HTTP 403: pods is forbidden/);
  assert.equal(error.kubernetesStatus, 'Forbidden');
});

test('restart deployment uses a strategic merge patch and requires confirmation', async () => {
  const calls = [];
  const client = {
    request: async (path, options) => {
      calls.push({ path, options });
      return {
        metadata: { namespace: 'prod', name: 'api', generation: 7 },
        spec: { replicas: 2, template: { spec: { containers: [] } } },
        status: { readyReplicas: 2, availableReplicas: 2, updatedReplicas: 2 }
      };
    }
  };
  const messages = [];

  await assert.rejects(
    () => OPERATIONS.restart_deployment({ namespace: 'prod', deployment_name: 'api' }, client, (message) => messages.push(message)),
    /not confirmed/
  );

  const result = await OPERATIONS.restart_deployment({
    namespace: 'prod', deployment_name: 'api', confirm_action: true
  }, client, (message) => messages.push(message));

  assert.equal(result.description, 'Restart requested for Deployment prod/api');
  assert.equal(calls[0].path, '/apis/apps/v1/namespaces/prod/deployments/api');
  assert.equal(calls[0].options.method, 'PATCH');
  assert.equal(calls[0].options.contentType, 'application/strategic-merge-patch+json');
  assert.ok(calls[0].options.body.spec.template.metadata.annotations['xyops.io/restartedAt']);
});

test('scale deployment changes only replicas through scale subresource', async () => {
  const calls = [];
  const client = {
    request: async (path, options) => {
      calls.push({ path, options });
      return { spec: { replicas: 0 } };
    }
  };
  const result = await OPERATIONS.scale_deployment({
    namespace: 'prod', deployment_name: 'worker', replicas: 0, confirm_action: true
  }, client, () => {});

  assert.equal(result.description, 'Scaled Deployment prod/worker to 0 replica(s)');
  assert.equal(calls[0].path, '/apis/apps/v1/namespaces/prod/deployments/worker/scale');
  assert.deepEqual(calls[0].options.body, { spec: { replicas: 0 } });
});

test('sync cache returns bucket-compatible menu arrays', async () => {
  const client = {
    request: async (path) => {
      if (path.startsWith('/api/v1/namespaces?')) {
        return { items: [{ metadata: { name: 'prod' }, status: { phase: 'Active' } }] };
      }
      if (path.startsWith('/apis/apps/v1/deployments?')) {
        return { items: [{
          metadata: { namespace: 'prod', name: 'api' },
          spec: { replicas: 2, template: { spec: { containers: [] } } },
          status: { readyReplicas: 1 }
        }] };
      }
      return { items: [{
        metadata: { namespace: 'prod', name: 'api-1' },
        spec: { containers: [{ name: 'api' }] },
        status: { phase: 'Running', containerStatuses: [{ ready: true, restartCount: 0 }] }
      }] };
    }
  };
  const messages = [];
  await executeOperation({ action: 'sync_cache', list_limit: 100 }, client, (message) => messages.push(message));
  const dataMessage = messages.find((message) => message.data?.metadata);
  assert.deepEqual(dataMessage.data.namespaces, [{ id: 'prod', title: 'prod' }]);
  assert.equal(dataMessage.data.deployments[0].id, 'prod/api');
  assert.equal(dataMessage.data.pods[0].id, 'prod/api-1');
});

test('KubernetesClient stores authentication configuration without exposing token', () => {
  const client = new KubernetesClient({
    apiUrl: 'https://kube.example.local:6443',
    token: 'secret-token',
    insecureTls: false,
    timeoutMs: 1000
  });
  assert.equal(client.apiUrl, 'https://kube.example.local:6443');
  assert.equal(client.token, 'secret-token');
});
