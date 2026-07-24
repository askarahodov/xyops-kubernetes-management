# Roadmap

## 1.2.0 Production Hardening

- [x] pagination Kubernetes list API;
- [x] ожидание rollout после restart/scale;
- [x] проверка срока ServiceAccount JWT;
- [x] production XYPDF на стабильном tag;
- [x] приёмочный checklist;
- [x] release process.

ServiceAccount и текущий RBAC не изменены. Реальная приёмка выполняется по `ACCEPTANCE_TESTS.md` в целевом тестовом кластере.

## Позже

- динамические Bucket Menu;
- multi-cluster profiles;
- расписания и уведомления;
- унифицированный аудит изменяющих операций.
