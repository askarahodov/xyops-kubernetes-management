# xyOps Kubernetes Management

Event Plugins и готовые Workflow для контролируемого взаимодействия xyOps с Kubernetes REST API без обязательной установки `kubectl` на xySat.

Версия: `1.0.0`.

## Возможности

- проверка подключения и версии API Server;
- список namespaces;
- список Deployments и Pods с label/field selectors;
- события namespace;
- логи текущего или предыдущего контейнера;
- read-only диагностика Pod: состояние, Events и логи;
- rollout restart Deployment;
- изменение replicas через Scale subresource;
- подготовка данных для Storage Bucket `bkubernetescache`.

Плагин намеренно не предоставляет произвольный `kubectl`, `exec` в Pod, чтение Kubernetes Secrets, удаление namespace или применение произвольных manifests.

## Состав

| Файл | Назначение |
|---|---|
| `xyops.json` | Bucket и четыре Event Plugins |
| `workflow-restart-deployment.json` | Workflow перезапуска Deployment |
| `workflow-diagnose-pod.json` | Workflow диагностики Pod |
| `manifests/xyops-rbac.yaml` | ServiceAccount и минимальный RBAC для первой версии |

## Требования

На xySat:

- xyOps / xySat `1.0.83` или новее;
- Node.js 18+;
- `npm`, `npx`, `git`;
- HTTPS-доступ до Kubernetes API Server.

На Kubernetes:

- ServiceAccount token;
- CA API Server;
- RBAC-права из `manifests/xyops-rbac.yaml` либо более узкий Role/RoleBinding.

## Secret Vault

Обязательно:

```text
KUBE_API_URL=https://kube-api.example.local:6443
KUBE_TOKEN=<ServiceAccount bearer token>
```

CA задаётся одним из вариантов:

```text
KUBE_CA_CERT=-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
```

или:

```text
KUBE_CA_CERT_PATH=/etc/xyops/kubernetes/ca.crt
```

Необязательно, только для временной диагностики:

```text
KUBE_INSECURE_TLS=false
```

URL и путь к CA можно задавать в форме Event. Значения формы имеют приоритет над Secret Vault. Токен никогда не выводится в результат Job.

## Создание ServiceAccount

```bash
kubectl apply -f manifests/xyops-rbac.yaml
```

Создать временный токен:

```bash
kubectl -n xyops-system create token xyops-kubernetes --duration=24h
```

Получить адрес API Server:

```bash
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
echo
```

Получить CA из kubeconfig в файл:

```bash
kubectl config view --raw --minify \
  -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' \
  | base64 -d > kubernetes-ca.crt
```

Для постоянной эксплуатации организуйте ротацию ограниченного ServiceAccount token. Не используйте `cluster-admin`.

## Импорт в xyOps

```text
1. xyops.json
2. workflow-restart-deployment.json
3. workflow-diagnose-pod.json
```

Workflow импортируются после `xyops.json`, потому что они ссылаются на Plugin ID:

```text
pmlc2ha8fk8s_restart
pmlc2ha8fk8s_diag
```

Команда всех Event Plugins:

```text
npx -y github:askarahodov/xyops-kubernetes-management#main
```

## Event Plugins

### Kubernetes — Управление

Основная форма с операциями просмотра, логов, диагностики, restart/scale и синхронизации кэша.

### Kubernetes — Перезапустить Deployment

Изменяет только annotation Pod Template:

```text
xyops.io/restartedAt=<ISO timestamp>
```

Изменение Pod Template запускает новый rollout. Операция требует подтверждения.

### Kubernetes — Масштабировать Deployment

Изменяет только `spec.replicas` через `/scale`. Допустимо значение от `0` до `10000`; операция требует подтверждения.

### Kubernetes — Диагностика Pod

Получает Pod, связанные Events и последние логи. Если container не указан, пытается получить логи всех обычных контейнеров Pod. Ошибка чтения логов одного контейнера не отменяет остальные результаты диагностики.

## Кэш Kubernetes

Операция **Синхронизировать меню** возвращает:

```text
namespaces
deployments
pods
metadata
```

Чтобы сохранить результат, добавьте Action:

```text
Condition: Success
Action: Store Bucket
Bucket: Кэш Kubernetes
Sync: Data
```

## Безопасность

- используйте отдельный ServiceAccount;
- выдавайте только необходимые `get`, `list`, `patch`;
- не отключайте TLS в production;
- ограничьте право запуска restart/scale Events в xyOps;
- не храните bearer token в полях Event или в Git;
- учитывайте, что `replicas=0` остановит workload.

## Проверка проекта

```bash
npm test
npm run check
npm pack --dry-run
```
