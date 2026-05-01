# TODO

Список расхождений между фактическим кодом и `CLAUDE.md`, а также найденных багов и мёртвого кода.
Каждый пункт — кандидат на правку. Перед исправлением перепроверить актуальность.

## 🐛 Баги (упадут при использовании)

### 1. Отсутствует `TnMStorage.resetAllData()`
**Где вызывается:**
- `views/settings.html:329` — кнопка "Delete All Data" (видна пользователю).
- `views/clear-cache.html:222` — аналогичная кнопка.

**Что происходит:** при клике — `TypeError: TnMStorage.resetAllData is not a function`.

**Что делать (на выбор):**
- **a)** Реализовать функцию: каскадно удалить из Supabase `time_entries` → сбросить `time_minutes` в `cards` → инвалидировать кэш. Учесть, что `boards` и `board_settings` оставлять не нужно — иначе настройки `hours_per_day` обнулятся.
- **b)** Просто убрать кнопку и подтверждающий диалог из `settings.html` (см. также пункт 6 — общий пересмотр экрана настроек).

В `settings.html:327` уже стоит `// TODO: Добавить функцию для удаления данных из Supabase` — задача висит давно.

### 2. `views/storage-stats.html` целиком сломан
Использует функции, которых нет в `js/storage.js`:
- `TnMStorage.getCardDataFromBoard(t, cardId)` — `views/storage-stats.html:284, 399`
- `TnMStorage.MAX_BOARD_ENTRIES` — `views/storage-stats.html:418, 419`

Открывается из `settings.html` по кнопке "View Storage Statistics" (`views/settings.html:260`).

**Что делать:** удалить `views/storage-stats.html` и кнопку открытия в `settings.html`.
Файл — рудимент эпохи Trello Storage (когда был лимит 4096 байт на карточку).
В минутном Supabase-хранилище понятие "статистики занятого места" неактуально.

---

## 🧹 Мёртвый код

### 3. `SupabaseAPI.ensureCard()` — заглушка, всегда бросает исключение
`js/supabase-api.js:74-95`. Метод определён, но безусловно бросает `Error('Card not found and cannot be created without board context')`. Нигде не вызывается — везде используется `ensureCardWithBoard()`.

**Что делать:** удалить целиком.

### 4. Legacy-поля `total_days`, `total_hours`, `total_minutes` всё ещё селектятся
`js/supabase-api.js:78, 102, 129` — в `ensureCard()` и `ensureCardWithBoard()` запрашиваются поля, которые после перехода на минутное хранение нигде не читаются (всё работает через `time_minutes`).

**Что делать:**
- Заменить `select=id,trello_card_id,total_days,total_hours,total_minutes` → `select=id,trello_card_id`.
  (`time_minutes` тоже нет в этих SELECT-ах, но он и не нужен в `ensureCard*` — там нужен только `id` для FK.)
- Опционально: после периода стабилизации удалить колонки из таблицы `cards` (миграция в Supabase).

### 5. `views/clear-cache.html` — полностью орфанный
Файл не указан ни в `manifest.json`, ни в `client.js`, ни в одном `t.popup({url: ...})` других views. Также содержит сломанный вызов `TnMStorage.resetAllData()` (см. п.1) и дублирует кнопку очистки кэша из `settings.html`.

**Что делать:** удалить файл.

### 6. `tnm-cache-version` — пишется, но не читается
Устанавливается в `views/clear-cache.html:191`, `views/settings.html:282`, `views/storage-stats.html:263`. Ни одного `t.get(..., 'tnm-cache-version', ...)` в коде нет. Видимо, осталось от старой схемы инвалидации до появления `tnm-settings-updated`.

**Что делать:** удалить все `t.set` с этим ключом.

---

## ⚡ Оптимизация запросов к Supabase

### 7. Перевести оставшиеся запросы на batch-режим
В прошлой итерации мы уже сильно сократили число запросов (см. CLAUDE.md "Performance Notes" — с 48 до 12 на загрузку доски, `getBoardStats()` с N+2 до 3). Но часть мест осталась с N+1 паттерном или избыточными вызовами.

#### 7.1. `getAllDataForExport()` — N+1 в чистом виде
[js/supabase-api.js:385-425](js/supabase-api.js:385) — после получения списка карточек идёт **последовательный** цикл:
```javascript
for (const card of cards) {
    const timeEntries = await SupabaseAPI.request(`time_entries?...&card_id=eq.${card.id}`);
    exportData.push({ cardId: card.trello_card_id, timeEntries });
}
```
Для доски на 50 карточек = **51 запрос** последовательно (заметная задержка перед скачиванием CSV).

**Решение** — тот же приём, что в `getBoardStats()`:
```javascript
const cardIds = cards.map(c => c.id);
const allEntries = await this.request(
  `time_entries?select=time_minutes,description,work_date,member_name,card_id&card_id=in.(${cardIds.join(',')})&work_date=gte.${start}&work_date=lte.${end}&order=work_date.desc`
);
// Сгруппировать на клиенте по card_id
const byCard = new Map();
allEntries.forEach(e => {
  if (!byCard.has(e.card_id)) byCard.set(e.card_id, []);
  byCard.get(e.card_id).push(e);
});
const exportData = cards.map(c => ({
  cardId: c.trello_card_id,
  timeEntries: byCard.get(c.id) || []
}));
```
Итог: **2 запроса вместо N+1** независимо от размера доски.

⚠️ Нюанс: при очень большом числе карточек `in.(...)` может упереться в лимит длины URL (~8 КБ у PostgREST по умолчанию). Если на досках бывает >500 карточек — стоит чанковать `cardIds` пачками по ~200 и параллелить через `Promise.all`. Для типичных досок не актуально.

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
