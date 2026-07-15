# TODO

Список расхождений между фактическим кодом и `CLAUDE.md`, а также найденных багов и мёртвого кода.
Каждый пункт — кандидат на правку. Перед исправлением перепроверить актуальность.

## 🐛 Баги (упадут при использовании)

### 1. ✅ "Delete All Data" удалён из `settings.html`
Сама `TnMStorage.resetAllData()` нигде не была реализована — кнопка падала с `TypeError`. Закрыто вместе с п.9: вместо реализации деструктивной операции в UI поставлен инфо-блок с почтой для контакта (`zelyakin@gmail.com`). Юзеру, которому реально нужно почистить данные, проще написать в поддержку или дёрнуть `TRUNCATE` напрямую в Supabase SQL Editor — чем поддерживать UI с подтверждением, безопасностью от случайного клика и реальной каскадной очисткой.

### 2. ✅ `views/storage-stats.html` удалён
Файл вызывал несуществующие `TnMStorage.getCardDataFromBoard()` и `TnMStorage.MAX_BOARD_ENTRIES`. Был рудиментом эпохи Trello Storage с лимитом 4 КБ на карточку — для Supabase эта метрика неактуальна.

Также удалены: кнопка "View Storage Statistics" в [views/settings.html](views/settings.html) и её обработчик. Заодно ушли последние упоминания мёртвых ключей `tnm-cache-version`, `tnm-known-card-ids`, `tnm-global-reset-timestamp` (раньше читались только в этом файле для подсчёта размера storage) — что окончательно закрывает хвост п.6.

---

## 🧹 Мёртвый код

### 3. ✅ `SupabaseAPI.ensureCard()` — удалён
Метод-заглушка, который безусловно бросал `Error('Card not found and cannot be created without board context')`. Был архитектурным заделом эпохи перехода на `trello_card_id` как глобально уникальный ключ (коммит `7fb49c9`), но не выстрелил — все места чтения работают через прямые `GET /cards?...`, а мутации используют `ensureCardWithBoard()`. Удалён из [js/supabase-api.js](js/supabase-api.js).

### 4. ✅ Legacy-поля в схеме БД — колонки дропнуты (2026-07-11)
**Код** ✅ — больше не селектит и не пишет legacy-поля. После правки `ensureCard*()` в [js/supabase-api.js](js/supabase-api.js) ни одной ссылки на `total_*` (cards) и `days/hours/minutes` (time_entries) в SELECT/INSERT/PATCH не осталось. Чтение `cardData.days/hours/minutes` из удалённого `storage-stats.html` тоже ушло вместе с файлом (см. п.2).

**БД** ✅ — колонки удалены в Supabase после того, как минутный код был выкачен в прод (PR #34):
- `cards.total_days`, `cards.total_hours`, `cards.total_minutes` — удалены
- `time_entries.days`, `time_entries.hours`, `time_entries.minutes` — удалены

**Документация** ✅ — секция `CREATE TABLE` в `README.md` и оговорки про legacy-поля в `CLAUDE.md` обновлены под новую схему.

### 5. ✅ `views/clear-cache.html` — удалён
Был орфаном (не подключён в `manifest.json` / `client.js` / `t.popup`), дублировал кнопки `settings.html`, вызывал несуществующую `TnMStorage.resetAllData()`.

### 6. ✅ `tnm-cache-version` — write-call удалён в `settings.html`
В [views/settings.html](views/settings.html) убрана обёртка `t.set('board','shared','tnm-cache-version', Date.now())` вокруг закрытия попапа после "Clear Cache and Reload" — ключ нигде не читался по существу, оставался от старой схемы инвалидации до появления `tnm-settings-updated`.

Последнее упоминание `'tnm-cache-version'` живёт в [views/storage-stats.html:263](views/storage-stats.html:263) (массив `boardKeys` для подсчёта размера storage) — уйдёт вместе с самим файлом по п.2.

Уже записанные значения в Trello board storage остаются как dead-ключ (одно поле с timestamp на доску) — миграция для зачистки нецелесообразна.

### 12. `isDateInRange()` в `board-stats.html` — мёртвая + латентный TZ-баг
[views/board-stats.html:240](views/board-stats.html:240) `isDateInRange()` нигде не вызывается — фильтрация периода целиком на сервере (`work_date` gte/lte в `getBoardStats`, [js/supabase-api.js:424](js/supabase-api.js:424)). Вдобавок метод парсит date-only `work_date` через `new Date(dateString)` (UTC-полночь) и сравнивает с локально построенными `startDate`/`endDate` — тот же класс TZ off-by-one, что чинили в `formatDate`/`formatDateForAPI` (2026-07-15). Кандидат на удаление; если понадобится клиентская фильтрация — сравнивать календарные строки без `new Date()`.

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

---

## 🎨 Тёмная тема

### 8. ✅ Power-Up адаптирован под dark mode

Цвета централизованы в CSS-переменных в [css/style.css](css/style.css) (`:root` блок), переключаются через `@media (prefers-color-scheme: dark)`. Палитра тёмного режима подобрана под Trello/Atlassian (`#1D2125 / #B6C2CF / #579DFF`). Все view-файлы (`card-detail.html`, `card-back.html`, `board-stats.html`, `export-time.html`, `settings.html`) используют `var(--tnm-*)` — без дублирования media-блоков по каждому файлу. Native form controls подхватывают тему через `color-scheme: light dark`. Все попапы проверены вручную в Trello с тёмной темой.

---

## 🎛 UX

### 9. ✅ Экран настроек пересмотрен

Из [views/settings.html](views/settings.html) удалены:
- **Clear Cache and Reload** — `localStorage.clear()` чистил пустое ведро (Power-Up в localStorage ничего не пишет), а follow-up reload и так пересоздавал in-memory Map'ы. Кнопка делала то же, что обычный F5 на вкладке Trello.
- **Clear API Cache** — чистила те же 5 in-memory Map'ов без reload, но на экране настроек ничего, что от них зависит, не отображается → юзер видел тост "cache cleared" и… ничего. Плюс TTL и так 60 секунд.
- **Delete All Data** — падала с `TypeError` (см. п.1). Удалена вместе с confirmation-диалогом, обработчиками, стилями `.mod-danger`, `.warning-text`, `.confirmation-*`, `.cancel-btn`.

Снизу добавлен нейтральный инфо-блок "Data Removal" с предложением написать на `zelyakin@gmail.com` для полного удаления данных. Высота popup в [js/client.js:144](js/client.js:144) поднята с 300 до 360 — старая высота уже не вмещала контент полностью (попап скроллился), новая компоновка влезает без скролла.

Финальный экран: Display Settings (select 8h/24h + Save) → separator → Data Removal (контактный текст).

---

## 📤 Экспорт

### 10. ✅ Имена архивных/удалённых карточек в CSV (Trello REST)

Было: имя карточки бралось только из `t.cards('all')`, который возвращает **лишь открытые** карточки доски. Архивные и удалённые выгружались как `Card <id>` и были неотличимы друг от друга.

Стало ([views/export-time.html](views/export-time.html)): для карточек, которых нет в `t.cards('all')`, имя достаётся через **Trello REST** (`GET /1/cards/{id}?fields=name,closed`):
- `200 + closed:true` → `[archived] <name>`
- `200 + closed:false` → `<name>` (карточка открыта — напр. перенесена на другую доску)
- `404` → `[deleted] <id>`
- ошибка/отказ от авторизации/нет ключа → фолбэк `Card <id>` (экспорт не ломается)

Авторизация **opt-in, ленивая и read-only**: резолв включается галкой «Resolve names of archived/deleted cards» в форме экспорта (по умолчанию **выкл**). Без галки экспорт вообще не трогает REST/авторизацию, off-board → `Card <id>`. С галкой и при наличии off-board карточек → `authorize({scope:'read', expiration:'30days'})` вызывается прямым кликом (иначе браузер блокирует попап). Токен хранит клиентская библиотека Trello (member-private), у нас не оседает. Статус кодируется префиксом к имени — отдельной колонки нет (по решению).

⚠️ **UX-нюанс (решён):** `read`-скоуп у Trello даёт токен на чтение **всего аккаунта** (пер-бордового скоупа в этом флоу нет), consent-экран пишет «доступ к аккаунту» — на месте пользователя это отпугивает. Решение: резолв сделан **opt-in** (дефолтный экспорт авторизацию не триггерит вообще); текст промпта заранее предупреждает про account-level; токен на 30 дней с отзывом в любой момент. Промпт при показе прячет форму фильтра (не уезжает под фолд), debug-панель убрана из UI в консоль.

⚠️ **Требуется разовая настройка:** вставить публичный API-ключ Power-Up'а в `TRELLO_API_KEY` ([views/export-time.html](views/export-time.html)) и добавить origin в Allowed origins ключа. См. README → Configuration → Trello REST API. До установки ключа фича неактивна, экспорт работает по-старому.

### 11. Флажки типов карточек в экспорте (на будущее)

Идея: чекбоксы «выгружать / не выгружать» для категорий — открытые / архивные / удалённые (off-board). Сейчас есть только «Include cards without time tracking data». После п.10 классификация уже вычисляется (on-board vs `[archived]`/`[deleted]`), так что тумблеры лягут поверх готовой логики фильтрации.

---

## 📝 Документация (`CLAUDE.md`)

Эти пункты уже исправлены в `CLAUDE.md` — оставлены здесь как чек-лист на случай, если понадобится сверить:

- ✅ Добавлены недостающие view-файлы (`clear-cache.html`, `storage-stats.html`) с пометкой об их статусе.
- ✅ Уточнён поток `getBoardSettings()` — он внутри вызывает `getBoardId()`, поэтому при холодном старте это 2 запроса (`/boards` + `/board_settings`), а не 1.
- ✅ Уточнено количество запросов для card detail popup (2 при тёплом кэше, до 4 при холодном).
- ✅ Удалено упоминание о "deprecated" legacy-полях из активного описания — после правки п.4 их вообще не будет в коде.
