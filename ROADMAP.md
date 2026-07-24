# Roadmap

## 1.2.0 Production Hardening — реализовано

- Kubernetes API pagination;
- ожидание rollout после restart и scale;
- проверка срока ServiceAccount JWT;
- production XYPDF на стабильном tag;
- release process и приёмочный checklist;
- unit, syntax и package regression checks.

ServiceAccount и текущий RBAC не изменялись по принятому решению проекта.

## Release gates

Перед созданием tag `v1.2.0` необходимо пройти `ACCEPTANCE_TESTS.md` на реальном тестовом Kubernetes. Это внешний этап приёмки, а не незавершённая реализация кода.

## Позже

- динамические Bucket Menu;
- multi-cluster profiles;
- расписания и уведомления;
- унифицированный аудит изменяющих операций.
