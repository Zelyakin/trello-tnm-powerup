# Serverless-часть Power-Up'а

Функция `trello-auth` меняет подписанный Trello JWT на короткоживущий Supabase-токен с клеймом
`trello_board_id`, по которому режут доступ политики RLS. Зачем и как — [PLAN_SECURITY.md](../PLAN_SECURITY.md).

## Состав

| Путь | Что это |
|---|---|
| `functions/trello-auth/index.ts` | сама функция |
| `functions/trello-auth/smoke.ts` | локальный смоук-тест (сеть и порт не нужны) |
| `config.toml` | `verify_jwt = false` для этой функции |
| `sql/01_authenticated_policies.sql` | политики для роли `authenticated` — безопасно применять заранее |
| `sql/02_cutover_lock_anon.sql` | отрезание `anon` — **последним шагом** |
| `sql/03_time_entries_update.sql` | политика `UPDATE` на `time_entries` — нужна для редактирования записей (v3.8) |
| `sql/99_rollback.sql` | аварийный откат |

## Политики RLS

Скрипты из `sql/` применяются вручную: Dashboard → SQL Editor. `01` и `02` — часть выката
авторизации (порядок и условия — в [PLAN_SECURITY.md](../PLAN_SECURITY.md)), `03` добавляет
`UPDATE` на `time_entries` и нужен для редактирования записей времени. Все скрипты идемпотентны
и обёрнуты в транзакцию — повторный прогон безопасен.

Если `03` не применён, правка записи в попапе падает с «Entry not found»: без политики UPDATE
строка не видна для правки, и PostgREST отвечает `200` с пустым массивом, а не ошибкой. В консоли
браузера в этом случае будет прямая подсказка про этот файл.

## Локальная проверка

```bash
deno run -A supabase/functions/trello-auth/smoke.ts
```

## Деплой

```bash
brew install supabase/tap/supabase
```

```bash
supabase login
```

```bash
supabase link --project-ref tpzbvdyxmzqweoghtgzp
```

Секреты — через файл, а не аргументами командной строки: иначе JWT-секрет осядет в истории шелла.

```bash
cp supabase/.env.secrets.example supabase/.env.secrets
```

Подставить `APP_JWT_SECRET` (Dashboard → Settings → API → JWT Settings → JWT Secret), затем:

```bash
supabase secrets set --env-file supabase/.env.secrets
```

```bash
supabase functions deploy trello-auth
```

Если версия CLI игнорирует `config.toml`, добавить флаг: `supabase functions deploy trello-auth --no-verify-jwt`.
Проверить, что применилось: Dashboard → Edge Functions → trello-auth → **Verify JWT = off**.

## Проверка после деплоя

Нужен настоящий Trello-JWT. Открыть на доске попап T&M, в devtools переключить контекст на iframe
попапа и выполнить:

```javascript
t.jwt().then(console.log)
```

Затем (токен — в одинарных кавычках, он длинный):

```bash
curl -s -X POST https://tpzbvdyxmzqweoghtgzp.supabase.co/functions/v1/trello-auth -H 'content-type: application/json' -H 'Origin: https://trello-tnm-powerup.pages.dev' -d '{"token":"<Trello JWT>"}'
```

Ожидаем `{"token":"…","expiresAt":…}`. Полезно разобрать выданный токен на jwt.io и убедиться, что
`trello_board_id` — это id той самой доски, а `role` = `authenticated`.

Негативные проверки: `-d '{"token":"мусор"}'` → `401`, пустое тело `-d '{}'` → `400`.
