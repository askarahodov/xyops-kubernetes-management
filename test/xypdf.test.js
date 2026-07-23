'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));

test('main XYPDF contains bucket and four documented Event Plugins', () => {
  const config = readJson('xyops.json');
  const bucket = config.items.find((item) => item.type === 'bucket');
  const plugins = config.items.filter((item) => item.type === 'plugin');

  assert.equal(bucket.data.id, 'bkubernetescache');
  assert.equal(plugins.length, 4);
  assert.deepEqual(
    plugins.map((item) => item.data.id).sort(),
    ['pmlc2ha8fk8s1', 'pmlc2ha8fk8s_diag', 'pmlc2ha8fk8s_restart', 'pmlc2ha8fk8s_scale'].sort()
  );

  for (const plugin of plugins) {
    assert.equal(plugin.data.command, 'npx -y github:askarahodov/xyops-kubernetes-management#main');
    assert.ok(String(plugin.data.notes).length >= 120);
  }
});

test('management plugin exposes only controlled operations', () => {
  const config = readJson('xyops.json');
  const plugin = config.items.find((item) => item.data?.id === 'pmlc2ha8fk8s1');
  const toolset = plugin.data.params.find((param) => param.id === 'kubernetes_tool');
  const actions = toolset.data.tools.map((tool) =>
    tool.fields.find((field) => field.id === 'action')?.value
  );

  assert.deepEqual(actions, [
    'test_connection',
    'list_namespaces',
    'list_deployments',
    'list_pods',
    'list_events',
    'get_pod_logs',
    'restart_deployment',
    'scale_deployment',
    'diagnose_pod',
    'sync_cache'
  ]);
  assert.equal(actions.includes('exec'), false);
  assert.equal(actions.includes('apply_manifest'), false);
  assert.equal(actions.includes('read_secrets'), false);
});

test('workflow plugin references exist and workflow descriptions are clear', () => {
  const main = readJson('xyops.json');
  const pluginIds = new Set(
    main.items.filter((item) => item.type === 'plugin').map((item) => item.data.id)
  );

  for (const filename of ['workflow-restart-deployment.json', 'workflow-diagnose-pod.json']) {
    const config = readJson(filename);
    const event = config.items[0].data;
    const job = event.workflow.nodes.find((node) => node.type === 'job');
    assert.ok(pluginIds.has(job.data.plugin), `${job.data.plugin} is not imported by xyops.json`);
    assert.ok(String(config.description).length >= 100);
    assert.ok(String(event.notes).length >= 160);
  }
});

test('README documents all Kubernetes Secret Vault variables', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const secret of [
    'KUBE_API_URL',
    'KUBE_TOKEN',
    'KUBE_CA_CERT',
    'KUBE_CA_CERT_PATH',
    'KUBE_INSECURE_TLS'
  ]) {
    assert.match(readme, new RegExp(`\\b${secret}\\b`));
  }
});
