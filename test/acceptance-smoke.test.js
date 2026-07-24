'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  asBoolean,
  endpointSummary,
  extractDeploymentReplicas,
  finalMessage,
  findData,
  optionalInteger,
  parseJsonLines,
  redactText,
  resolveAcceptanceConfig
} = require('../scripts/acceptance-smoke');

test('redactText removes every configured secret', () => {
  const output = redactText('token=abc certificate=xyz abc', ['abc', 'xyz']);
  assert.equal(output, 'token=[REDACTED] certificate=[REDACTED] [REDACTED]');
});

test('parseJsonLines and finalMessage parse xyOps output', () => {
  const messages = parseJsonLines('{"xy":1,"status":"running"}\n{"xy":1,"code":0,"description":"ok"}\n');
  assert.equal(messages.length, 2);
  assert.deepEqual(finalMessage(messages), { xy: 1, code: 0, description: 'ok' });
});

test('findData returns the requested output object', () => {
  const messages = [{ data: { kubernetes_deployments: [{ name: 'api', desired: 2 }] } }];
  assert.deepEqual(findData(messages, 'kubernetes_deployments'), [{ name: 'api', desired: 2 }]);
});

test('extractDeploymentReplicas returns desired replicas', () => {
  const messages = [{ data: { kubernetes_deployments: [{ name: 'api', desired: 3 }] } }];
  assert.equal(extractDeploymentReplicas(messages, 'api'), 3);
  assert.throws(() => extractDeploymentReplicas(messages, 'missing'), /Deployment not found/);
});

test('resolveAcceptanceConfig defaults to read-only mode', () => {
  const config = resolveAcceptanceConfig({
    KUBE_API_URL: 'https://kubernetes.example.test:6443',
    KUBE_TOKEN: 'secret',
    ACCEPTANCE_NAMESPACE: 'xyops-test'
  });
  assert.equal(config.mutating, false);
  assert.equal(config.deployment, '');
  assert.equal(config.timeoutSeconds, 600);
  assert.equal(config.pollSeconds, 5);
});

test('resolveAcceptanceConfig requires explicit mutating inputs', () => {
  assert.throws(() => resolveAcceptanceConfig({
    KUBE_API_URL: 'https://kubernetes.example.test:6443',
    KUBE_TOKEN: 'secret',
    ACCEPTANCE_NAMESPACE: 'xyops-test',
    ACCEPTANCE_MUTATING: 'true'
  }), /ACCEPTANCE_DEPLOYMENT/);

  assert.throws(() => resolveAcceptanceConfig({
    KUBE_API_URL: 'https://kubernetes.example.test:6443',
    KUBE_TOKEN: 'secret',
    ACCEPTANCE_NAMESPACE: 'xyops-test',
    ACCEPTANCE_DEPLOYMENT: 'api',
    ACCEPTANCE_MUTATING: 'true'
  }), /ACCEPTANCE_SCALE_REPLICAS/);
});

test('helper parsers validate booleans, integers and endpoint output', () => {
  assert.equal(asBoolean('yes'), true);
  assert.equal(asBoolean('no'), false);
  assert.equal(optionalInteger('0', 'replicas'), 0);
  assert.throws(() => optionalInteger('-1', 'replicas'), /integer/);
  assert.equal(endpointSummary('kubernetes.example.test:6443/path'), 'https://kubernetes.example.test:6443');
});
