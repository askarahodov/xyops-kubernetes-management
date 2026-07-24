# Процесс выпуска релиза

1. Убедиться, что версия в `package.json` равна `1.2.0`.
2. Выполнить `npm test`, `npm run check` и `npm pack --dry-run`.
3. Проверить, что production XYPDF используют `#v1.2.0` и не содержат `#main`.
4. Провести проверки из `ACCEPTANCE_TESTS.md` на тестовом кластере.
5. Перевести PR из draft и выполнить squash merge в `main` только после зелёного CI.
6. Создать неизменяемый Git tag `v1.2.0` на squash merge commit.
7. Проверить запуск `npx -y github:askarahodov/xyops-kubernetes-management#v1.2.0`.
8. Импортировать production XYPDF и повторить smoke test подключения.
9. Удалить рабочую ветку.

Существующий release tag нельзя перемещать. Исправление выпускается новой patch-версией.
