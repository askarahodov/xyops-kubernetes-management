# Production Hardening 1.2.0

Релиз добавляет pagination Kubernetes List API, ожидание готовности Deployment после restart/scale и безопасную проверку срока JWT. Production XYPDF используют неизменяемый tag `v1.2.0`. ServiceAccount и RBAC не изменены.

## Pagination

Все базовые списки и операции Hygiene автоматически следуют `metadata.continue`, ограничивают число страниц и защищены от повторяющегося continue token.

## Rollout wait

Restart и scale по умолчанию ожидают `observedGeneration`, updated, ready и available replicas. Поддерживается scale до 0. Ошибки `ProgressDeadlineExceeded` и тайм-аут завершают Job ошибкой.

## Token expiry

Операция читает только claims `sub`, `iat` и `exp`; исходный token не выводится.
