# Changelog

## v1.2.0

- добавлена автоматическая Kubernetes API pagination с обработкой `metadata.continue`, лимитом объектов и защитой от повторяющихся токенов;
- restart и scale Deployment теперь по умолчанию ожидают фактическое завершение rollout;
- добавлены проверки `observedGeneration`, количества replicas, updated, ready, available и `ProgressDeadlineExceeded`;
- restart защищён от ложного успеха на предыдущей generation;
- поддержано ожидание scale Deployment до 0 replicas;
- добавлена безопасная локальная проверка срока действия ServiceAccount JWT без вывода исходного токена;
- добавлена команда `npm run acceptance:smoke` для безопасной автоматизации read-only, dry-run, confirmation и опциональных restart/scale проверок на тестовом Kubernetes;
- production XYPDF закреплены на `v1.2.0`;
- добавлены release-процесс, приёмочный checklist и regression-тесты;
- ServiceAccount и RBAC не изменялись.

## v1.0.0

- добавлен Kubernetes REST API client без зависимости от `kubectl`;
- реализованы test connection, namespaces, Deployments, Pods, Events и Pod logs;
- добавлены restart и scale Deployment с обязательным подтверждением;
- добавлена read-only диагностика Pod;
- добавлена подготовка Bucket Menu cache;
- добавлены четыре Event Plugins и два Workflow;
- добавлен ServiceAccount/RBAC manifest;
- добавлены unit и XYPDF regression tests.

## 1.2.0

- Pagination Kubernetes List API.
- Ожидание rollout после restart/scale.
- Проверка срока ServiceAccount JWT.
- Production XYPDF закреплены на tag v1.2.0.
