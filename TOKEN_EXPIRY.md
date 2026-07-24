# Проверка срока ServiceAccount token

Файлы:

- `token.js` — локальный разбор JWT claims;
- `workflow-token-expiry.json` — ручной xyOps Workflow;
- Event Plugin `Kubernetes — Проверить срок токена`.

Workflow читает `KUBE_TOKEN` из Secret Vault, декодирует только JWT payload и возвращает:

```text
subject
issued_at
expires_at
remaining_seconds
remaining_hours
expired
rotation_required
reason
```

Исходный token не включается в таблицу, Job data, description или error details.

Параметр `rotation_threshold_hours` определяет, за сколько часов нужно включить `rotation_required=true`. По умолчанию используется 24 часа.

Проверка локальная и не подтверждает, что token ещё не отозван сервером. Для полной проверки после неё запускайте `Проверить подключение`.
