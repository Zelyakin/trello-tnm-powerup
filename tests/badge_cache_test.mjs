// Тест инвалидации кэша бейджей по метке tnm-lastUpdate.
// Запуск:  node tests/badge_cache_test.mjs
//
// Проверяет сценарий "добавил время в попапе — бейдж на доске должен обновиться":
// это разные iframe'ы с независимыми кэшами, попап чистит только свой.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../js/supabase-api.js', import.meta.url), 'utf8');

function load(board) {
    const stats = { requests: [] };
    // board — { trelloCardId: минуты }; в префетч попадают только карточки с временем > 0.
    const state = { board };

    const fetchImpl = async (url) => {
        // Обмен токена: считаем его отдельно от запросов к данным, иначе он смазывал бы
        // счётчик, ради которого тест и написан.
        if (String(url).includes('/functions/v1/trello-auth')) {
            return { ok: true, status: 200,
                     json: async () => ({ token: 'test-token',
                                          expiresAt: Math.floor(Date.now() / 1000) + 3600 }) };
        }
        stats.requests.push(String(url));
        const rows = Object.entries(state.board)
            .filter(([, m]) => m > 0)
            .map(([trello_card_id, time_minutes]) => ({ trello_card_id, time_minutes }));
        return { ok: true, status: 200, json: async () => rows };
    };

    const ctx = { console: { log() {}, warn() {}, error() {} }, fetch: fetchImpl,
                  Date, JSON, Math, Promise, Map, Error, setTimeout,
                  window: { addEventListener() {} } };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\n;globalThis.__api = SupabaseAPI;', ctx);

    const api = ctx.__api;
    // Без контекста Trello request() падает: фолбэка на anon-ключ больше нет.
    api.useTrelloContext({ jwt: async () => 'trello.jwt.here' });
    // Board id резолвится тем же mock-фетчем; кладём готовым, чтобы не считать лишний запрос.
    api._boardIdCache.set('board_B', { boardId: 'uuid-B', timestamp: Date.now() });
    return { api, stats, state };
}

let fails = 0;
const check = (n, ok, d = '') => {
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? ' — ' + d : ''}`); if (!ok) fails++;
};

// 1. Холодный старт: префетч и значение из него.
{
    const { api, stats } = load({ c1: 100 });
    const data = await api.getCardDataForBadge('c1', 'B', 0);
    check('холодный старт: значение из префетча', data.timeMinutes === 100, `${data.timeMinutes}`);
    check('холодный старт: один запрос', stats.requests.length === 1, `${stats.requests.length}`);
}

// 2. Повтор без метки — из кэша, без запросов.
{
    const { api, stats } = load({ c1: 100 });
    await api.getCardDataForBadge('c1', 'B', 0);
    const before = stats.requests.length;
    const data = await api.getCardDataForBadge('c1', 'B', 0);
    check('повтор без метки: запросов не добавилось',
        stats.requests.length === before && data.timeMinutes === 100, `${stats.requests.length}`);
}

// 3. Карточка, у которой время УЖЕ было: метка новее → перечитали.
{
    const { api, stats, state } = load({ c1: 100 });
    await api.getCardDataForBadge('c1', 'B', 0);
    state.board.c1 = 160;                       // попап добавил время
    const stamp = Date.now() + 1000;            // метка заведомо новее момента кэширования
    const data = await api.getCardDataForBadge('c1', 'B', stamp);
    check('метка новее → бейдж обновился', data.timeMinutes === 160, `${data.timeMinutes}`);
    check('перечитали одним запросом', stats.requests.length === 2, `${stats.requests.length}`);
}

// 4. Ключевой случай: карточка БЕЗ времени. В префетч она не попадала и записи в кэше не
//    имеет — сброса одной лишь записи было бы мало, нужен сброс метки префетча.
{
    const { api, stats, state } = load({ c1: 100, c2: 0 });
    const zero = await api.getCardDataForBadge('c2', 'B', 0);
    check('карточка без времени: ноль без запроса',
        zero.timeMinutes === 0 && stats.requests.length === 1, `${stats.requests.length}`);

    state.board.c2 = 30;                        // первая запись на эту карточку
    const stamp = Date.now() + 1000;
    const data = await api.getCardDataForBadge('c2', 'B', stamp);
    check('первое время на пустой карточке показалось', data.timeMinutes === 30, `${data.timeMinutes}`);
}

// 5. Метка СТАРШЕ момента кэширования (изменение было давно) — кэш не сбрасываем.
{
    const { api, stats } = load({ c1: 100 });
    const stamp = Date.now() - 60_000;
    await api.getCardDataForBadge('c1', 'B', stamp);
    const before = stats.requests.length;
    await api.getCardDataForBadge('c1', 'B', stamp);
    check('старая метка не сбрасывает кэш', stats.requests.length === before, `${stats.requests.length}`);
}

console.log(fails === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
