#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VERSION = '1.2.0';
const TAG = `v${VERSION}`;
const COMMAND = `npx -y github:askarahodov/xyops-kubernetes-management#${TAG}`;
const ROLLOUT_NOTE = 'По умолчанию операция ожидает завершения rollout и проверяет observedGeneration, updated, ready и available replicas.';
const WRITE = process.argv.includes('--write');

const releaseNotes = [
  '- добавлена автоматическая Kubernetes API pagination с обработкой `metadata.continue`, лимитом объектов и защитой от повторяющихся токенов;',
  '- restart и scale Deployment теперь по умолчанию ожидают фактическое завершение rollout;',
  '- добавлены проверки `observedGeneration`, количества replicas, updated, ready, available и `ProgressDeadlineExceeded`;',
  '- restart защищён от ложного успеха на предыдущей generation;',
  '- поддержано ожидание scale Deployment до 0 replicas;',
  '- добавлена безопасная локальная проверка срока действия ServiceAccount JWT без вывода исходного токена;',
  '- production XYPDF закреплены на `v1.2.0`;',
  '- добавлены release-процесс, приёмочный checklist и regression-тесты;',
  '- ServiceAccount и RBAC не изменялись.'
].join('\n');

function fullPath(name) {
  return path.join(ROOT, name);
}

function read(name) {
  return fs.readFileSync(fullPath(name), 'utf8');
}

function normalizeNotes(value, requiresRolloutNote) {
  const escaped = ROLLOUT_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutDuplicates = String(value || '')
    .replace(new RegExp(`(?:\\s*${escaped})+`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
  return requiresRolloutNote
    ? `${withoutDuplicates}${withoutDuplicates ? ' ' : ''}${ROLLOUT_NOTE}`
    : withoutDuplicates;
}

function normalizeXypdf(name) {
  const document = JSON.parse(read(name));
  for (const item of document.items || []) {
    if (item?.type !== 'plugin' || !item?.data) continue;
    item.data.command = COMMAND;
    const rolloutPlugin = ['pmlc2ha8fk8s_restart', 'pmlc2ha8fk8s_scale'].includes(item.data.id);
    item.data.notes = normalizeNotes(item.data.notes, rolloutPlugin);
  }
  document.version = '1.2';
  return `${JSON.stringify(document)}\n`;
}

function normalizeChangelog() {
  const source = read('CHANGELOG.md');
  const withoutHeader = source.replace(/^# Changelog\s*/, '');
  const withoutRelease = withoutHeader
    .replace(/(?:^|\n)## v1\.2\.0\n[\s\S]*?(?=\n## |$)/g, '')
    .trim();
  return `# Changelog\n\n## v1.2.0\n\n${releaseNotes}\n\n${withoutRelease}\n`;
}

const expected = new Map([
  ['xyops.json', normalizeXypdf('xyops.json')],
  ['xyops-hygiene-plugin.json', normalizeXypdf('xyops-hygiene-plugin.json')],
  ['xyops-token-plugin.json', normalizeXypdf('xyops-token-plugin.json')],
  ['CHANGELOG.md', normalizeChangelog()]
]);

const mismatches = [];
for (const [name, content] of expected) {
  if (read(name) === content) continue;
  mismatches.push(name);
  if (WRITE) fs.writeFileSync(fullPath(name), content);
}

if (!WRITE && mismatches.length) {
  throw new Error(`Release files are not normalized: ${mismatches.join(', ')}. Run npm run release:normalize.`);
}

if (WRITE) {
  process.stdout.write(`Normalized ${mismatches.length} release file(s).\n`);
} else {
  process.stdout.write('Release files are normalized.\n');
}
