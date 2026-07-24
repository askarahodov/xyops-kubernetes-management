'use strict';

const fs = require('node:fs');
const https = require('node:https');
const { listAllPages } = require('./pagination');
const { waitForDeploymentRollout } = require('./rollout');

const MAX_ERROR_BODY = 2000;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

function emit(message) {
  process.stdout.write(`${JSON.stringify({ xy: 1, ...message })}\n`);
}

async function readStdin() {
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

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`Required value is missing: ${name}`);
  return normalized;
}

function optional(value) {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function asInteger(value, fallback, min = 0, max = 10000) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Expected an integer from ${min} to ${max}, received: ${value}`);
  }
  return parsed;
}

function normalizeApiUrl(value) {
  const input = required(value, 'KUBE_API_URL or api_url');
  const url = new URL(input.includes('://') ? input : `https://${input}`);
  if (url.protocol !== 'https:') throw new Error('Kubernetes API URL must use HTTPS');
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function readCa({ caCert, caPath }) {
  if (caCert) return Buffer.from(String(caCert).replace(/\\n/g, '\n'));
  if (!caPath) return undefined;
  if (!fs.existsSync(caPath)) throw new Error(`Kubernetes CA certificate not found: ${caPath}`);
  return fs.readFileSync(caPath);
}

function encodePath(value) {
  return encodeURIComponent(required(value, 'path value'));
}

function buildQuery(values = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

function parseKubernetesError(statusCode, body) {
  let message = '';
  let status = '';
  try {
    const payload = JSON.parse(body);
    message = payload.message || payload.reason || '';
    status = payload.reason || payload.status || '';
  } catch {
    message = body.slice(0, MAX_ERROR_BODY);
  }

  const error = new Error(
    `Kubernetes API HTTP ${statusCode}${message ? `: ${message}` : ''}`
  );
  error.kubernetesStatus = status || `HTTP ${statusCode}`;
  return error;
}

class KubernetesClient {
  constructor({ apiUrl, token, ca, insecureTls = false, timeoutMs = 30000 }) {
    this.apiUrl = apiUrl;
    this.token = token;
    this.ca = ca;
    this.insecureTls = insecureTls;
    this.timeoutMs = timeoutMs;
  }

  request(path, {
    method = 'GET',
    body,
    contentType = 'application/json',
    accept = 'application/json',
    responseType = 'json'
  } = {}) {
    const url = new URL(path, `${this.apiUrl}/`);
    const payload = body === undefined
      ? undefined
      : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));

    return new Promise((resolve, reject) => {
      const headers = {
        Accept: accept,
        Authorization: `Bearer ${this.token}`,
        'User-Agent': 'xyops-kubernetes-management/1.0.0'
      };
      if (payload !== undefined) {
        headers['Content-Type'] = contentType;
        headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = https.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        ca: this.ca,
        rejectUnauthorized: !this.insecureTls,
        timeout: this.timeoutMs
      }, (res) => {
        const chunks = [];
        let total = 0;

        res.on('data', (chunk) => {
          total += chunk.length;
          if (responseType === 'text' && total > MAX_LOG_BYTES) {
            req.destroy(new Error(`Kubernetes log response exceeded ${MAX_LOG_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8');
          const statusCode = res.statusCode || 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(parseKubernetesError(statusCode, responseBody));
            return;
          }

          if (responseType === 'text') {
            resolve(responseBody);
            return;
          }

          if (!responseBody.trim()) {
            resolve({});
            return;
          }

          try {
            resolve(JSON.parse(responseBody));
          } catch (error) {
            reject(new Error(`Kubernetes API returned invalid JSON: ${error.message}`));
          }
        });
      });

      req.on('timeout', () => req.destroy(
        new Error(`Kubernetes API request timed out after ${this.timeoutMs} ms`)
      ));
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }
}

function ageFromTimestamp(value, now = Date.now()) {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function containerReadySummary(statuses = []) {
  const list = Array.isArray(statuses) ? statuses : [];
  return `${list.filter((item) => item.ready).length}/${list.length}`;
}

function normalizeNamespace(item) {
  return {
    name: String(item?.metadata?.name || ''),
    status: String(item?.status?.phase || ''),
    age: ageFromTimestamp(item?.metadata?.creationTimestamp),
    labels: item?.metadata?.labels || {}
  };
}

function normalizeDeployment(item) {
  const containers = item?.spec?.template?.spec?.containers || [];
  return {
    namespace: String(item?.metadata?.namespace || ''),
    name: String(item?.metadata?.name || ''),
    desired: Number(item?.spec?.replicas || 0),
    ready: Number(item?.status?.readyReplicas || 0),
    updated: Number(item?.status?.updatedReplicas || 0),
    available: Number(item?.status?.availableReplicas || 0),
    images: containers.map((container) => String(container.image || '')).filter(Boolean),
    generation: Number(item?.metadata?.generation || 0),
    age: ageFromTimestamp(item?.metadata?.creationTimestamp)
  };
}

function normalizePod(item) {
  const statuses = item?.status?.containerStatuses || [];
  return {
    namespace: String(item?.metadata?.namespace || ''),
    name: String(item?.metadata?.name || ''),
    phase: String(item?.status?.phase || ''),
    ready: containerReadySummary(statuses),
    restarts: statuses.reduce((sum, status) => sum + Number(status.restartCount || 0), 0),
    node: String(item?.spec?.nodeName || ''),
    pod_ip: String(item?.status?.podIP || ''),
    containers: (item?.spec?.containers || []).map((container) => String(container.name || '')),
    age: ageFromTimestamp(item?.metadata?.creationTimestamp)
  };
}

function normalizeEvent(item) {
  return {
    type: String(item?.type || ''),
    reason: String(item?.reason || ''),
    object: [item?.involvedObject?.kind, item?.involvedObject?.name].filter(Boolean).join('/'),
    message: String(item?.message || ''),
    count: Number(item?.count || item?.series?.count || 0),
    last_seen: String(
      item?.eventTime || item?.lastTimestamp || item?.series?.lastObservedTime || item?.metadata?.creationTimestamp || ''
    )
  };
}

function namespaceTable(items) {
  return {
    title: 'Kubernetes namespaces',
    header: ['Namespace', 'Status', 'Age'],
    rows: items.map((item) => [item.name, item.status, item.age]),
    caption: `${items.length} namespace(s)`
  };
}

function deploymentTable(items) {
  return {
    title: 'Kubernetes deployments',
    header: ['Namespace', 'Deployment', 'Ready', 'Updated', 'Available', 'Images', 'Age'],
    rows: items.map((item) => [
      item.namespace,
      item.name,
      `${item.ready}/${item.desired}`,
      item.updated,
      item.available,
      item.images.join(', '),
      item.age
    ]),
    caption: `${items.length} deployment(s)`
  };
}

function podTable(items) {
  return {
    title: 'Kubernetes pods',
    header: ['Namespace', 'Pod', 'Phase', 'Ready', 'Restarts', 'Node', 'Pod IP', 'Age'],
    rows: items.map((item) => [
      item.namespace,
      item.name,
      item.phase,
      item.ready,
      item.restarts,
      item.node,
      item.pod_ip,
      item.age
    ]),
    caption: `${items.length} pod(s)`
  };
}

function eventTable(items) {
  return {
    title: 'Kubernetes events',
    header: ['Type', 'Reason', 'Object', 'Count', 'Last seen', 'Message'],
    rows: items.map((item) => [
      item.type,
      item.reason,
      item.object,
      item.count,
      item.last_seen,
      item.message
    ]),
    caption: `${items.length} event(s)`
  };
}

async function testConnection(params, client, send) {
  const version = await client.request('/version');
  const result = {
    git_version: String(version.gitVersion || ''),
    major: String(version.major || ''),
    minor: String(version.minor || ''),
    platform: String(version.platform || '')
  };

  send({
    table: {
      title: 'Kubernetes API connection',
      header: ['Property', 'Value'],
      rows: Object.entries(result),
      caption: client.apiUrl
    }
  });
  send({ data: { kubernetes_server: result, kubernetes_api_url: client.apiUrl } });
  return { description: `Connected to Kubernetes ${result.git_version || 'API server'}` };
}

async function listNamespaces(params, client, send) {
  const limit = asInteger(params.list_limit, 500, 1, 5000);
  const items = await listAllPages(client, '/api/v1/namespaces', { pageSize: Math.min(limit, 500), maxItems: limit });
  const namespaces = items.map(normalizeNamespace)
    .sort((a, b) => a.name.localeCompare(b.name));
  send({ table: namespaceTable(namespaces) });
  send({ data: { kubernetes_namespaces: namespaces } });
  return { description: `Found ${namespaces.length} Kubernetes namespace(s)` };
}

async function listDeployments(params, client, send) {
  const namespace = required(params.namespace, 'namespace');
  const limit = asInteger(params.list_limit, 500, 1, 5000);
  const labelSelector = optional(params.label_selector);
  const items = await listAllPages(client, `/apis/apps/v1/namespaces/${encodePath(namespace)}/deployments${buildQuery({ labelSelector })}`, { pageSize: Math.min(limit, 500), maxItems: limit });
  const deployments = items.map(normalizeDeployment)
    .sort((a, b) => a.name.localeCompare(b.name));
  send({ table: deploymentTable(deployments) });
  send({ data: { kubernetes_deployments: deployments } });
  return { description: `Found ${deployments.length} Deployment(s) in ${namespace}` };
}

async function listPods(params, client, send) {
  const namespace = required(params.namespace, 'namespace');
  const limit = asInteger(params.list_limit, 500, 1, 5000);
  const labelSelector = optional(params.label_selector);
  const fieldSelector = optional(params.field_selector);
  const items = await listAllPages(client, `/api/v1/namespaces/${encodePath(namespace)}/pods${buildQuery({ labelSelector, fieldSelector })}`, { pageSize: Math.min(limit, 500), maxItems: limit });
  const pods = items.map(normalizePod)
    .sort((a, b) => a.name.localeCompare(b.name));
  send({ table: podTable(pods) });
  send({ data: { kubernetes_pods: pods } });
  return { description: `Found ${pods.length} Pod(s) in ${namespace}` };
}

async function listEvents(params, client, send) {
  const namespace = required(params.namespace, 'namespace');
  const limit = asInteger(params.list_limit, 200, 1, 1000);
  const fieldSelector = optional(params.field_selector);
  const items = await listAllPages(client, `/api/v1/namespaces/${encodePath(namespace)}/events${buildQuery({ fieldSelector })}`, { pageSize: Math.min(limit, 500), maxItems: limit });
  const events = items.map(normalizeEvent)
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen));
  send({ table: eventTable(events) });
  send({ data: { kubernetes_events: events } });
  return { description: `Found ${events.length} Kubernetes event(s) in ${namespace}` };
}

async function getPodLogs(params, client, send) {
  const namespace = required(params.namespace, 'namespace');
  const pod = required(params.pod_name, 'pod_name');
  const container = optional(params.container_name);
  const tailLines = asInteger(params.tail_lines, 200, 1, 10000);
  const sinceSeconds = params.since_seconds === undefined || params.since_seconds === ''
    ? undefined
    : asInteger(params.since_seconds, undefined, 1, 604800);
  const previous = asBoolean(params.previous);
  const timestamps = asBoolean(params.timestamps, true);

  const logs = await client.request(
    `/api/v1/namespaces/${encodePath(namespace)}/pods/${encodePath(pod)}/log${buildQuery({
      container,
      tailLines,
      sinceSeconds,
      previous,
      timestamps
    })}`,
    { responseType: 'text', accept: 'text/plain' }
  );

  process.stderr.write(`===== ${namespace}/${pod}${container ? `:${container}` : ''} =====\n`);
  process.stderr.write(logs.endsWith('\n') ? logs : `${logs}\n`);
  send({
    data: {
      kubernetes_pod_logs: {
        namespace,
        pod,
        container: container || '',
        previous,
        tail_lines: tailLines,
        logs
      }
    }
  });
  return { description: `Loaded logs for Pod ${namespace}/${pod}` };
}

async function restartDeployment(params, client, send) {
  const namespace = required(params.namespace, 'namespace');
  const name = required(params.deployment_name, 'deployment_name');
  if (!asBoolean(params.confirm_action)) {
    throw new Error('Deployment restart was not confirmed. Enable the confirmation checkbox.');
  }

  const restartedAt = new Date().toISOString();
  const deployment = await client.request(
    `/apis/apps/v1/namespaces/${encodePath(namespace)}/deployments/${encodePath(name)}`,
    {
      method: 'PATCH',
      contentType: 'application/strategic-merge-patch+json',
      body: {
        spec: {
          template: {
            metadata: {
              annotations: {
                'xyops.io/restartedAt': restartedAt
              }
            }
          }
        }
      }
    }
  );

  let finalDeployment = deployment;
  let rollout;
  if (asBoolean(params.wait_for_rollout, false)) {
    const result = await waitForDeploymentRollout(client, `/apis/apps/v1/namespaces/${encodePath(namespace)}/deployments/${encodePath(name)}`, {
      timeoutSeconds: asInteger(params.rollout_timeout_seconds, 300, 10, 3600),
      pollSeconds: asInteger(params.rollout_poll_seconds, 5, 1, 60),
      onPoll: (state) => send({ status: `Rollout ${state.ready}/${state.desired} ready`, progress: 0.2 + Math.min(0.7, state.desired ? (state.ready / state.desired) * 0.7 : 0.7) })
    });
    finalDeployment = result.deployment;
    rollout = result.state;
  }
  const normalized = normalizeDeployment(finalDeployment);
  send({ table: deploymentTable([normalized]) });
  send({
    data: {
      kubernetes_restarted_deployment: {
        namespace,
        name,
        restarted_at: restartedAt,
        generation: normalized.generation,
        rollout: rollout || null
      }
    }
  });
  return { description: `Deployment ${namespace}/${name} restart ${rollout ? 'completed' : 'requested'}` };
}

async function scaleDeployment(params, client, send) {
  const namespace = required(params.namespace, 'namespace');
  const name = required(params.deployment_name, 'deployment_name');
  const replicas = asInteger(params.replicas, undefined, 0, 10000);
  if (replicas === undefined) throw new Error('Required value is missing: replicas');
  if (!asBoolean(params.confirm_action)) {
    throw new Error('Deployment scaling was not confirmed. Enable the confirmation checkbox.');
  }

  const scale = await client.request(
    `/apis/apps/v1/namespaces/${encodePath(namespace)}/deployments/${encodePath(name)}/scale`,
    {
      method: 'PATCH',
      contentType: 'application/merge-patch+json',
      body: { spec: { replicas } }
    }
  );

  let rollout;
  if (asBoolean(params.wait_for_rollout, false)) {
    const result = await waitForDeploymentRollout(client, `/apis/apps/v1/namespaces/${encodePath(namespace)}/deployments/${encodePath(name)}`, {
      timeoutSeconds: asInteger(params.rollout_timeout_seconds, 300, 10, 3600),
      pollSeconds: asInteger(params.rollout_poll_seconds, 5, 1, 60),
      onPoll: (state) => send({ status: `Scale rollout ${state.ready}/${state.desired} ready`, progress: 0.2 + Math.min(0.7, state.desired ? (state.ready / state.desired) * 0.7 : 0.7) })
    });
    rollout = result.state;
  }

  send({
    table: {
      title: 'Deployment scale',
      header: ['Namespace', 'Deployment', 'Replicas'],
      rows: [[namespace, name, Number(scale?.spec?.replicas ?? replicas)]],
      caption: 'Kubernetes Scale subresource'
    }
  });
  send({
    data: {
      kubernetes_scaled_deployment: {
        namespace,
        name,
        replicas: Number(scale?.spec?.replicas ?? replicas),
        rollout: rollout || null
      }
    }
  });
  return { description: `Scaled Deployment ${namespace}/${name} to ${replicas} replica(s)${rollout ? ' and rollout completed' : ''}` };
}

async function diagnosePod(params, client, send) {
  const namespace = required(params.namespace, 'namespace');
  const pod = required(params.pod_name, 'pod_name');
  const container = optional(params.container_name);
  const tailLines = asInteger(params.tail_lines, 200, 1, 5000);

  const podObject = await client.request(
    `/api/v1/namespaces/${encodePath(namespace)}/pods/${encodePath(pod)}`
  );
  const normalizedPod = normalizePod(podObject);
  const eventItems = await listAllPages(client, `/api/v1/namespaces/${encodePath(namespace)}/events${buildQuery({ fieldSelector: `involvedObject.name=${pod}` })}`, { pageSize: 200, maxItems: 200 });
  const events = eventItems.map(normalizeEvent)
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen));

  const containers = container
    ? [container]
    : (podObject?.spec?.containers || []).map((item) => String(item.name || '')).filter(Boolean);
  const logsByContainer = {};
  const logErrors = {};

  for (const containerName of containers) {
    try {
      logsByContainer[containerName] = await client.request(
        `/api/v1/namespaces/${encodePath(namespace)}/pods/${encodePath(pod)}/log${buildQuery({
          container: containerName,
          tailLines,
          timestamps: true
        })}`,
        { responseType: 'text', accept: 'text/plain' }
      );
    } catch (error) {
      logErrors[containerName] = error.message;
    }
  }

  send({ table: podTable([normalizedPod]) });
  send({ table: eventTable(events) });
  for (const [containerName, logs] of Object.entries(logsByContainer)) {
    process.stderr.write(`===== ${namespace}/${pod}:${containerName} =====\n`);
    process.stderr.write(logs.endsWith('\n') ? logs : `${logs}\n`);
  }
  send({
    data: {
      kubernetes_pod_diagnostics: {
        pod: normalizedPod,
        events,
        logs: logsByContainer,
        log_errors: logErrors
      }
    }
  });
  return {
    description: `Collected diagnostics for Pod ${namespace}/${pod}`,
    details: Object.keys(logErrors).length
      ? `Logs could not be loaded for: ${Object.keys(logErrors).join(', ')}`
      : undefined
  };
}

function cacheMenuItem(id, title) {
  return { id, title };
}

async function syncCache(params, client, send) {
  const limit = asInteger(params.list_limit, 5000, 1, 10000);
  const [namespaceItems, deploymentItems, podItems] = await Promise.all([
    listAllPages(client, '/api/v1/namespaces', { pageSize: 500, maxItems: limit }),
    listAllPages(client, '/apis/apps/v1/deployments', { pageSize: 500, maxItems: limit }),
    listAllPages(client, '/api/v1/pods', { pageSize: 500, maxItems: limit })
  ]);

  const namespaces = namespaceItems.map(normalizeNamespace)
    .sort((a, b) => a.name.localeCompare(b.name));
  const deployments = deploymentItems.map(normalizeDeployment)
    .sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
  const pods = podItems.map(normalizePod)
    .sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
  const updatedAt = new Date().toISOString();

  const cache = {
    namespaces: namespaces.map((item) => cacheMenuItem(item.name, item.name)),
    deployments: deployments.map((item) => cacheMenuItem(
      `${item.namespace}/${item.name}`,
      `${item.namespace} / ${item.name} — ${item.ready}/${item.desired} ready`
    )),
    pods: pods.map((item) => cacheMenuItem(
      `${item.namespace}/${item.name}`,
      `${item.namespace} / ${item.name} — ${item.phase}`
    )),
    metadata: {
      updated_at: updatedAt,
      counts: {
        namespaces: namespaces.length,
        deployments: deployments.length,
        pods: pods.length
      }
    }
  };

  send({
    table: {
      title: 'Kubernetes menu cache',
      header: ['Object type', 'Count'],
      rows: [
        ['Namespaces', namespaces.length],
        ['Deployments', deployments.length],
        ['Pods', pods.length]
      ],
      caption: `Updated ${updatedAt}`
    }
  });
  send({
    data: cache,
    workflowData: { kubernetes_cache_updated_at: updatedAt }
  });
  return {
    description: `Prepared Kubernetes menu cache: ${namespaces.length} namespace(s), ${deployments.length} deployment(s), ${pods.length} pod(s)`,
    details: 'Attach an **On Success → Store Bucket** action and store **Data** in bucket `bkubernetescache`.'
  };
}

const OPERATIONS = Object.freeze({
  test_connection: testConnection,
  list_namespaces: listNamespaces,
  list_deployments: listDeployments,
  list_pods: listPods,
  list_events: listEvents,
  get_pod_logs: getPodLogs,
  restart_deployment: restartDeployment,
  scale_deployment: scaleDeployment,
  diagnose_pod: diagnosePod,
  sync_cache: syncCache
});

async function executeOperation(params, client, send = emit) {
  const action = required(params.action || params.operation || params.kubernetes_tool, 'action');
  const handler = OPERATIONS[action];
  if (!handler) throw new Error(`Unsupported Kubernetes action: ${action}`);
  return handler(params, client, send);
}

function resolveConfig(input) {
  const params = input?.params || {};
  const secrets = input?.secrets || {};
  const apiUrl = normalizeApiUrl(
    params.api_url || process.env.api_url || process.env.KUBE_API_URL || secrets.KUBE_API_URL
  );
  const token = required(process.env.KUBE_TOKEN || secrets.KUBE_TOKEN, 'KUBE_TOKEN secret');
  const caCert = optional(process.env.KUBE_CA_CERT || secrets.KUBE_CA_CERT);
  const caPath = optional(
    params.ca_cert_path || process.env.ca_cert_path || process.env.KUBE_CA_CERT_PATH || secrets.KUBE_CA_CERT_PATH
  );
  const insecureTls = asBoolean(params.insecure_tls ?? process.env.insecure_tls ?? process.env.KUBE_INSECURE_TLS);
  const timeoutMs = asInteger(params.timeout_seconds ?? process.env.timeout_seconds, 30, 1, 300) * 1000;
  const ca = readCa({ caCert, caPath });

  return { params, apiUrl, token, ca, insecureTls, timeoutMs };
}

async function main() {
  const input = await readStdin();
  const config = resolveConfig(input);
  const client = new KubernetesClient(config);

  emit({ status: 'Connecting to Kubernetes API', progress: 0.1 });
  const result = await executeOperation(config.params, client, emit);
  emit({ progress: 1 });
  emit({ code: 0, ...result });
}

module.exports = {
  KubernetesClient,
  OPERATIONS,
  ageFromTimestamp,
  asBoolean,
  asInteger,
  buildQuery,
  containerReadySummary,
  deploymentTable,
  emit,
  encodePath,
  eventTable,
  executeOperation,
  main,
  normalizeApiUrl,
  normalizeDeployment,
  normalizeEvent,
  normalizeNamespace,
  normalizePod,
  parseKubernetesError,
  podTable,
  readCa,
  resolveConfig
};
