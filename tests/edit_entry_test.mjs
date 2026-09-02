// Тест редактирования записи времени (updateTimeEntry) и идентификации записей по PK.
// Запуск:  node tests/edit_entry_test.mjs
//
// Проверяет три вещи, каждая из которых уже ломалась:
//  1) адресация записи по id (uuid), а не по created_at — PATCH по неуникальному полю
//     молча правил бы все совпавшие строки;
//  2) поля, которые правка обязана НЕ трогать (created_at, trello_entry_id);
//  3) сброс кэша, когда PATCH не нашёл строку: без него попап перечитывал историю
//     из своего же кэша и продолжал показывать запись, удалённую из другой вкладки.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../js/supabase-api.js', import.meta.url), 'utf8');

function load() {
    const stats = { requests: [] };
    const db = {
        cards: [{ id: 'card-uuid', trello_card_id: 'c1', board_id: 'b-uuid', time_minutes: 150 }],
        entries: [
            { id: 'e1', card_id: 'card-uuid', time_minutes: 90, description: 'wrote it',
              work_date: '2026-08-30', trello_member_id: 'm1', member_name: 'Petr',
              trello_entry_id: 1, created_at: '2026-08-30T10:00:00' },
            { id: 'e2', card_id: 'card-uuid', time_minutes: 60, description: 'review',
              work_date: '2026-08-28', trello_member_id: 'm2', member_name: 'Ann',
              trello_entry_id: 2, created_at: '2026-08-30T10:00:00' } // тот же created_at!
        ]
    };

    const fetchImpl = async (url, config = {}) => {
        const u = String(url);
        if (u.includes('/functions/v1/trello-auth')) {
            return { ok: true, status: 200,
                     json: async () => ({ token: 'test-token',
                                          expiresAt: Math.floor(Date.now() / 1000) + 3600 }) };
        }

        const endpoint = u.split('/rest/v1/')[1];
        const method = config.method || 'GET';
        const body = config.body ? JSON.parse(config.body) : null;
        stats.requests.push({ endpoint, method, body });

        const arg = (re) => { const m = re.exec(endpoint); return m && m[1]; };
        const ok = (rows) => ({ ok: true, status: 200, json: async () => rows });

        if (endpoint.startsWith('boards?')) return ok([{ id: 'b-uuid' }]);
        if (endpoint.startsWith('board_settings?')) return ok([{ hours_per_day: 8 }]);
        if (method === 'PATCH' && endpoint.startsWith('cards?id=')) {
            db.cards[0].time_minutes = body.time_minutes;
            return ok({});
        }
        if (endpoint.startsWith('cards?')) return ok(db.cards.map(c => ({ ...c })));
        if (method === 'PATCH' && endpoint.startsWith('time_entries?id=')) {
            const row = db.entries.find(e => e.id === arg(/id=eq\.([^&]+)/)
                                          && e.card_id === arg(/card_id=eq\.([^&]+)/));
            if (!row) return ok([]);
            Object.assign(row, body);
            return ok([{ ...row }]);
        }
        if (method === 'DELETE' && endpoint.startsWith('time_entries?id=')) {
            db.entries = db.entries.filter(e => e.id !== arg(/id=eq\.([^&]+)/));
            return ok({});
        }
        if (endpoint.startsWith('time_entries?select=time_minutes&'))
            return ok(db.entries.map(e => ({ time_minutes: e.time_minutes })));
        if (endpoint.startsWith('time_entries?select=id,'))
            return ok(db.entries.map(e => ({ ...e })));
        throw new Error('unhandled endpoint: ' + endpoint);
    };

    const ctx = { console: { log() {}, warn() {}, error() {} }, fetch: fetchImpl,
                  Date, JSON, Math, Promise, Map, Error, Array, setTimeout,
                  window: { addEventListener() {} } };
    vm.createContext(ctx);
    vm.runInContext(SRC + '\n;globalThis.__api = SupabaseAPI;', ctx);

    const api = ctx.__api;
    api.useTrelloContext({ jwt: async () => 'trello.jwt.here' });
    return { api, stats, db };
}

let fails = 0;
const check = (n, ok, d = '') => {
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? ' — ' + d : ''}`); if (!ok) fails++;
};

// 1. Успешная правка.
{
    const { api, stats, db } = load();
    await api.updateTimeEntry('B', 'c1', 'e1', {
        timeMinutes: 135, description: 'wrote it (fixed)', workDate: '2026-08-25T00:00:00.000Z',
        memberId: 'm3', memberName: 'Bob'
    });

    const patch = stats.requests.find(r => r.method === 'PATCH' && r.endpoint.startsWith('time_entries'));
    check('PATCH адресован по id и card_id',
        /^time_entries\?id=eq\.e1&card_id=eq\.card-uuid$/.test(patch.endpoint), patch.endpoint);
    check('work_date записан как календарная дата', patch.body.work_date === '2026-08-25', patch.body.work_date);
    check('created_at не в теле запроса', !('created_at' in patch.body));
    check('trello_entry_id не в теле запроса', !('trello_entry_id' in patch.body));
    check('соседняя запись с тем же created_at не тронута',
        db.entries[1].time_minutes === 60 && db.entries[1].description === 'review');
    check('агрегат карточки пересчитан (135 + 60)', db.cards[0].time_minutes === 195, `${db.cards[0].time_minutes}`);

    const order = stats.requests.map(r => `${r.method} ${r.endpoint.split('?')[0]}`);
    check('агрегат обновлён ПОСЛЕ правки записи',
        order.lastIndexOf('PATCH cards') > order.indexOf('PATCH time_entries'), order.join(' | '));
}

// 2. Строки уже нет: бросаем — и обязательно сбрасываем кэш карточки.
//    Без сброса попап перечитал бы историю из кэша и остался в режиме правки призрака.
{
    const { api, stats } = load();
    await api.getCardDataFull('c1');                     // прогреваем кэш
    const warm = stats.requests.length;
    await api.getCardDataFull('c1');
    check('кэш истории работает', stats.requests.length === warm, `${stats.requests.length - warm}`);

    let threw = null;
    try {
        await api.updateTimeEntry('B', 'c1', 'ghost', { timeMinutes: 10, memberId: 'm1', memberName: 'P' });
    } catch (e) { threw = e; }

    check('правка исчезнувшей записи бросает ошибку', threw !== null && /deleted from another tab/.test(threw.message),
        threw && threw.message);
    check('агрегат при этом не пересчитывался',
        !stats.requests.some(r => r.method === 'PATCH' && r.endpoint.startsWith('cards')));

    const before = stats.requests.length;
    await api.getCardDataFull('c1');
    check('кэш карточки сброшен — история читается заново', stats.requests.length > before,
        `${stats.requests.length - before}`);
}

// 3. Удаление тоже адресуется по PK, а не по created_at (у e1 и e2 он одинаковый).
{
    const { api, stats, db } = load();
    await api.deleteTimeEntry('B', 'c1', 'e1');
    const del = stats.requests.find(r => r.method === 'DELETE');
    check('DELETE адресован по id', /^time_entries\?id=eq\.e1&card_id=eq\.card-uuid$/.test(del.endpoint), del.endpoint);
    check('удалена ровно одна запись', db.entries.length === 1 && db.entries[0].id === 'e2',
        db.entries.map(e => e.id).join(','));
}

// 4. Наружу история отдаёт PK записи — на нём держатся и правка, и удаление.
{
    const { api } = load();
    const data = await api.getCardDataFull('c1');
    check('history[].id — это PK записи', data.history.map(h => h.id).join(',') === 'e1,e2',
        data.history.map(h => h.id).join(','));
    check('created_at по-прежнему доступен как date', data.history[0].date === '2026-08-30T10:00:00');
}

console.log(fails === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
