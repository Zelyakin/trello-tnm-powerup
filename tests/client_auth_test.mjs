// Тест клиентской части авторизации: подмена t.jwt() и fetch, без браузера.
// Запуск:  node tests/client_auth_test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../js/supabase-api.js', import.meta.url), 'utf8');
const ANON_PREFIX = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

function load({ jwt, mintStatus = 200, allowFallback = true } = {}) {
    const stats = { mints: 0, restCalls: [], jwtCalls: 0 };

    const fetchImpl = async (url, config) => {
        if (String(url).includes('/functions/v1/trello-auth')) {
            stats.mints++;
            if (mintStatus !== 200) {
                return { ok: false, status: mintStatus, text: async () => 'boom' };
            }
            return {
                ok: true, status: 200,
                json: async () => ({ token: `minted-${stats.mints}`,
                                     expiresAt: Math.floor(Date.now() / 1000) + 3600 })
            };
        }
        stats.restCalls.push({ url: String(url), auth: config.headers.Authorization });
        return { ok: true, status: 200, json: async () => [] };
    };

    const ctx = { console: { log() {}, warn() {}, error() {} }, fetch: fetchImpl,
                  Date, JSON, Math, Promise, Map, Error, setTimeout, window: { addEventListener() {} } };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\n;globalThis.__api = SupabaseAPI;', ctx);

    const api = ctx.__api;
    api.ALLOW_ANON_FALLBACK = allowFallback;
    if (jwt !== null) {
        api.useTrelloContext({ jwt: async () => { stats.jwtCalls++; return 'trello.jwt.here'; } });
    }
    return { api, stats };
}

let fails = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails++;
};

// 1. Холодный старт: обмен произошёл, в заголовок ушёл минченный токен.
{
    const { api, stats } = load();
    await api.request('cards?select=id');
    check('холодный старт: один обмен', stats.mints === 1, `mints=${stats.mints}`);
    check('в Authorization минченный токен',
        stats.restCalls[0].auth === 'Bearer minted-1', stats.restCalls[0].auth);
}

// 2. Повторный запрос в пределах TTL — обмена нет.
{
    const { api, stats } = load();
    await api.request('cards?select=id');
    await api.request('cards?select=id');
    await api.request('time_entries?select=id');
    check('кэш токена: обмен один на три запроса', stats.mints === 1, `mints=${stats.mints}`);
}

// 3. Дедупликация: 30 параллельных запросов (сценарий бейджей) → один обмен.
{
    const { api, stats } = load();
    await Promise.all(Array.from({ length: 30 }, () => api.request('cards?select=id')));
    check('дедупликация: 30 параллельных → 1 обмен', stats.mints === 1, `mints=${stats.mints}`);
    check('дедупликация: t.jwt() дёрнут один раз', stats.jwtCalls === 1, `jwt=${stats.jwtCalls}`);
}

// 4. Токен близок к истечению (внутри окна в 5 минут) → перевыпуск.
{
    const { api, stats } = load();
    await api.request('cards?select=id');
    api._accessToken = { token: 'stale', expiresAt: Math.floor(Date.now() / 1000) + 60 };
    await api.request('cards?select=id');
    check('перевыпуск за 5 минут до exp', stats.mints === 2, `mints=${stats.mints}`);
    check('после перевыпуска идёт новый токен',
        stats.restCalls[1].auth === 'Bearer minted-2', stats.restCalls[1].auth);
}

// 5. Функция обмена упала → фолбэк на anon-ключ (фича-флаг включён).
{
    const { api, stats } = load({ mintStatus: 500 });
    await api.request('cards?select=id');
    check('обмен упал → фолбэк на anon',
        stats.restCalls[0].auth.startsWith('Bearer ' + ANON_PREFIX), stats.restCalls[0].auth.slice(0, 45));
}

// 6. Контекст не зарегистрирован → тоже фолбэк, без обращения к функции.
{
    const { api, stats } = load({ jwt: null });
    await api.request('cards?select=id');
    check('нет контекста → фолбэк без обмена',
        stats.mints === 0 && stats.restCalls[0].auth.startsWith('Bearer ' + ANON_PREFIX));
}

// 7. Фича-флаг выключен и обмен упал → запрос падает, а не идёт с anon-ключом.
{
    const { api, stats } = load({ mintStatus: 500, allowFallback: false });
    let threw = false;
    try { await api.request('cards?select=id'); } catch { threw = true; }
    check('без фолбэка: запрос падает, а не уходит с anon',
        threw && stats.restCalls.length === 0, `threw=${threw} rest=${stats.restCalls.length}`);
}

console.log(fails === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
