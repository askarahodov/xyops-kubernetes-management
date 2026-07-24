# xyOps Kubernetes Management

Event Plugins и готовые Workflow для контролируемого взаимодействия xyOps с Kubernetes REST API без обязательной установки `kubectl` на xySat.

Версия: `1.2.0`.

## Возможности

Базовый пакет:

- проверка подключения к API Server;
- namespaces, Deployments, Pods и Events;
- текущие и previous-логи контейнеров;
- диагностика Pod;
- restart и scale Deployment;
- Bucket-кэш Kubernetes.

Пакет **Kubernetes Hygiene & Diagnostics**:

- общая проверка здоровья namespace;
- автоматическая диагностика Deployment;
- предварительный просмотр очистки;
- контролируемая очистка старых Pods и Jobs;
- проверка здоровья CronJobs;
- Kubernetes API pagination по `metadata.continue`;
- ожидание завершения rollout после restart и scale;
- безопасная проверка срока действия `KUBE_TOKEN`;
- автоматизированная smoke-приёмка на тестовом Kubernetes.

Плагин не предоставляет произвольный `kubectl`, `exec` в Pod, чтение Kubernetes Secrets, удаление namespace или применение произвольных manifests.

## Secret Vault

Обязательно:

```text
KUBE_API_URL=https://kube-api.example.local:6443
KUBE_TOKEN=<ServiceAccount bearer token>
```

CA задаётся одним способом:

```text
KUBE_CA_CERT=-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
```

или:

```text
KUBE_CA_CERT_PATH=/etc/xyops/kubernetes/ca.crt
```

Только для временной диагностики:

```text
KUBE_INSECURE_TLS=false
```

## Импорт

Базовые Plugins и Workflow:

```text
1. xyops.json
2. workflow-restart-deployment.json
3. workflow-diagnose-pod.json
```

Диагностика и очистка:

```text
4. xyops-hygiene-plugin.json
5. workflow-namespace-health.json
6. workflow-diagnose-deployment.json
7. workflow-cleanup-preview.json
8. workflow-cleanup-apply.json
9. workflow-cronjob-health.json
10. xyops-token-plugin.json
11. workflow-token-expiry.json
```

Workflow импортируются после Plugin-файлов, потому что xyOps проверяет Plugin ID при импорте.

## Проверка здоровья namespace

`workflow-namespace-health.json` формирует read-only отчёт по Deployments, Pods, Jobs, CronJobs и Warning Events. Он обнаруживает неготовые Deployments, `ProgressDeadlineExceeded`, Failed/Pending Pods, CrashLoopBackOff, ImagePullBackOff, высокий restartCount, Failed Jobs и suspended CronJobs.

Выходные данные: `kubernetes_namespace_health`.

## Диагностика Deployment

`workflow-diagnose-deployment.json` получает Deployment conditions, связанные ReplicaSets и Pods, Events, текущие и previous-логи. Число диагностируемых Pods и строк логов ограничивается параметрами запуска.

Выходные данные: `kubernetes_deployment_diagnostics`.

## Предварительный просмотр очистки

`workflow-cleanup-preview.json` ничего не удаляет. Он показывает Succeeded, Failed и Evicted Pods, а также Completed/Failed Jobs старше заданного возраста. Последние N Jobs каждого CronJob защищаются, `kube-system` исключается по умолчанию.

Выходные данные: `kubernetes_cleanup_preview`.

## Контролируемая очистка

`workflow-cleanup-apply.json` повторно вычисляет кандидатов непосредственно перед действием. По умолчанию включён `dry_run`, требуется подтверждение, действует лимит удалений, `kube-system` запрещён, Running/Pending/Unknown Pods никогда не выбираются.

Рекомендуемый порядок:

```text
1. Preview.
2. Apply с dry run.
3. Проверка результата.
4. Apply без dry run.
```

Выходные данные: `kubernetes_cleanup_result`.

## Проверка CronJobs

`workflow-cronjob-health.json` показывает schedule, suspend, последний Job и lastScheduleTime. Выделяются suspended, Failed, никогда не запускавшиеся и давно не запускавшиеся CronJobs.

Выходные данные: `kubernetes_cronjob_health`.

## Production Hardening 1.2.0

Production XYPDF закреплены на неизменяемом Git tag `v1.2.0`, а не на плавающей ветке `main`. Все list-операции автоматически обрабатывают Kubernetes `metadata.continue` до заданного лимита. Restart и scale по умолчанию ожидают завершения rollout, обнаруживают `ProgressDeadlineExceeded`, поддерживают scale до нуля и возвращают последнее состояние при тайм-ауте.

Параметры rollout:

```text
wait_for_rollout=true
rollout_timeout_seconds=300
rollout_poll_seconds=5
```

ServiceAccount `xyops-kubernetes` и существующий RBAC в релизе 1.2.0 не изменялись.

## Автоматизированная приёмка

Команда `npm run acceptance:smoke` запускает безопасную часть `ACCEPTANCE_TESTS.md` против реального тестового Kubernetes. По умолчанию выполняются read-only операции, cleanup preview/dry-run и проверки обязательного подтверждения. Содержимое Pod logs захватывается, но не печатается, а `KUBE_TOKEN` и CA редактируются из сообщений об ошибках.

```bash
export KUBE_API_URL='https://kube-api.example.local:6443'
export KUBE_TOKEN='<ServiceAccount bearer token>'
export KUBE_CA_CERT_PATH='/etc/xyops/kubernetes/ca.crt'
export ACCEPTANCE_NAMESPACE='xyops-test'
export ACCEPTANCE_DEPLOYMENT='test-api'

npm run acceptance:smoke
```

Restart и scale включаются только явно. Для scale скрипт запоминает исходное количество replicas и восстанавливает его после проверки:

```bash
export ACCEPTANCE_MUTATING='true'
export ACCEPTANCE_SCALE_REPLICAS='0'
export ACCEPTANCE_TIMEOUT_SECONDS='600'
export ACCEPTANCE_POLL_SECONDS='5'

npm run acceptance:smoke
```

Реальное удаление подготовленных объектов, previous logs и принудительные rollout failure-сценарии остаются ручными release-gates.

## RBAC

Примените:

```bash
kubectl apply -f manifests/xyops-rbac.yaml
```

Read-only операциям нужны `get/list` для namespaces, Pods, logs, Events, Deployments, ReplicaSets, Jobs и CronJobs. Restart/scale требуют `patch`; реальная очистка требует `delete` для Pods и Jobs.

Не назначайте `cluster-admin`.

Создать временный token:

```bash
kubectl -n xyops-system create token xyops-kubernetes --duration=24h
```

## Подробная документация

- `HYGIENE_WORKFLOWS.md` — подробное описание диагностики и очистки;
- `PRODUCTION_HARDENING.md` — pagination, rollout wait и ограничения;
- `ACCEPTANCE_TESTS.md` — обязательная приёмка на тестовом Kubernetes;
- `RELEASE_PROCESS.md` — выпуск неизменяемого Git tag;
- `manifests/xyops-rbac.yaml` — ServiceAccount и RBAC;
- descriptions, notes и captions встроены во все импортируемые Event и Workflow.

## Проверка проекта

```bash
npm test
npm run check
npm run release:check
npm pack --dry-run
```

## Безопасность

- храните token только в Secret Vault;
- не отключайте TLS в production;
- сначала используйте preview и dry run;
- не разрешайте `kube-system` без отдельной необходимости;
- ограничьте запуск cleanup Event административной ролью xyOps;
- учитывайте, что удаление Pods и Jobs необратимо.
