# TODO

Список расхождений между фактическим кодом и `CLAUDE.md`, а также найденных багов и мёртвого кода.
Каждый пункт — кандидат на правку. Перед исправлением перепроверить актуальность.

## 🐛 Баги (упадут при использовании)

### 1. Отсутствует `TnMStorage.resetAllData()`
**Где вызывается:**
- `views/settings.html:329` — кнопка "Delete All Data" (видна пользователю).

**Что происходит:** при клике — `TypeError: TnMStorage.resetAllData is not a function`.

**Что делать (на выбор):**
- **a)** Реализовать функцию: каскадно удалить из Supabase `time_entries` → сбросить `time_minutes` в `cards` → инвалидировать кэш. Учесть, что `boards` и `board_settings` оставлять не нужно — иначе настройки `hours_per_day` обнулятся.
- **b)** Просто убрать кнопку и подтверждающий диалог из `settings.html` (см. также пункт 6 — общий пересмотр экрана настроек).

В `settings.html:327` уже стоит `// TODO: Добавить функцию для удаления данных из Supabase` — задача висит давно.

### 2. ✅ `views/storage-stats.html` удалён
Файл вызывал несуществующие `TnMStorage.getCardDataFromBoard()` и `TnMStorage.MAX_BOARD_ENTRIES`. Был рудиментом эпохи Trello Storage с лимитом 4 КБ на карточку — для Supabase эта метрика неактуальна.

Также удалены: кнопка "View Storage Statistics" в [views/settings.html](views/settings.html) и её обработчик. Заодно ушли последние упоминания мёртвых ключей `tnm-cache-version`, `tnm-known-card-ids`, `tnm-global-reset-timestamp` (раньше читались только в этом файле для подсчёта размера storage) — что окончательно закрывает хвост п.6.

---

## 🧹 Мёртвый код

### 3. ✅ `SupabaseAPI.ensureCard()` — удалён
Метод-заглушка, который безусловно бросал `Error('Card not found and cannot be created without board context')`. Был архитектурным заделом эпохи перехода на `trello_card_id` как глобально уникальный ключ (коммит `7fb49c9`), но не выстрелил — все места чтения работают через прямые `GET /cards?...`, а мутации используют `ensureCardWithBoard()`. Удалён из [js/supabase-api.js](js/supabase-api.js).

### 4. Legacy-поля в схеме БД (колонки можно удалять)
**Код** ✅ — больше не селектит и не пишет legacy-поля. После правки `ensureCard*()` в [js/supabase-api.js](js/supabase-api.js) ни одной ссылки на `total_*` (cards) и `days/hours/minutes` (time_entries) в SELECT/INSERT/PATCH не осталось. Чтение `cardData.days/hours/minutes` из удалённого `storage-stats.html` тоже ушло вместе с файлом (см. п.2).

**БД** — осталось дропнуть колонки. Все объявлены как `INTEGER DEFAULT 0` без `NOT NULL`, никем не читаются и не пишутся, безопасны к удалению:
- `cards.total_days`, `cards.total_hours`, `cards.total_minutes`
- `time_entries.days`, `time_entries.hours`, `time_entries.minutes`

⚠️ **Порядок миграции:** сначала выкатить текущую версию кода (без SELECT-ов на legacy-поля) в прод и убедиться, что всё работает, и **только потом** дропать колонки. Иначе старая прод-версия, ещё селектящая `total_*`, начнёт получать ошибки от PostgREST.

Миграция (в Supabase SQL Editor, **после прод-деплоя**):
```sql
ALTER TABLE cards
  DROP COLUMN total_days,
  DROP COLUMN total_hours,
  DROP COLUMN total_minutes;

ALTER TABLE time_entries
  DROP COLUMN days,
  DROP COLUMN hours,
  DROP COLUMN minutes;
```

После выполнения — обновить `README.md:131-160` (секция CREATE TABLE), убрав описание legacy-полей.

### 5. ✅ `views/clear-cache.html` — удалён
Был орфаном (не подключён в `manifest.json` / `client.js` / `t.popup`), дублировал кнопки `settings.html`, вызывал несуществующую `TnMStorage.resetAllData()`.

### 6. ✅ `tnm-cache-version` — write-call удалён в `settings.html`
В [views/settings.html](views/settings.html) убрана обёртка `t.set('board','shared','tnm-cache-version', Date.now())` вокруг закрытия попапа после "Clear Cache and Reload" — ключ нигде не читался по существу, оставался от старой схемы инвалидации до появления `tnm-settings-updated`.

Последнее упоминание `'tnm-cache-version'` живёт в [views/storage-stats.html:263](views/storage-stats.html:263) (массив `boardKeys` для подсчёта размера storage) — уйдёт вместе с самим файлом по п.2.

Уже записанные значения в Trello board storage остаются как dead-ключ (одно поле с timestamp на доску) — миграция для зачистки нецелесообразна.

---

## ⚡ Оптимизация запросов к Supabase

### 7. Перевести оставшиеся запросы на batch-режим
В прошлой итерации мы уже сильно сократили число запросов (см. CLAUDE.md "Performance Notes" — с 48 до 12 на загрузку доски). Но часть мест оставалась с N+1 паттерном или избыточными вызовами.

#### 7.1. ✅ `getAllDataForExport()` — устранён N+1
Было: после `GET /cards` шёл **последовательный** цикл `for (const card of cards) { await GET /time_entries?card_id=eq.{card.id} }` — для доски на 50 карточек 51 запрос подряд.

Стало: 2 **параллельных** запроса (`Promise.all`) — список карточек и записи времени через PostgREST embedded resource (`cards!inner(trello_card_id) + cards.board_id=eq.X`). JOIN выполняется на стороне Supabase, никаких `in.(cardIds)` → нет лимита длины URL независимо от размера доски. Группировка по `trello_card_id` на клиенте, UUID Supabase наружу не утекают. Пустые карточки сохраняются как `timeEntries: []` (для UI-флага "Include empty cards").

#### 7.1.1. ✅ `getBoardStats()` — снят URL-лимит и ушёл лишний запрос
Было: 3 запроса (`/boards` → `/cards` → `/time_entries` с `in.(cardIds)`). При >500 карточках на доске `in.(...)` упирался в лимит длины URL у PostgREST (~8 КБ).

Стало: тот же приём, что и в 7.1, но даже агрессивнее — `/cards` вообще не нужен (статистика считается только из entries: totals, distinct card_id, contributors). 1 запрос к `/time_entries` через embedded JOIN (`cards!inner(id) + cards.board_id=eq.X`). Пустая доска / пустой период → `entries=[]` → корректный нулевой ответ без специального early-return. **Итог: 1 запрос warm / 2 cold.**

#### 7.2. Бейджи: N запросов на N карточек (потенциальная оптимизация)
[js/client.js:22-41](js/client.js:22) — Trello вызывает callback `card-badges` отдельно для каждой карточки, и каждый вызов делает свой `GET /cards?select=time_minutes&trello_card_id=eq.{id}`. Для доски на 100 карточек = 100 запросов к `/cards`.

**Идея:** при первом обращении к бейджу префетчить агрегаты для **всех** карточек доски одним запросом и положить в `_cardDataCache`:
```javascript
// При первом вызове getCardDataForBadge на этой доске:
const allCards = await this.request(
  `cards?select=trello_card_id,time_minutes&board_id=eq.${supabaseBoardId}`
);
allCards.forEach(c => this._cardDataCache.set(`badge_${c.trello_card_id}`, {
  data: { timeMinutes: c.time_minutes || 0, history: [] },
  timestamp: Date.now()
}));
```
Все последующие 99 callback'ов будут попадать в кэш. **100 запросов → 1 запрос.**

⚠️ Нюансы:
- Нужен флаг "префетч уже был для этой доски в этом TTL-окне" (`_boardPrefetched: Map<boardId, timestamp>`), иначе каждая карточка снова запустит full-board запрос.
- Promise deduplication (как в `getBoardId()`) обязательна — иначе при параллельном вызове 100 callback'ов мы получим 100 одинаковых full-board запросов.
- Размер ответа растёт линейно с числом карточек, но `time_minutes` — это int, ответ остаётся компактным даже для больших досок.
- Trello может вызывать badge callback и для карточек, которых ещё нет в Supabase (новые карточки) — для них должен возвращаться `{ timeMinutes: 0 }`, что и так корректно работает через текущий fallback.

#### 7.3. Объёмы передаваемой информации — выглядит уже хорошо, но проверить
Все основные SELECT-ы уже используют явные списки полей (`?select=time_minutes,...`), `Prefer: return=minimal` стоит на мутациях. Что осталось проверить:
- `ensureCard*()` всё ещё селектит legacy `total_*` (см. п.4 — пересекается с этой задачей).
- В `getCardDataFull()` ([js/supabase-api.js:215](js/supabase-api.js:215)) запрашивается `created_at` и используется и как `id`, и как `date` — лишний раунд-трип данных, но это уже микрооптимизация.

---

## 🎨 Тёмная тема

### 8. Power-Up не адаптирован под dark mode Trello
**Симптом (со слов пользователей):** часть окон/надписей становится нечитаемой — либо тёмный текст на тёмном фоне, либо наоборот фоны popup'ов остаются белыми и выбиваются из общего вида Trello.

**Текущее состояние:**
- Единственная поддержка темы — иконки `board-buttons` в [js/client.js:111-126](js/client.js:111) (раздельные `dark`/`light` SVG для Export и Stats).
- Во всех view-файлах и в `css/style.css` цвета захардкожены под светлую тему:
  - `color: #172B4D` (тёмный текст) — в `.confirmation-title`, `<h2>`, основной типографике.
  - `background-color: white` — в `.confirmation-content` (диалоги подтверждения в `settings.html`, `card-detail.html`, `clear-cache.html`).
  - `background-color: #F4F5F7` — в `.stats-overview`.
  - `color: #5E6C84` / `#0079BF` / `#CF513D` — статусные/инфо-надписи.
- Ни одного `@media (prefers-color-scheme: dark)` в проекте.
- Не используются CSS-переменные темы Trello (`--ds-background-default`, `--ds-text` и т.п. из Atlassian Design System).

**Что делать:**
- **a)** Простой путь — добавить `@media (prefers-color-scheme: dark)` блоки в `css/style.css` и в inline-стили каждого view с переопределением фонов (`white` → тёмный) и текста (`#172B4D` → светлый). Минимум для проверки: confirmation-диалоги, `.stats-overview`, основная типографика.
- **b)** Правильный путь — отказаться от хардкода цветов в пользу CSS-переменных Trello/ADS, чтобы стили автоматически следовали за темой контейнера. Список переменных: см. документацию Trello Power-Up + [Atlassian Design Tokens](https://atlassian.design/tokens/design-tokens).
- Проверить все view: `card-detail.html`, `card-back.html`, `board-stats.html`, `export-time.html`, `settings.html` — у каждого свой блок `<style>` с собственными цветами, нужна сквозная унификация.
- Не забыть про confirmation-диалоги с `background-color: white` — они особенно режут глаз в dark mode.
- Протестировать в Trello с включённой dark theme на каждом popup'е.

---

## 🎛 UX

### 9. Пересмотреть экран настроек `views/settings.html` целиком
По итогам анализа похоже, что половина кнопок там устарела или дублирует функционал. Кандидаты на удаление/пересмотр:

| Кнопка | Текущее поведение | Проблема |
|---|---|---|
| **Save Settings** (8h/24h) | Работает корректно | Оставить — основная функция экрана |
| **Clear Cache and Reload** | `localStorage.clear()` + `SupabaseAPI.clearCache()` + reload | `localStorage` Power-Up'ом не используется (см. CLAUDE.md, "Why not localStorage"). Reload и так чистит in-memory кэш. Кнопка избыточна. |
| **Clear API Cache** | `SupabaseAPI.clearCache()` без reload | После очистки UI не обновляется → пользователь не видит эффекта. Сомнительная польза. |
| **View Storage Statistics** | Открывает `storage-stats.html` | Сломан (см. п.2). Сама метрика "сколько байт занято" неактуальна — данные в Supabase, а не в Trello Storage с лимитом 4 КБ. |
| **Delete All Data** | Падает с `TypeError` (см. п.1) | Либо реализовать, либо убрать. |

**Предложение:** оставить только секцию "Display Settings" (8h/24h). Всё остальное либо удалить, либо переработать (например, "Delete All Data" может быть полезна, но требует реализации).

После чистки экран станет компактным — высота popup в `client.js:144` (`height: 300`) скорее всего станет избыточной.

---

## 📝 Документация (`CLAUDE.md`)

Эти пункты уже исправлены в `CLAUDE.md` — оставлены здесь как чек-лист на случай, если понадобится сверить:

- ✅ Добавлены недостающие view-файлы (`clear-cache.html`, `storage-stats.html`) с пометкой об их статусе.
- ✅ Уточнён поток `getBoardSettings()` — он внутри вызывает `getBoardId()`, поэтому при холодном старте это 2 запроса (`/boards` + `/board_settings`), а не 1.
- ✅ Уточнено количество запросов для card detail popup (2 при тёплом кэше, до 4 при холодном).
- ✅ Удалено упоминание о "deprecated" legacy-полях из активного описания — после правки п.4 их вообще не будет в коде.
