// Проверка политик RLS на ЖИВОЙ базе: минтим токен для доски A и смотрим, что видно.
// Запуск:  deno run -A tests/rls_live_test.ts [trello_board_id]
// Требует supabase/.env.secrets (см. supabase/README.md).
//
// Безопасность: только чтение + одна ЗАВЕДОМО ОТКЛОНЯЕМАЯ вставка (при отказе ничего не
// пишется). Содержимое строк не печатается — только количества.
import * as jose from 'npm:jose@5';

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const URL_BASE = 'https://tpzbvdyxmzqweoghtgzp.supabase.co/rest/v1';

const env = await Deno.readTextFile(`${ROOT}/supabase/.env.secrets`);
const secretLine = env.split('\n').find((l) => l.startsWith('APP_JWT_SECRET='))!;
// slice, а не split('='): base64-секрет заканчивается на '=' и split его обрежет.
const secret = secretLine.slice(secretLine.indexOf('=') + 1).trim();
const anon = (await Deno.readTextFile(`${ROOT}/js/supabase-api.js`))
    .match(/SUPABASE_ANON_KEY:\s*'([^']+)'/)![1];

const mask = (s: string) => s.slice(0, 8) + '…';

async function count(path: string, token: string): Promise<number | string> {
    const r = await fetch(`${URL_BASE}/${path}`, {
        method: 'HEAD',
        headers: { apikey: anon, Authorization: `Bearer ${token}`, Prefer: 'count=exact' }
    });
    if (!r.ok) return `HTTP ${r.status}`;
    const range = r.headers.get('content-range') ?? '';
    return Number(range.split('/')[1] ?? -1);
}

async function mint(trelloBoardId: string) {
    const now = Math.floor(Date.now() / 1000);
    return await new jose.SignJWT({
        role: 'authenticated', trello_board_id: trelloBoardId, trello_member_id: 'test-member'
    }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('test-member').setAudience('authenticated')
      .setIssuedAt(now).setExpirationTime(now + 600)
      .sign(new TextEncoder().encode(secret));
}

// Доску больше нельзя найти через anon-ключ — после 02_cutover он ничего не видит, и это
// правильно. Поэтому id боевой доски передаётся аргументом (взять из URL доски в Trello или
// из SQL Editor: select trello_board_id from boards limit 1).
const A_TRELLO_ID = Deno.args[0] ?? '65c648dc4d24aa2abf013ed6';
// Заведомо несуществующая доска: для неё current_board_id() вернёт null, и по политикам
// не должно быть видно ничего.
const FAKE_TRELLO_ID = '000000000000000000000000';
const FAKE_BOARD_UUID = '00000000-0000-4000-8000-000000000000';

console.log(`доска A = ${mask(A_TRELLO_ID)}   (для сравнения — несуществующая доска)\n`);

const tokenA = await mint(A_TRELLO_ID);
const tokenFake = await mint(FAKE_TRELLO_ID);
let fails = 0;
const check = (n: string, ok: boolean, d = '') => {
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? ' — ' + d : ''}`); if (!ok) fails++;
};

// 0. ГЛАВНОЕ: anon-ключ не должен видеть ничего.
const anonCards = await count('cards?select=id', anon);
const anonEntries = await count('time_entries?select=id', anon);
const anonSettings = await count('board_settings?select=id', anon);
const blocked = (v: number | string) => v === 0 || String(v).startsWith('HTTP 4');
check('anon НЕ видит карточек', blocked(anonCards), `${anonCards}`);
check('anon НЕ видит записей времени', blocked(anonEntries), `${anonEntries}`);
check('anon НЕ видит настроек досок', blocked(anonSettings), `${anonSettings}`);

// 1. Свои данные видны по токену.
const ownCards = await count('cards?select=id', tokenA);
check('свои карточки видны', typeof ownCards === 'number' && ownCards > 0, `${ownCards} шт.`);

const ownEntries = await count('time_entries?select=id', tokenA);
check('свои записи времени видны', typeof ownEntries === 'number' && ownEntries > 0, `${ownEntries} шт.`);

// 2. Запрос без фильтра отдаёт ровно одну доску — свою.
const ownBoards = await count('boards?select=id', tokenA);
check('в /boards видна ровно одна доска', ownBoards === 1, `${ownBoards}`);

// 3. Настройки: видны только свои (одна строка на доску).
const ownSettings = await count('board_settings?select=id', tokenA);
check('board_settings: только своя доска', ownSettings === 1, `${ownSettings}`);

// 4. Токен на несуществующую доску не открывает ничего.
check('чужой/неизвестный board_id: карточек 0', await count('cards?select=id', tokenFake) === 0);
check('чужой/неизвестный board_id: записей 0', await count('time_entries?select=id', tokenFake) === 0);
check('чужой/неизвестный board_id: досок 0', await count('boards?select=id', tokenFake) === 0);

// 5. Вставка карточки на доску, которой у токена нет (ничего не пишется при отказе).
const ins = await fetch(`${URL_BASE}/cards`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${tokenA}`,
               'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ trello_card_id: 'rls-probe-should-never-exist', board_id: FAKE_BOARD_UUID, time_minutes: 0 })
});
check('вставка на чужую доску отклонена', ins.status === 403 || ins.status === 401, `HTTP ${ins.status}`);

console.log(fails === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${fails}`);
Deno.exit(fails === 0 ? 0 : 1);
