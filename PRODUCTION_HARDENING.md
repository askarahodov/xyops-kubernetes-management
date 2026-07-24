# Production Hardening 1.2.0

План релиза без изменения текущего ServiceAccount и RBAC:

- pagination для Kubernetes list API;
- ожидание rollout после restart и scale;
- безопасная проверка срока действия ServiceAccount JWT;
- привязка production XYPDF к стабильному Git tag;
- отдельный dev XYPDF, использующий `#main`;
- приёмочный checklist для тестового кластера.

Текущий ServiceAccount `xyops-kubernetes` и `manifests/xyops-rbac.yaml` остаются без изменений.
