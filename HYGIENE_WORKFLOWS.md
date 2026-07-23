# Kubernetes Hygiene & Diagnostics

Пакет предназначен для эксплуатации Kubernetes-кластеров через xyOps. Все сценарии разделены на read-only диагностику и отдельно подтверждаемую очистку.

## Workflow и назначение

| Workflow | Изменяет кластер | Назначение |
|---|---:|---|
| `workflow-namespace-health.json` | Нет | Единый отчёт здоровья namespace |
| `workflow-diagnose-deployment.json` | Нет | Автоматическая диагностика Deployment и его Pods |
| `workflow-cleanup-preview.json` | Нет | Поиск кандидатов для очистки |
| `workflow-cleanup-apply.json` | Только при отключённом dry run | Повторная проверка и удаление старых Pods/Jobs |
| `workflow-cronjob-health.json` | Нет | Проверка расписаний и последних запусков CronJobs |

## Проверка здоровья namespace

Анализируются Deployments, Pods, Jobs, CronJobs и Warning Events. Проблемами считаются неготовые Deployments, `ProgressDeadlineExceeded`, Failed/Pending Pods, CrashLoopBackOff, ImagePullBackOff, высокий restartCount, Failed Jobs и suspended CronJobs.

Выход: `kubernetes_namespace_health` с `healthy`, health score, summary, issues и warning events.

## Диагностика Deployment

Workflow получает Deployment conditions, ReplicaSets, Pods по selector, связанные Events, текущие логи и previous logs. Число Pods и строк логов ограничивается параметрами.

Выход: `kubernetes_deployment_diagnostics`.

## Preview очистки

Ничего не удаляет. Кандидаты:

- Succeeded Pods старше заданного возраста;
- Failed Pods старше заданного возраста;
- Evicted Pods старше заданного возраста;
- Completed Jobs старше заданного возраста;
- Failed Jobs старше заданного возраста.

Последние N Jobs каждого CronJob защищены. `kube-system` исключён по умолчанию.

Выход: `kubernetes_cleanup_preview`.

## Apply очистки

Перед действием кандидаты вычисляются заново. Защитные механизмы:

- `dry_run=true` по умолчанию;
- обязательное подтверждение;
- лимит удалений;
- запрет `kube-system` по умолчанию;
- Running, Pending и Unknown Pods не удаляются;
- последние Jobs каждого CronJob сохраняются.

Рекомендуемый порядок: preview → apply с dry run → проверка → apply без dry run.

Выход: `kubernetes_cleanup_result`.

## Проверка CronJobs

Показывает schedule, suspend, последний Job, lastScheduleTime и отмечает suspended, failed, never-run и stale CronJobs.

Выход: `kubernetes_cronjob_health`.

## Импорт

```text
1. xyops-hygiene-plugin.json
2. workflow-namespace-health.json
3. workflow-diagnose-deployment.json
4. workflow-cleanup-preview.json
5. workflow-cleanup-apply.json
6. workflow-cronjob-health.json
```

## Secret Vault

Используются те же секреты, что и базовым Kubernetes-плагином:

```text
KUBE_API_URL
KUBE_TOKEN
KUBE_CA_CERT
```

или `KUBE_CA_CERT_PATH`. `KUBE_INSECURE_TLS` допускается только для временной диагностики.

## RBAC

Read-only сценариям нужны `get/list` для Pods, logs, Events, Deployments, ReplicaSets, Jobs и CronJobs. Реальной очистке дополнительно нужен `delete` для Pods и Jobs. Не используйте `cluster-admin`.
