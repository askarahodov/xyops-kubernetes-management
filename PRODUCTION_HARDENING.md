# Production Hardening 1.2.0

## Реализовано

### Kubernetes API pagination

Все базовые и Hygiene list-операции выполняются через общий paginated client. Он читает `metadata.continue`, сохраняет исходные selectors, кодирует continue token, объединяет страницы до заданного `limit` и прекращает работу при повторяющемся token или превышении 1000 страниц. Если API возвращает больше данных, чем разрешённый лимит, результат помечается как truncated.

### Ожидание Deployment rollout

После `restart_deployment` и `scale_deployment` плагин по умолчанию ожидает:

- `observedGeneration >= generation`;
- `replicas == desired`;
- `updatedReplicas == desired`;
- `readyReplicas == desired`;
- `availableReplicas == desired`;
- `unavailableReplicas == 0`.

Restart предварительно запоминает generation и не принимает старое готовое состояние за новый rollout. Поддерживается scale до 0 replicas. `ProgressDeadlineExceeded` и тайм-аут завершают Job ошибкой и возвращают последнее состояние в `kubernetes_rollout_failure`.

Параметры по умолчанию:

```text
wait_for_rollout=true
rollout_timeout_seconds=300
rollout_poll_seconds=5
```

### Проверка срока токена

Event и Workflow декодируют только JWT claims `sub`, `iat` и `exp`. Исходный `KUBE_TOKEN` не включается в таблицы, Job data, description или error details. Проверка локальная и не заменяет реальный запрос `Проверить подключение`.

### Стабильный production import

Все production Event Plugins используют:

```text
npx -y github:askarahodov/xyops-kubernetes-management#v1.2.0
```

Для разработки допускается только локальная копия XYPDF с временной заменой tag на `#main`.

## Не изменялось

ServiceAccount `xyops-kubernetes`, ClusterRole и ClusterRoleBinding оставлены без изменений по решению проекта.
