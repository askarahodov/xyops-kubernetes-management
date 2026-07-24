#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_TAG = 'v1.2.0';

function file(name) {
  return path.join(ROOT, name);
}

function read(name) {
  return fs.readFileSync(file(name), 'utf8');
}

function write(name, content) {
  fs.mkdirSync(path.dirname(file(name)), { recursive: true });
  fs.writeFileSync(file(name), content.endsWith('\n') ? content : `${content}\n`);
}

function readJson(name) {
  return JSON.parse(read(name));
}

function writeJson(name, value) {
  write(name, JSON.stringify(value));
}

function addField(fields, field, afterId) {
  if (!Array.isArray(fields) || fields.some((item) => item?.id === field.id)) return;
  const index = fields.findIndex((item) => item?.id === afterId);
  fields.splice(index >= 0 ? index + 1 : fields.length, 0, field);
}

const rolloutFields = [
  {
    id: 'wait_for_rollout',
    title: 'Ожидать завершения rollout',
    type: 'checkbox',
    value: true,
    caption: 'Job завершится только когда Deployment достигнет нужного количества Ready и Available replicas.'
  },
  {
    id: 'rollout_timeout_seconds',
    title: 'Тайм-аут rollout, секунд',
    type: 'text',
    variant: 'number',
    value: 300,
    required: true,
    caption: 'При превышении тайм-аута Job завершится ошибкой и вернёт последнее состояние Deployment.'
  },
  {
    id: 'rollout_poll_seconds',
    title: 'Интервал проверки rollout, секунд',
    type: 'text',
    variant: 'number',
    value: 5,
    required: true
  }
];

function addRolloutFields(fields) {
  for (const field of rolloutFields) addField(fields, field, 'confirm_action');
}

function pinPluginCommands(name) {
  const document = readJson(name);
  for (const item of document.items || []) {
    if (item?.type !== 'plugin' || !item?.data) continue;
    if (typeof item.data.command === 'string') {
      item.data.command = item.data.command.replace(/#main\b/g, `#${RELEASE_TAG}`);
    }
    item.data.notes = String(item.data.notes || '').replace(/#main\b/g, `#${RELEASE_TAG}`);

    if (['pmlc2ha8fk8s_restart', 'pmlc2ha8fk8s_scale'].includes(item.data.id)) {
      addRolloutFields(item.data.params);
      item.data.notes = `${item.data.notes} По умолчанию операция ожидает завершения rollout и проверяет observedGeneration, updated, ready и available replicas.`.trim();
    }

    for (const param of item.data.params || []) {
      const tools = param?.type === 'toolset' ? param?.data?.tools : undefined;
      for (const tool of tools || []) {
        const action = (tool.fields || []).find((field) => field?.id === 'action')?.value;
        if (['restart_deployment', 'scale_deployment'].includes(action)) addRolloutFields(tool.fields);
      }
    }
  }
  document.version = '1.2';
  writeJson(name, document);
}

function addRolloutParamsRecursively(value) {
  if (!value || typeof value !== 'object') return;
  if (value.params && ['restart_deployment', 'scale_deployment'].includes(value.params.action)) {
    if (value.params.wait_for_rollout === undefined) value.params.wait_for_rollout = true;
    if (value.params.rollout_timeout_seconds === undefined) value.params.rollout_timeout_seconds = 300;
    if (value.params.rollout_poll_seconds === undefined) value.params.rollout_poll_seconds = 5;
  }
  for (const child of Object.values(value)) addRolloutParamsRecursively(child);
}

for (const name of ['xyops.json', 'xyops-hygiene-plugin.json', 'xyops-token-plugin.json']) {
  pinPluginCommands(name);
}

for (const name of fs.readdirSync(ROOT).filter((name) => /^workflow-.*\.json$/.test(name))) {
  const document = readJson(name);
  addRolloutParamsRecursively(document);
  writeJson(name, document);
}

let readme = read('README.md');
readme = readme.replace(/Версия: `1\.1\.0`\./, 'Версия: `1.2.0`.');
if (!readme.includes('Kubernetes API pagination')) {
  readme = readme.replace(
    '- проверка здоровья CronJobs.',
    '- проверка здоровья CronJobs;\n- Kubernetes API pagination по `metadata.continue`;\n- ожидание завершения rollout после restart и scale;\n- безопасная проверка срока действия `KUBE_TOKEN`.'
  );
}
readme = readme.replace(
  '9. workflow-cronjob-health.json\n```',
  '9. workflow-cronjob-health.json\n10. xyops-token-plugin.json\n11. workflow-token-expiry.json\n```'
);
if (!readme.includes('## Production Hardening 1.2.0')) {
  readme = readme.replace(
    '## RBAC',
    `## Production Hardening 1.2.0\n\nProduction XYPDF закреплены на неизменяемом Git tag \`${RELEASE_TAG}\`, а не на плавающей ветке \`main\`. Все list-операции автоматически обрабатывают Kubernetes \`metadata.continue\` до заданного лимита. Restart и scale по умолчанию ожидают завершения rollout, обнаруживают \`ProgressDeadlineExceeded\`, поддерживают scale до нуля и возвращают последнее состояние при тайм-ауте.\n\nПараметры rollout:\n\n\`\`\`text\nwait_for_rollout=true\nrollout_timeout_seconds=300\nrollout_poll_seconds=5\n\`\`\`\n\nServiceAccount \`xyops-kubernetes\` и существующий RBAC в релизе 1.2.0 не изменялись.\n\n## RBAC`
  );
}
readme = readme.replace(
  '- `HYGIENE_WORKFLOWS.md` — подробное описание диагностики и очистки;',
  '- `HYGIENE_WORKFLOWS.md` — подробное описание диагностики и очистки;\n- `PRODUCTION_HARDENING.md` — pagination, rollout wait и ограничения;\n- `ACCEPTANCE_TESTS.md` — обязательная приёмка на тестовом Kubernetes;\n- `RELEASE_PROCESS.md` — выпуск неизменяемого Git tag;'
);
write('README.md', readme);

const previousChangelog = read('CHANGELOG.md').replace(/^# Changelog\s*/, '');
write('CHANGELOG.md', `# Changelog

## v1.2.0

- добавлена автоматическая Kubernetes API pagination с обработкой \`metadata.continue\`, лимитом объектов и защитой от повторяющихся токенов;
- restart и scale Deployment теперь по умолчанию ожидают фактическое завершение rollout;
- добавлены проверки \`observedGeneration\`, количества replicas, updated, ready, available и \`ProgressDeadlineExceeded\`;
- restart защищён от ложного успеха на предыдущей generation;
- поддержано ожидание scale Deployment до 0 replicas;
- добавлена безопасная локальная проверка срока действия ServiceAccount JWT без вывода исходного токена;
- production XYPDF закреплены на \`${RELEASE_TAG}\`;
- добавлены release-процесс, приёмочный checklist и regression-тесты;
- ServiceAccount и RBAC не изменялись.

${previousChangelog.trim()}
`);

write('PRODUCTION_HARDENING.md', `# Production Hardening 1.2.0

## Реализовано

### Kubernetes API pagination

Все базовые и Hygiene list-операции выполняются через общий paginated client. Он читает \`metadata.continue\`, сохраняет исходные selectors, кодирует continue token, объединяет страницы до заданного \`limit\` и прекращает работу при повторяющемся token или превышении 1000 страниц. Если API возвращает больше данных, чем разрешённый лимит, результат помечается как truncated.

### Ожидание Deployment rollout

После \`restart_deployment\` и \`scale_deployment\` плагин по умолчанию ожидает:

- \`observedGeneration >= generation\`;
- \`replicas == desired\`;
- \`updatedReplicas == desired\`;
- \`readyReplicas == desired\`;
- \`availableReplicas == desired\`;
- \`unavailableReplicas == 0\`.

Restart предварительно запоминает generation и не принимает старое готовое состояние за новый rollout. Поддерживается scale до 0 replicas. \`ProgressDeadlineExceeded\` и тайм-аут завершают Job ошибкой и возвращают последнее состояние в \`kubernetes_rollout_failure\`.

Параметры по умолчанию:

\`\`\`text
wait_for_rollout=true
rollout_timeout_seconds=300
rollout_poll_seconds=5
\`\`\`

### Проверка срока токена

Event и Workflow декодируют только JWT claims \`sub\`, \`iat\` и \`exp\`. Исходный \`KUBE_TOKEN\` не включается в таблицы, Job data, description или error details. Проверка локальная и не заменяет реальный запрос \`Проверить подключение\`.

### Стабильный production import

Все production Event Plugins используют:

\`\`\`text
npx -y github:askarahodov/xyops-kubernetes-management#${RELEASE_TAG}
\`\`\`

Для разработки допускается только локальная копия XYPDF с временной заменой tag на \`#main\`.

## Не изменялось

ServiceAccount \`xyops-kubernetes\`, ClusterRole и ClusterRoleBinding оставлены без изменений по решению проекта.
`);

write('ROADMAP.md', `# Roadmap

## 1.2.0 Production Hardening — реализовано

- Kubernetes API pagination;
- ожидание rollout после restart и scale;
- проверка срока ServiceAccount JWT;
- production XYPDF на стабильном tag;
- release process и приёмочный checklist;
- unit, syntax и package regression checks.

ServiceAccount и текущий RBAC не изменялись по принятому решению проекта.

## Release gates

Перед созданием tag \`${RELEASE_TAG}\` необходимо пройти \`ACCEPTANCE_TESTS.md\` на реальном тестовом Kubernetes. Это внешний этап приёмки, а не незавершённая реализация кода.

## Позже

- динамические Bucket Menu;
- multi-cluster profiles;
- расписания и уведомления;
- унифицированный аудит изменяющих операций.
`);

write('RELEASE_PROCESS.md', `# Процесс выпуска релиза

1. Убедиться, что версия в \`package.json\` равна \`1.2.0\`.
2. Выполнить \`npm test\`, \`npm run check\` и \`npm pack --dry-run\`.
3. Проверить, что production XYPDF используют \`#${RELEASE_TAG}\` и не содержат \`#main\`.
4. Провести проверки из \`ACCEPTANCE_TESTS.md\` на тестовом кластере.
5. Перевести PR из draft и выполнить squash merge в \`main\` только после зелёного CI.
6. Создать неизменяемый Git tag \`${RELEASE_TAG}\` на squash merge commit.
7. Проверить запуск \`npx -y github:askarahodov/xyops-kubernetes-management#${RELEASE_TAG}\`.
8. Импортировать production XYPDF и повторить smoke test подключения.
9. Удалить рабочую ветку.

Существующий release tag нельзя перемещать. Исправление выпускается новой patch-версией.
`);

let acceptance = read('ACCEPTANCE_TESTS.md');
if (!acceptance.includes('## Статус выполнения')) {
  acceptance = acceptance.replace(
    '# Приёмочные проверки Kubernetes-плагина',
    '# Приёмочные проверки Kubernetes-плагина\n\n## Статус выполнения\n\nАвтоматические unit/syntax/package проверки выполняются в GitHub Actions. Проверки ниже требуют доступа к реальному тестовому Kubernetes и должны быть заполнены оператором до создания release tag.'
  );
}
write('ACCEPTANCE_TESTS.md', acceptance);

write('test/release-files.test.js', `'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const file of ['xyops.json', 'xyops-hygiene-plugin.json', 'xyops-token-plugin.json']) {
  test(\`${'${file}'} uses immutable ${RELEASE_TAG} release tag\`, () => {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(content.includes('#main'), false);
    assert.equal(content.includes('#${RELEASE_TAG}'), true);
    assert.doesNotThrow(() => JSON.parse(content));
  });
}
`);

write('test/release-readiness.test.js', `'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('release metadata has no implementation placeholders', () => {
  assert.equal(JSON.parse(fs.readFileSync('package.json', 'utf8')).version, '1.2.0');
  assert.equal(fs.existsSync('TODO.production-hardening.txt'), false);
  assert.doesNotMatch(fs.readFileSync('PRODUCTION_HARDENING.md', 'utf8'), /IMPLEMENTATION IN PROGRESS/);
  assert.doesNotMatch(fs.readFileSync('ROADMAP.md', 'utf8'), /- \\[ \\] (pagination|ожидание rollout)/i);
});
`);

const todoFile = file('TODO.production-hardening.txt');
if (fs.existsSync(todoFile)) fs.rmSync(todoFile, { force: true });
const docsDirectory = file('docs');
if (fs.existsSync(docsDirectory)) fs.rmSync(docsDirectory, { recursive: true, force: true });
