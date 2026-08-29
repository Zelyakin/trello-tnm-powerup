// Проверка политик RLS на ЖИВОЙ базе: минтим токен для доски A и смотрим, что видно.
// Запуск:  deno run -A tests/rls_live_test.ts
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

// Берём две РАЗНЫЕ доски, у которых есть карточки (пока anon-ключ ещё работает).
const withCards = await (await fetch(
    `${URL_BASE}/cards?select=board_id&time_minutes=gt.0&limit=200`,
    { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })).json();
const boardIds = [...new Set(withCards.map((c: any) => c.board_id))].slice(0, 2) as string[];
if (boardIds.length < 2) { console.log('нужно минимум 2 доски с карточками'); Deno.exit(1); }

const boards = await (await fetch(
    `${URL_BASE}/boards?select=id,trello_board_id&id=in.(${boardIds.join(',')})`,
    { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })).json();
const A = boards.find((b: any) => b.id === boardIds[0])!;
const B = boards.find((b: any) => b.id === boardIds[1])!;
console.log(`доска A = ${mask(A.trello_board_id)}   доска B = ${mask(B.trello_board_id)}\n`);

const tokenA = await mint(A.trello_board_id);
let fails = 0;
const check = (n: string, ok: boolean, d = '') => {
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? ' — ' + d : ''}`); if (!ok) fails++;
};

// 1. Свои данные видны.
const ownCards = await count(`cards?select=id&board_id=eq.${A.id}`, tokenA);
check('свои карточки видны', typeof ownCards === 'number' && ownCards > 0, `${ownCards} шт.`);

// 2. Чужие — нет.
const foreignCards = await count(`cards?select=id&board_id=eq.${B.id}`, tokenA);
check('чужие карточки НЕ видны', foreignCards === 0, `${foreignCards}`);

// 3. Запрос без фильтра отдаёт только свою доску.
const allBoards = await count('boards?select=id', tokenA);
check('в /boards видна ровно одна доска', allBoards === 1, `${allBoards}`);

// 4. Записи времени: всего по базе видно не больше, чем своих.
// Встроенный ресурс задаётся ВНУТРИ select, фильтр по нему — отдельным параметром.
const ownEntries = await count(`time_entries?select=id,cards!inner(id)&cards.board_id=eq.${A.id}`, tokenA);
const visibleEntries = await count('time_entries?select=id', tokenA);
const anonEntries = await count('time_entries?select=id', anon);
check('time_entries: видно ровно свои', ownEntries === visibleEntries,
    `свои=${ownEntries} видно=${visibleEntries}`);
check('time_entries: это меньше, чем есть в базе', Number(visibleEntries) < Number(anonEntries),
    `видно=${visibleEntries} всего в базе=${anonEntries}`);

// 5. Вставка карточки на ЧУЖУЮ доску должна быть отклонена (ничего не пишется).
const ins = await fetch(`${URL_BASE}/cards`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${tokenA}`,
               'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ trello_card_id: 'rls-probe-should-never-exist', board_id: B.id, time_minutes: 0 })
});
check('вставка на чужую доску отклонена', ins.status === 403 || ins.status === 401, `HTTP ${ins.status}`);

// 6. anon-ключ: ДО скрипта 02 видит всё, ПОСЛЕ — не должен видеть ничего.
// Поэтому не жёсткая проверка, а информация с ожиданием на оба этапа.
const anonAll = await count('cards?select=id', anon);
console.log(`\n  инфо: anon видит карточек = ${anonAll}`);
console.log('        до 02_cutover — это норма; после — должно стать 0 или HTTP 401');

// 7. board_settings ещё без RLS — тоже ожидаемо до 02.
const settingsAll = await count('board_settings?select=id', tokenA);
console.log(`\n  инфо: board_settings видно строк = ${settingsAll} (RLS там включается скриптом 02)`);

console.log(fails === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${fails}`);
Deno.exit(fails === 0 ? 0 : 1);
