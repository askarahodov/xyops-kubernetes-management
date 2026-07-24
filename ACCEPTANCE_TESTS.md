# Приёмочные проверки Kubernetes-плагина

Проверки выполняются в тестовом namespace перед использованием в production.

## Подготовка

- импортировать `xyops.json` и `xyops-hygiene-plugin.json`;
- импортировать связанные Workflow;
- применить текущий `manifests/xyops-rbac.yaml` без изменения ServiceAccount;
- задать `KUBE_API_URL`, `KUBE_TOKEN` и CA в Secret Vault;
- создать тестовые Deployment, CronJob, Completed Job и Failed Job.

## Read-only проверки

- [ ] подключение к Kubernetes API;
- [ ] список namespaces;
- [ ] список Deployments и Pods;
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
- [ ] ожидание успешного rollout;
- [ ] scale вверх и ожидание Ready replicas;
- [ ] scale обратно;
- [ ] cleanup apply с `dry_run=true` ничего не удаляет;
- [ ] cleanup apply без dry run удаляет только заранее подготовленные старые объекты;
- [ ] Running/Pending/Unknown Pods не выбираются;
- [ ] `kube-system` исключён по умолчанию.

## Критерий готовности

Все проверки должны завершиться успешно, а в Job output и логах не должно быть ServiceAccount token, содержимого Secret Vault или kubeconfig.
