# Приёмочные проверки Kubernetes-плагина

## Статус выполнения

Автоматические unit/syntax/package проверки выполняются в GitHub Actions. Проверки ниже требуют доступа к реальному тестовому Kubernetes и должны быть заполнены оператором до создания release tag.

Проверки выполняются в тестовом namespace перед использованием в production.

## Подготовка

- подготовить временные Plugin XYPDF по инструкции `DEV_MODE.md`, заменив `#v1.2.0` на `#agent/production-hardening-1.2`;
- импортировать временные копии `xyops.json`, `xyops-hygiene-plugin.json` и `xyops-token-plugin.json`;
- импортировать связанные Workflow в порядке из README;
- применить текущий `manifests/xyops-rbac.yaml` без изменения ServiceAccount;
- задать `KUBE_API_URL`, `KUBE_TOKEN` и CA в Secret Vault;
- выбрать тестовый namespace с Deployment и CronJob;
- подготовить Completed Job и Failed Job, которые разрешено удалить во время проверки cleanup.

## Read-only проверки

- [ ] подключение к Kubernetes API;
- [ ] список namespaces;
- [ ] список Deployments и Pods;
- [ ] list-операция возвращает все объекты при наличии нескольких страниц Kubernetes API;
- [ ] current logs;
- [ ] previous logs для перезапущенного контейнера;
- [ ] диагностика Pod;
- [ ] диагностика Deployment;
- [ ] здоровье namespace;
- [ ] здоровье CronJobs;
- [ ] cleanup preview не изменяет кластер;
- [ ] проверка срока токена не выводит сам token.

## Изменяющие проверки

- [ ] restart тестового Deployment;
- [ ] Job ожидает новую generation, а не старое готовое состояние;
- [ ] ожидание успешного rollout;
- [ ] scale вверх и ожидание Ready replicas;
- [ ] scale обратно;
- [ ] при возможности проверить scale до `0` и возврат исходного количества replicas;
- [ ] cleanup apply с `dry_run=true` ничего не удаляет;
- [ ] cleanup apply без dry run удаляет только заранее подготовленные старые объекты;
- [ ] Running/Pending/Unknown Pods не выбираются;
- [ ] `kube-system` исключён по умолчанию.

## Негативные проверки

- [ ] rollout timeout возвращает последнее состояние Deployment;
- [ ] `ProgressDeadlineExceeded` завершает Job ошибкой;
- [ ] неверный или истёкший token не выводится в Job log;
- [ ] операция без подтверждения restart/scale/cleanup отклоняется.

## Критерий готовности

Все проверки должны завершиться ожидаемым результатом, а в Job output и логах не должно быть ServiceAccount token, содержимого Secret Vault или kubeconfig.

После приёмки зафиксируйте дату, версию Kubernetes, версию xyOps и результат в комментарии PR №5. Затем PR можно переводить в Ready for review и выполнять squash merge.
