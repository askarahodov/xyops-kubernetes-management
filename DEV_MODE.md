# Режим разработки и приёмки до релиза

Production XYPDF закреплены на tag `v1.2.0`. До создания этого tag их нельзя импортировать без временной замены команды плагина.

Для проверки PR №5 создайте локальные копии импортируемых Plugin-файлов и замените:

```text
#v1.2.0
```

на рабочую ветку:

```text
#agent/production-hardening-1.2
```

Пример:

```bash
cp xyops.json /tmp/xyops-dev.json
cp xyops-hygiene-plugin.json /tmp/xyops-hygiene-plugin-dev.json
cp xyops-token-plugin.json /tmp/xyops-token-plugin-dev.json

sed -i 's/#v1\.2\.0/#agent\/production-hardening-1.2/g' \
  /tmp/xyops-dev.json \
  /tmp/xyops-hygiene-plugin-dev.json \
  /tmp/xyops-token-plugin-dev.json
```

Импортируйте временные файлы только в тестовый xyOps. Workflow-файлы менять не требуется: они ссылаются на Plugin ID, а не на Git ref.

После успешной приёмки и создания tag `v1.2.0` удалите временные dev-файлы и повторно импортируйте production XYPDF из репозитория.

Не используйте `#main` для приёмки PR: до merge ветка `main` содержит предыдущую версию плагина.
